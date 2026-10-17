import { Query } from 'node-appwrite';
import { COL, DB, Rejected, num, str } from '../lib/context.js';
import { ADMIN_LABEL } from '../lib/admin.js';
import { buildReport } from '../lib/report.js';

/**
 * Admin read side. Every handler here runs behind the /admin/ gate in main.js.
 *
 * Lists go through one registry rather than a route per collection. The
 * registry is also the allow-list: a collection, filter field or sort that is
 * not named here cannot be asked for, so the panel cannot be used to read
 * arbitrary tables or probe arbitrary columns.
 */

/** Fields that never leave the server, even to an admin. */
const HIDDEN = new Set(['fcmToken', 'deviceFingerprint']);

export const LISTS = {
  users: { col: COL.profiles, filters: ['isBanned', 'userId'], search: 'name' },
  trees: { col: COL.trees, filters: ['status', 'ownerId', 'speciesCode'] },
  verifications: { col: COL.treeVerifications, filters: ['status', 'treeId', 'userId'] },
  flags: { col: COL.fraudFlags, filters: ['resolved', 'kind', 'severity', 'userId'] },
  feedback: { col: COL.feedback, filters: ['status', 'category', 'userId'] },
  redemptions: { col: COL.redemptions, filters: ['status', 'type', 'userId'] },
  inspections: { col: COL.aiInspections, filters: ['action', 'status', 'userId', 'model'] },
  actions: { col: COL.adminActions, filters: ['adminId', 'action', 'targetType'] },
};

const MAX_PAGE = 50;

/** Strips Appwrite internals and anything in HIDDEN. Keeps $id and timestamps. */
export function sanitize(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc ?? {})) {
    if (HIDDEN.has(k)) continue;
    if (k.startsWith('$') && !['$id', '$createdAt', '$updatedAt'].includes(k)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Turns a request body into a validated query list.
 *
 * Throws Rejected on anything outside the registry. Values are coerced to the
 * scalar types Appwrite accepts; objects and arrays are refused so a filter
 * cannot smuggle in a structure.
 */
export function buildListQuery(name, body = {}) {
  const spec = LISTS[name];
  if (!spec) throw new Rejected('bad_request', `Unknown list "${name}".`);

  const queries = [Query.orderDesc('$createdAt')];

  const limit = Math.min(MAX_PAGE, Math.max(1, Math.round(num(body.limit, 25))));
  const offset = Math.max(0, Math.round(num(body.offset, 0)));
  queries.push(Query.limit(limit), Query.offset(offset));

  const filters = body.filters && typeof body.filters === 'object' ? body.filters : {};
  for (const [field, value] of Object.entries(filters)) {
    if (value === '' || value === null || value === undefined) continue;
    if (!spec.filters.includes(field)) {
      throw new Rejected('bad_request', `"${field}" is not a filter for ${name}.`);
    }
    if (typeof value === 'boolean') queries.push(Query.equal(field, value));
    else if (typeof value === 'string' || typeof value === 'number') {
      queries.push(Query.equal(field, typeof value === 'string' ? value.slice(0, 128) : value));
    } else {
      throw new Rejected('bad_request', `Filter "${field}" has an unsupported value.`);
    }
  }

  const search = str(body.search, 64);
  if (search) {
    if (!spec.search) throw new Rejected('bad_request', `${name} cannot be searched.`);
    queries.push(Query.search(spec.search, search));
  }

  return { queries, limit, offset };
}

/** Rolls inspection rows up into the numbers the dashboard shows. */
export function aggregateInspections(rows) {
  const out = {
    total: rows.length,
    approve: 0,
    review: 0,
    reject: 0,
    unavailable: 0,
    avgLatencyMs: 0,
    byModel: {},
  };
  let latencySum = 0;
  let latencyN = 0;

  for (const r of rows) {
    if (r.action === 'approve') out.approve++;
    else if (r.action === 'review') out.review++;
    else if (r.action === 'reject') out.reject++;
    if (r.status === 'unavailable') out.unavailable++;

    if (r.status === 'ok' && Number.isFinite(r.latencyMs)) {
      latencySum += r.latencyMs;
      latencyN++;
    }

    const key = r.model || 'unknown';
    const m = (out.byModel[key] ??= { calls: 0, unavailable: 0, latencySum: 0, latencyN: 0 });
    m.calls++;
    if (r.status === 'unavailable') m.unavailable++;
    if (r.status === 'ok' && Number.isFinite(r.latencyMs)) {
      m.latencySum += r.latencyMs;
      m.latencyN++;
    }
  }

  out.avgLatencyMs = latencyN ? Math.round(latencySum / latencyN) : 0;
  for (const m of Object.values(out.byModel)) {
    m.avgLatencyMs = m.latencyN ? Math.round(m.latencySum / m.latencyN) : 0;
    delete m.latencySum;
    delete m.latencyN;
  }
  return out;
}

/**
 * Reads a collection newest first up to [cap] rows and says whether that was
 * all of it. Ordered by creation time, which every document has, so it needs no
 * index on any application field.
 */
async function readCapped(databases, col, cap = 1000) {
  const rows = [];
  let cursor = null;
  let total = 0;
  while (rows.length < cap) {
    const q = [Query.orderDesc('$createdAt'), Query.limit(100)];
    if (cursor) q.push(Query.cursorAfter(cursor));
    const res = await databases.listDocuments(DB, col, q);
    total = res.total ?? rows.length + res.documents.length;
    rows.push(...res.documents);
    if (res.documents.length < 100) break;
    cursor = res.documents[res.documents.length - 1].$id;
  }
  return { rows, capped: total > rows.length };
}

/** Adds up a numeric field, treating anything that is not a finite number as 0. */
export function sumField(rows, field) {
  return rows.reduce((sum, row) => {
    const v = row?.[field];
    return sum + (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  }, 0);
}

async function count(databases, col, queries = []) {
  const res = await databases.listDocuments(DB, col, [...queries, Query.limit(1)]);
  return res.total ?? 0;
}

/** Pages through a collection up to a cap. Used where a sum is needed. */
async function pageAll(databases, col, queries, cap = 1000) {
  const rows = [];
  let cursor = null;
  while (rows.length < cap) {
    const q = [...queries, Query.limit(100)];
    if (cursor) q.push(Query.cursorAfter(cursor));
    const res = await databases.listDocuments(DB, col, q);
    rows.push(...res.documents);
    if (res.documents.length < 100) break;
    cursor = res.documents[res.documents.length - 1].$id;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** Lets the web app confirm a session is a real admin before showing the UI. */
async function whoami({ user }) {
  return {
    id: user.$id,
    email: user.email,
    name: user.name,
    labels: user.labels ?? [],
    isAdmin: (user.labels ?? []).includes(ADMIN_LABEL),
  };
}

async function stats({ databases, config }) {
  const windowDays = 7;
  const since = new Date(Date.now() - windowDays * 86400000).toISOString();

  const treeStatuses = ['pending_review', 'alive', 'at_risk', 'missed', 'dead', 'rejected'];
  const verStatuses = ['approved', 'manual_review', 'rejected'];

  const [
    users, banned, trees, treeBy, vers, verBy, openFlags, openFeedback,
    pendingRedemptions, profiles, inspections,
  ] = await Promise.all([
    count(databases, COL.profiles),
    count(databases, COL.profiles, [Query.equal('isBanned', true)]),
    count(databases, COL.trees),
    Promise.all(treeStatuses.map((s) => count(databases, COL.trees, [Query.equal('status', s)]))),
    count(databases, COL.treeVerifications),
    Promise.all(verStatuses.map((s) => count(databases, COL.treeVerifications, [Query.equal('status', s)]))),
    count(databases, COL.fraudFlags, [Query.equal('resolved', false)]),
    count(databases, COL.feedback, [Query.equal('status', 'open')]),
    count(databases, COL.redemptions, [Query.equal('status', 'pending')]),
    pageAll(databases, COL.profiles, [], 1000),
    pageAll(databases, COL.aiInspections, [Query.greaterThan('createdAt', since)], 1000),
  ]);

  const lifetime = sumField(profiles, 'creditsLifetime');
  const spent = sumField(profiles, 'creditsSpent');
  const co2Grams = sumField(profiles, 'co2OffsetGrams');

  return {
    users: { total: users, banned },
    trees: { total: trees, byStatus: Object.fromEntries(treeStatuses.map((s, i) => [s, treeBy[i]])) },
    verifications: { total: vers, byStatus: Object.fromEntries(verStatuses.map((s, i) => [s, verBy[i]])) },
    credits: { lifetimeIssued: lifetime, spent, sampled: profiles.length, approximate: users > profiles.length },
    // Credited so far, from each approved check-in at the species' mature-tree
    // rate. An estimate of impact, not a measurement.
    co2: { offsetGrams: co2Grams, sampled: profiles.length, approximate: users > profiles.length },
    queue: { trees: treeBy[0], verifications: verBy[1] },
    open: { flags: openFlags, feedback: openFeedback, redemptions: pendingRedemptions },
    ai: {
      windowDays,
      ...aggregateInspections(inspections),
      enabled: config['vision.ai_enabled'] !== false,
      model: config['vision.model'] ?? '',
      onUnavailable: config['vision.on_unavailable'] ?? 'approve',
    },
  };
}

async function list({ databases, body }) {
  const name = str(body.list, 32);
  const { queries, limit, offset } = buildListQuery(name, body);
  const res = await databases.listDocuments(DB, LISTS[name].col, queries);
  return {
    items: res.documents.map(sanitize),
    total: res.total ?? res.documents.length,
    limit,
    offset,
  };
}

/** Everything the review screen needs for one submission, in a single read. */
async function queue({ databases }) {
  const [trees, vers] = await Promise.all([
    databases.listDocuments(DB, COL.trees, [
      Query.equal('status', 'pending_review'),
      Query.orderAsc('$createdAt'),
      Query.limit(50),
    ]),
    databases.listDocuments(DB, COL.treeVerifications, [
      Query.equal('status', 'manual_review'),
      Query.orderAsc('$createdAt'),
      Query.limit(50),
    ]),
  ]);

  // Verifications only carry a tree id, so fetch those trees for the species,
  // nickname and original location.
  const treeIds = [...new Set(vers.documents.map((v) => v.treeId))];
  const parents = new Map();
  if (treeIds.length) {
    const res = await databases.listDocuments(DB, COL.trees, [
      Query.equal('$id', treeIds.slice(0, 100)),
      Query.limit(100),
    ]);
    for (const t of res.documents) parents.set(t.$id, t);
  }

  const userIds = [
    ...new Set([
      ...trees.documents.map((t) => t.ownerId),
      ...vers.documents.map((v) => v.userId),
    ]),
  ];
  const people = new Map();
  if (userIds.length) {
    const res = await databases.listDocuments(DB, COL.profiles, [
      Query.equal('$id', userIds.slice(0, 100)),
      Query.limit(100),
    ]);
    for (const p of res.documents) people.set(p.$id, p);
  }

  const who = (id) => {
    const p = people.get(id);
    return { userName: p?.name ?? '', userEmail: p?.email ?? '', trustScore: p?.trustScore ?? null, isBanned: !!p?.isBanned };
  };

  const items = [
    ...trees.documents.map((t) => ({
      kind: 'tree',
      id: t.$id,
      createdAt: t.$createdAt,
      userId: t.ownerId,
      ...who(t.ownerId),
      title: `${t.speciesName || 'Tree'}${t.nickname ? ` “${t.nickname}”` : ''}`,
      photoFileId: t.plantPhotoFileId,
      lat: t.lat,
      lng: t.lng,
      accuracyM: t.accuracyM,
      addressLabel: t.addressLabel,
      reason: t.rejectReason,
      aiVerdict: t.aiVerdict,
      aiConfidence: t.aiConfidence,
      aiModel: t.aiModel,
    })),
    ...vers.documents.map((v) => {
      const t = parents.get(v.treeId);
      return {
        kind: 'verification',
        id: v.$id,
        createdAt: v.$createdAt,
        userId: v.userId,
        ...who(v.userId),
        title: `Check-in ${v.monthKey} · ${t?.speciesName || 'Tree'}${t?.nickname ? ` “${t.nickname}”` : ''}`,
        treeId: v.treeId,
        photoFileId: v.photoFileId,
        lat: v.lat,
        lng: v.lng,
        accuracyM: v.accuracyM,
        distanceM: v.distanceM,
        heightCm: v.heightCm,
        reason: v.rejectReason,
        aiVerdict: v.aiVerdict,
        aiConfidence: v.aiConfidence,
        aiModel: v.aiModel,
      };
    }),
  ].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

  return { items, counts: { trees: trees.total, verifications: vers.total } };
}

const PHOTO_BUCKETS = new Set(['tree_photos', 'feedback_media', 'bill_docs', 'avatars']);
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

export function sniffMime(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return 'image/webp';
  if (bytes[0] === 0x25 && bytes[1] === 0x50) return 'application/pdf';
  return null;
}

/**
 * Buckets are private to each user, so the browser cannot fetch a photo
 * itself. The function reads it with the server key and hands back a data URL.
 */
async function photo({ storage, body }) {
  const bucketId = str(body.bucketId, 32) || 'tree_photos';
  const fileId = str(body.fileId, 64);
  if (!PHOTO_BUCKETS.has(bucketId)) throw new Rejected('bad_request', 'That bucket is not viewable.');
  if (!fileId) throw new Rejected('bad_request', 'fileId is required.');

  let bytes;
  try {
    bytes = new Uint8Array(await storage.getFileDownload(bucketId, fileId));
  } catch (e) {
    if (e.code === 404) throw new Rejected('not_found', 'That file no longer exists.');
    throw e;
  }
  if (bytes.length > MAX_PHOTO_BYTES) {
    throw new Rejected('too_large', 'That file is too large to preview.');
  }
  const mime = sniffMime(bytes);
  if (!mime) throw new Rejected('unsupported', 'That file type cannot be previewed.');

  return { dataUrl: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`, mime, bytes: bytes.length };
}

/**
 * The impact report. Footprints are fetched here only so they can be averaged
 * by buildReport, which publishes nothing below five members; this route never
 * returns a row of any of them.
 */
async function report({ databases, body }) {
  const months = Math.min(24, Math.max(3, Math.round(num(body.months, 12))));

  const [trees, verifications, profiles, footprints, species] = await Promise.all([
    readCapped(databases, COL.trees),
    readCapped(databases, COL.treeVerifications),
    readCapped(databases, COL.profiles),
    readCapped(databases, COL.footprints),
    databases.listDocuments(DB, COL.species, [Query.limit(100)]),
  ]);

  return buildReport({
    trees: trees.rows,
    verifications: verifications.rows,
    profiles: profiles.rows,
    footprints: footprints.rows,
    species: species.documents,
    months,
    capped: {
      trees: trees.capped,
      verifications: verifications.capped,
      profiles: profiles.capped,
      footprints: footprints.capped,
    },
  });
}

export const READ_ROUTES = {
  '/admin/whoami': whoami,
  '/admin/stats': stats,
  '/admin/list': list,
  '/admin/queue': queue,
  '/admin/report': report,
  '/admin/photo': photo,
};

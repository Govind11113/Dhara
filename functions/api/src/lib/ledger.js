import { ID, Query, Permission, Role } from 'node-appwrite';
import { COL, DB, Rejected, nowIso } from './context.js';

/**
 * Credit ledger.
 *
 * This Appwrite server exposes neither multi-document transactions nor atomic
 * field increments, so exactly-once behaviour is built on the unique index over
 * `credit_ledger.idempotencyKey`:
 *
 *   1. Insert the ledger row first. A duplicate key is rejected with 409 by the
 *      database, which is the authoritative "this was already paid" signal.
 *   2. Only then refresh the cached totals on the profile.
 *
 * The ledger is the source of truth; `profiles.creditsAvailable` is a cache for
 * cheap reads. If step 2 fails midway the cache lags, and [recomputeBalance]
 * rebuilds it from the ledger. Never the other way round.
 */

const XP_PER_CREDIT = 1;
const DEFAULT_CURVE = [0, 100, 250, 500, 900, 1500, 2400, 3600, 5200, 7200, 9800];

export function levelFor(xp, curve = DEFAULT_CURVE) {
  let level = 1;
  for (let i = 1; i < curve.length; i++) {
    if (xp >= curve[i]) level = i + 1;
    else break;
  }
  return level;
}

/**
 * Applies a credit movement.
 *
 * @returns {Promise<{applied: boolean, balance: number, entryId?: string}>}
 *          `applied: false` means this exact key was already processed.
 */
export async function award(
  databases,
  {
    userId,
    delta,
    source,
    refId = null,
    idempotencyKey,
    note = '',
    stats = {},
    config = {},
  },
) {
  if (!idempotencyKey) {
    throw new Rejected('missing_idempotency_key', 'Internal error.');
  }
  if (!Number.isInteger(delta)) {
    throw new Rejected('invalid_delta', 'Internal error.');
  }

  const profile = await databases.getDocument(DB, COL.profiles, userId);

  if (profile.isBanned) {
    throw new Rejected('account_suspended', 'This account is suspended.');
  }

  const available = profile.creditsAvailable ?? 0;
  if (delta < 0 && available + delta < 0) {
    throw new Rejected('insufficient_credits', 'Not enough credits.', {
      available,
      required: Math.abs(delta),
    });
  }

  const balanceAfter = available + delta;

  // Step 1: the unique index makes this the mutex.
  let entry;
  try {
    entry = await databases.createDocument(
      DB,
      COL.creditLedger,
      ID.unique(),
      {
        userId,
        delta,
        balanceAfter,
        source,
        refId,
        idempotencyKey,
        note: note.slice(0, 256),
        occurredAt: nowIso(),
      },
      [Permission.read(Role.user(userId))],
    );
  } catch (e) {
    if (e.code === 409) {
      // Already paid out. Report the live balance rather than replaying.
      return { applied: false, balance: available, duplicate: true };
    }
    throw e;
  }

  // Step 2: refresh cached aggregates.
  const curve = Array.isArray(config['xp.level_curve'])
    ? config['xp.level_curve']
    : DEFAULT_CURVE;

  const patch = {
    creditsAvailable: balanceAfter,
    lastActiveAt: nowIso(),
  };

  if (delta > 0) {
    patch.creditsLifetime = (profile.creditsLifetime ?? 0) + delta;
    const xp = (profile.xp ?? 0) + delta * XP_PER_CREDIT;
    patch.xp = xp;
    patch.level = levelFor(xp, curve);
  } else if (delta < 0) {
    patch.creditsSpent = (profile.creditsSpent ?? 0) + Math.abs(delta);
  }

  for (const [field, increment] of Object.entries(stats)) {
    if (!Number.isFinite(increment)) continue;
    patch[field] = Math.max(0, (profile[field] ?? 0) + increment);
  }

  try {
    await databases.updateDocument(DB, COL.profiles, userId, patch);
  } catch (e) {
    // The ledger row is committed, so the credit is real. Leave the cache stale
    // rather than failing the user's action; recomputeBalance repairs it.
    console.error('profile cache update failed', userId, e.message);
  }

  return { applied: true, balance: balanceAfter, entryId: entry.$id };
}

/** Adjusts profile counters without moving credits. */
export async function bumpStats(databases, userId, stats) {
  const entries = Object.entries(stats).filter(([, v]) => Number.isFinite(v));
  if (!entries.length) return;

  const profile = await databases.getDocument(DB, COL.profiles, userId);
  const patch = { lastActiveAt: nowIso() };
  for (const [field, increment] of entries) {
    patch[field] = Math.max(0, (profile[field] ?? 0) + increment);
  }
  await databases.updateDocument(DB, COL.profiles, userId, patch);
}

/**
 * Folds ledger rows into balance, lifetime earned and spent.
 *
 * Pure so it can be tested. A `reversal` is not new income or new spending: a
 * positive one hands back credits that were spent (it shrinks `spent`), and a
 * negative one claws back credits that were earned (it shrinks `lifetime`).
 * Counting a refund as lifetime income would let a failed redemption inflate
 * XP-style totals, and the next balance repair would bake that in.
 */
export function tally(rows) {
  let available = 0;
  let lifetime = 0;
  let spent = 0;

  for (const row of rows) {
    const delta = row.delta ?? 0;
    available += delta;

    if (row.source === 'reversal') {
      if (delta > 0) spent = Math.max(0, spent - delta);
      else lifetime = Math.max(0, lifetime + delta);
    } else if (delta > 0) {
      lifetime += delta;
    } else {
      spent += Math.abs(delta);
    }
  }

  return { available, lifetime, spent };
}

/**
 * Rebuilds the cached balance from the ledger. Used to repair drift and as the
 * authoritative guard before a redemption.
 */
export async function recomputeBalance(databases, userId) {
  const rows = [];
  let cursor = null;

  for (let page = 0; page < 100; page++) {
    const queries = [
      Query.equal('userId', userId),
      Query.orderAsc('$id'),
      Query.limit(100),
    ];
    if (cursor) queries.push(Query.cursorAfter(cursor));

    const res = await databases.listDocuments(DB, COL.creditLedger, queries);
    rows.push(...res.documents);
    if (res.documents.length < 100) break;
    cursor = res.documents[res.documents.length - 1].$id;
  }

  return tally(rows);
}

/**
 * Hands back credits that were spent, exactly once per `idempotencyKey`.
 *
 * Deliberately not [award]: that treats a positive delta as newly earned, which
 * would raise lifetime credits and XP and can push the user up a level for
 * money they already had. A refund only restores `creditsAvailable` and winds
 * back `creditsSpent`. It also works on a banned account, because returning a
 * user's own credits is not something a ban should withhold.
 */
export async function refund(
  databases,
  { userId, amount, refId = null, idempotencyKey, note = '' },
) {
  if (!idempotencyKey) throw new Rejected('missing_idempotency_key', 'Internal error.');
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Rejected('invalid_delta', 'Internal error.');
  }

  const profile = await databases.getDocument(DB, COL.profiles, userId);
  const balanceAfter = (profile.creditsAvailable ?? 0) + amount;

  try {
    await databases.createDocument(
      DB,
      COL.creditLedger,
      ID.unique(),
      {
        userId,
        delta: amount,
        balanceAfter,
        source: 'reversal',
        refId,
        idempotencyKey,
        note: String(note).slice(0, 256),
        occurredAt: nowIso(),
      },
      [Permission.read(Role.user(userId))],
    );
  } catch (e) {
    if (e.code === 409) {
      return { applied: false, balance: profile.creditsAvailable ?? 0, duplicate: true };
    }
    throw e;
  }

  try {
    await databases.updateDocument(DB, COL.profiles, userId, {
      creditsAvailable: balanceAfter,
      creditsSpent: Math.max(0, (profile.creditsSpent ?? 0) - amount),
      lastActiveAt: nowIso(),
    });
  } catch (e) {
    // The ledger row is committed, so the refund is real. The cache lags and
    // recomputeBalance repairs it, same as for award().
    console.error('profile cache update failed after refund', userId, e.message);
  }

  return { applied: true, balance: balanceAfter };
}

/** Records a fraud signal and optionally docks trust score. */
export async function flag(
  databases,
  { userId, kind, severity = 'low', detail = '', refType = '', refId = '', trustScoreDelta = 0 },
) {
  try {
    await databases.createDocument(DB, COL.fraudFlags, ID.unique(), {
      userId,
      kind,
      severity,
      detail: String(detail).slice(0, 1024),
      refType: String(refType).slice(0, 32),
      refId: String(refId).slice(0, 64),
      trustScoreDelta,
      resolved: false,
      createdAt: nowIso(),
    });

    if (trustScoreDelta) {
      const profile = await databases.getDocument(DB, COL.profiles, userId);
      const next = Math.max(0, Math.min(100, (profile.trustScore ?? 100) + trustScoreDelta));
      await databases.updateDocument(DB, COL.profiles, userId, { trustScore: next });
    }
  } catch (e) {
    // Never let telemetry break the user's request.
    console.error('flag failed', kind, e.message);
  }
}

export async function notify(
  databases,
  { userId, title, body, type = 'system', refId = null, deepLink = null },
) {
  try {
    await databases.createDocument(
      DB,
      COL.notifications,
      ID.unique(),
      {
        userId,
        title: String(title).slice(0, 128),
        body: String(body).slice(0, 512),
        type,
        refId,
        deepLink,
        isRead: false,
        createdAt: nowIso(),
      },
      [Permission.read(Role.user(userId)), Permission.update(Role.user(userId))],
    );
  } catch (e) {
    console.error('notify failed', e.message);
  }
}

/**
 * Records a perceptual hash and reports the closest prior match.
 *
 * Candidates are shortlisted by hash prefix so this stays a bounded query
 * instead of a full-table scan.
 */
export async function checkAndStorePhash(
  databases,
  { phash, userId, refType, refId, fileId = null, threshold = 8 },
) {
  if (!phash) return { duplicate: false, nearest: 64 };

  const prefix = phash.slice(0, 4);
  let nearest = 64;
  let matchOwner = null;
  let matchRef = null;

  try {
    const res = await databases.listDocuments(DB, COL.photoHashes, [
      Query.equal('phashPrefix', prefix),
      Query.limit(100),
    ]);
    const { hamming } = await import('./context.js');
    for (const row of res.documents) {
      if (row.refType === refType && row.refId === refId) continue;
      const d = hamming(phash, row.phash);
      if (d < nearest) {
        nearest = d;
        matchOwner = row.userId;
        matchRef = row.refId;
      }
    }
  } catch (e) {
    console.error('phash lookup failed', e.message);
  }

  try {
    await databases.createDocument(DB, COL.photoHashes, ID.unique(), {
      phash,
      phashPrefix: prefix,
      userId,
      refType,
      refId,
      fileId,
      createdAt: nowIso(),
    });
  } catch (e) {
    console.error('phash store failed', e.message);
  }

  return {
    duplicate: nearest <= threshold,
    nearest,
    matchOwner,
    matchRef,
    sameUser: matchOwner === userId,
  };
}

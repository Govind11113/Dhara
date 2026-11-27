import { Query } from 'node-appwrite';
import { COL, DB, Rejected, nowIso, str } from '../lib/context.js';
import { logAction } from '../lib/admin.js';
import { notify } from '../lib/ledger.js';
import { readPaging, transition, validateReply, view } from '../lib/planting.js';
import { deepLinkFor } from './planting.js';

/**
 * Everything under /ngo/.
 *
 * main.js checks the caller carries the ngo (or admin) label before any handler
 * here runs, so handlers do not re-check, and must never be mounted outside the
 * /ngo/ prefix or they would lose that protection (a test enforces it).
 *
 * The NGO reads and writes requests only through these handlers. It never gets
 * a database permission of its own, so it can touch exactly what is exposed here.
 */

async function loadRequest(databases, id) {
  const requestId = str(id, 64);
  if (!requestId) throw new Rejected('bad_request', 'Which request?');
  try {
    return await databases.getDocument(DB, COL.plantingRequests, requestId);
  } catch (e) {
    if (e.code === 404) throw new Rejected('not_found', 'That request no longer exists.');
    throw e;
  }
}

export async function whoami({ user }) {
  return { id: user.$id, email: user.email, name: user.name, role: 'ngo' };
}

export async function requests({ databases, body }) {
  const { limit, status, cursor } = readPaging(body);

  const queries = [Query.orderDesc('createdAt'), Query.limit(limit + 1)];
  if (status) queries.push(Query.equal('status', status));
  if (cursor) queries.push(Query.cursorAfter(cursor));

  const res = await databases.listDocuments(DB, COL.plantingRequests, queries);

  // One extra row is read to learn whether there is another page, without a
  // second count query.
  const more = res.documents.length > limit;
  const page = more ? res.documents.slice(0, limit) : res.documents;

  return {
    requests: page.map(view),
    nextCursor: more ? page[page.length - 1].$id : null,
  };
}

export async function reply({ databases, user, body }) {
  const doc = await loadRequest(databases, body.id);

  const status = transition(doc.status, 'reply');
  const checked = validateReply(body);
  if (checked.error) throw new Rejected(checked.error.code, checked.error.message);
  const v = checked.value;

  const now = nowIso();
  const patch = {
    status,
    siteAddress: v.siteAddress,
    meetingAt: v.meetingAt,
    meetingPoint: v.meetingPoint,
    replyNotes: v.replyNotes,
    repliedBy: user.$id,
    repliedAt: now,
    // A fresh slot starts a fresh conversation: the earlier answer was about
    // the earlier slot.
    userResponse: '',
    updatedAt: now,
  };
  if (v.siteLat !== null) {
    patch.siteLat = v.siteLat;
    patch.siteLng = v.siteLng;
  }

  const rescheduled = doc.status !== 'open';
  const updated = await databases.updateDocument(DB, COL.plantingRequests, doc.$id, patch);

  await notify(databases, {
    userId: doc.userId,
    title: rescheduled ? 'New planting time proposed' : 'A planting place is ready',
    body: `Meet at ${v.meetingPoint} on ${new Date(v.meetingAt).toUTCString()}. Open the request to confirm.`,
    type: 'system',
    refId: doc.$id,
    deepLink: deepLinkFor(doc.$id),
  });

  await logAction(databases, user, {
    action: rescheduled ? 'planting.reschedule' : 'planting.reply',
    targetType: 'planting_request',
    targetId: doc.$id,
    detail: { meetingAt: v.meetingAt },
  });

  return { request: view(updated) };
}

export async function complete({ databases, user, body }) {
  const doc = await loadRequest(databases, body.id);
  const status = transition(doc.status, 'complete');

  const updated = await databases.updateDocument(DB, COL.plantingRequests, doc.$id, {
    status,
    updatedAt: nowIso(),
  });

  await notify(databases, {
    userId: doc.userId,
    title: 'Planting complete',
    body: 'Thank you for planting with us. Register your tree in the app to start earning credits.',
    type: 'system',
    refId: doc.$id,
    deepLink: deepLinkFor(doc.$id),
  });

  await logAction(databases, user, {
    action: 'planting.complete',
    targetType: 'planting_request',
    targetId: doc.$id,
  });

  return { request: view(updated) };
}

export const NGO_ROUTES = {
  '/ngo/whoami': whoami,
  '/ngo/requests': requests,
  '/ngo/reply': reply,
  '/ngo/complete': complete,
};

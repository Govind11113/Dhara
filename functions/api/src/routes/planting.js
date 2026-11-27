import { ID, Query, Permission, Role } from 'node-appwrite';
import { COL, DB, Rejected, geohash, nowIso, str } from '../lib/context.js';
import { notify } from '../lib/ledger.js';
import {
  ACTIVE_STATUSES,
  MAX_ACTIVE,
  transition,
  validateRequest,
  view,
} from '../lib/planting.js';

/**
 * Planting requests, member side.
 *
 * A member asks the partner NGO for a place to plant a tree, then answers the
 * NGO's reply. Like feedback, this goes through the function rather than a
 * direct client write: the collection is server-only, so a client cannot forge
 * a `userId`, set its own `status` or write the NGO's half of the record.
 */

/** The deep link a notification opens in the app. */
export const deepLinkFor = (id) => `/planting/${id}`;

/**
 * Loads a request the caller owns.
 *
 * A request that exists but belongs to someone else reads as not found, so the
 * response does not confirm that an id is real.
 */
export async function loadOwned(databases, user, id) {
  const requestId = str(id, 64);
  if (!requestId) throw new Rejected('bad_request', 'Which request?');
  let doc;
  try {
    doc = await databases.getDocument(DB, COL.plantingRequests, requestId);
  } catch (e) {
    if (e.code === 404) throw new Rejected('not_found', 'That request no longer exists.');
    throw e;
  }
  if (doc.userId !== user.$id) {
    throw new Rejected('not_found', 'That request no longer exists.');
  }
  return doc;
}

export async function request({ databases, user, body }) {
  const checked = validateRequest(body);
  if (checked.error) throw new Rejected(checked.error.code, checked.error.message);
  const v = checked.value;

  // A cap on live requests, so one account cannot flood the NGO's inbox. A
  // failed count must not block a genuine request, so it is not fatal.
  try {
    const live = await databases.listDocuments(DB, COL.plantingRequests, [
      Query.equal('userId', user.$id),
      Query.equal('status', ACTIVE_STATUSES),
      Query.limit(MAX_ACTIVE + 1),
    ]);
    if (live.documents.length >= MAX_ACTIVE) {
      throw new Rejected(
        'too_many_requests',
        `You already have ${MAX_ACTIVE} requests in progress. Wait for a reply or cancel one first.`,
      );
    }
  } catch (e) {
    if (e instanceof Rejected) throw e;
    console.error('planting request cap check failed', e.message);
  }

  const now = nowIso();
  const data = {
    userId: user.$id,
    userName: str(user.name, 128),
    addressLabel: v.addressLabel,
    note: v.note,
    status: 'open',
    createdAt: now,
    updatedAt: now,
  };
  if (v.lat !== null) {
    data.lat = v.lat;
    data.lng = v.lng;
    data.geohash = geohash(v.lat, v.lng);
  }
  if (v.preferredFrom) data.preferredFrom = v.preferredFrom;
  if (v.preferredTo) data.preferredTo = v.preferredTo;

  const doc = await databases.createDocument(
    DB,
    COL.plantingRequests,
    ID.unique(),
    data,
    // Readable by its author so the app can show the NGO's reply back.
    [Permission.read(Role.user(user.$id))],
  );

  await notify(databases, {
    userId: user.$id,
    title: 'Request sent',
    body: 'The NGO will reply with a place and a time to plant. We will let you know here.',
    type: 'system',
    refId: doc.$id,
    deepLink: deepLinkFor(doc.$id),
  });

  return { request: view(doc) };
}

export async function mine({ databases, user }) {
  const res = await databases.listDocuments(DB, COL.plantingRequests, [
    Query.equal('userId', user.$id),
    Query.orderDesc('createdAt'),
    Query.limit(50),
  ]);
  return { requests: res.documents.map(view) };
}

/** Tells the NGO member who answered a request that the member replied. */
async function tellNgo(databases, doc, { title, body }) {
  if (!doc.repliedBy) return;
  await notify(databases, {
    userId: doc.repliedBy,
    title,
    body,
    type: 'system',
    refId: doc.$id,
  });
}

export async function respond({ databases, user, body }) {
  const doc = await loadOwned(databases, user, body.id);

  const answer = str(body.response, 16);
  if (answer !== 'accept' && answer !== 'decline') {
    throw new Rejected('bad_request', 'Say whether you will come or not.');
  }

  const status = transition(doc.status, answer);
  const now = nowIso();
  const updated = await databases.updateDocument(DB, COL.plantingRequests, doc.$id, {
    status,
    userResponse: answer === 'accept' ? 'accepted' : 'declined',
    respondedAt: now,
    updatedAt: now,
  });

  const who = doc.userName || 'A member';
  await tellNgo(databases, doc, {
    title: answer === 'accept' ? 'Planting confirmed' : 'Planting declined',
    body:
      answer === 'accept'
        ? `${who} confirmed the planting at ${doc.siteAddress}.`
        : `${who} cannot make that slot. Propose another time from the dashboard.`,
  });

  return { request: view(updated) };
}

export async function cancel({ databases, user, body }) {
  const doc = await loadOwned(databases, user, body.id);
  const status = transition(doc.status, 'cancel');

  const updated = await databases.updateDocument(DB, COL.plantingRequests, doc.$id, {
    status,
    updatedAt: nowIso(),
  });

  await tellNgo(databases, doc, {
    title: 'Request cancelled',
    body: `${doc.userName || 'A member'} cancelled their planting request.`,
  });

  return { request: view(updated) };
}

export const PLANTING_ROUTES = {
  '/planting/request': request,
  '/planting/mine': mine,
  '/planting/respond': respond,
  '/planting/cancel': cancel,
};

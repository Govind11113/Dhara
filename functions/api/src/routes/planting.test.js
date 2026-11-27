import test from 'node:test';
import assert from 'node:assert/strict';

import { request, mine, respond, cancel } from './planting.js';
import { requests, reply, complete, whoami } from './ngo.js';
import { Rejected } from '../lib/context.js';

// A small in-memory Appwrite: just what these routes touch.
function fakeDb() {
  const cols = {};
  const col = (c) => (cols[c] ??= new Map());
  const err = (code, message) => Object.assign(new Error(message), { code });
  let n = 0;
  let clock = 0;

  return {
    rows: (c) => [...col(c).values()],
    getDocument: async (_db, c, id) => {
      const d = col(c).get(id);
      if (!d) throw err(404, 'not found');
      return { ...d };
    },
    createDocument: async (_db, c, id, data, permissions) => {
      const realId = id === 'unique()' ? `doc${++n}` : id;
      const doc = { $id: realId, $seq: ++clock, $permissions: permissions, ...data };
      col(c).set(realId, doc);
      return { ...doc };
    },
    updateDocument: async (_db, c, id, patch) => {
      const d = col(c).get(id);
      if (!d) throw err(404, 'not found');
      Object.assign(d, patch);
      return { ...d };
    },
    listDocuments: async (_db, c, queries = []) => {
      let docs = [...col(c).values()].sort((a, b) => b.$seq - a.$seq);
      let limit = 100;
      let after = null;
      for (const q of queries) {
        const j = JSON.parse(String(q));
        if (j.method === 'equal') docs = docs.filter((d) => j.values.includes(d[j.attribute]));
        if (j.method === 'limit') limit = j.values[0];
        if (j.method === 'cursorAfter') after = j.values[0];
      }
      if (after) {
        const i = docs.findIndex((d) => d.$id === after);
        docs = docs.slice(i + 1);
      }
      return { documents: docs.slice(0, limit).map((d) => ({ ...d })), total: docs.length };
    },
  };
}

const asha = { $id: 'u-asha', name: 'Asha', email: 'asha@example.com', labels: [] };
const ravi = { $id: 'u-ravi', name: 'Ravi', email: 'ravi@example.com', labels: [] };
const ngo = { $id: 'u-ngo', name: 'Greens Trust', email: 'team@greens.org', labels: ['ngo'] };

const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();

const place = { lat: 12.97, lng: 77.59, addressLabel: 'Indiranagar', note: 'Near the lake' };
const slot = (id, extra = {}) => ({
  id,
  siteAddress: 'Cubbon Park bandstand',
  siteLat: 12.976,
  siteLng: 77.592,
  meetingAt: inDays(3),
  meetingPoint: 'Main gate',
  replyNotes: 'Bring water',
  ...extra,
});

const make = async (db, user = asha, body = place) =>
  (await request({ databases: db, user, body })).request;

const notesFor = (db, userId) => db.rows('notifications').filter((x) => x.userId === userId);

// --- member: request / mine --------------------------------------------------

test('a valid request is stored open, owned by the caller, and readable by them', async () => {
  const db = fakeDb();
  const out = await make(db);
  assert.equal(out.status, 'open');
  assert.equal(out.userName, 'Asha');

  const [row] = db.rows('planting_requests');
  assert.equal(row.userId, 'u-asha');
  assert.ok(row.geohash);
  assert.deepEqual(row.$permissions, ['read("user:u-asha")']);
  // The caller cannot choose their own status or write the NGO's half.
  assert.equal(row.siteAddress, undefined);
});

test('a client cannot smuggle in a status or an owner', async () => {
  const db = fakeDb();
  await request({
    databases: db,
    user: asha,
    body: { ...place, status: 'confirmed', userId: 'someone-else', siteAddress: 'x' },
  });
  const [row] = db.rows('planting_requests');
  assert.equal(row.status, 'open');
  assert.equal(row.userId, 'u-asha');
  assert.equal(row.siteAddress, undefined);
});

test('an invalid request is rejected with the validation code', async () => {
  await assert.rejects(
    request({ databases: fakeDb(), user: asha, body: {} }),
    (e) => e instanceof Rejected && e.code === 'location_required',
  );
});

test('a fourth live request is refused, a finished one frees a slot', async () => {
  const db = fakeDb();
  const a = await make(db);
  await make(db);
  await make(db);
  await assert.rejects(
    make(db),
    (e) => e instanceof Rejected && e.code === 'too_many_requests',
  );

  await cancel({ databases: db, user: asha, body: { id: a.id } });
  await make(db);
  assert.equal(db.rows('planting_requests').length, 4);
});

test('the cap is per member', async () => {
  const db = fakeDb();
  await make(db);
  await make(db);
  await make(db);
  await make(db, ravi);
  assert.equal(db.rows('planting_requests').filter((r) => r.userId === 'u-ravi').length, 1);
});

test('mine lists only the caller\'s requests', async () => {
  const db = fakeDb();
  await make(db, asha);
  await make(db, ravi);
  await make(db, asha);
  const out = await mine({ databases: db, user: asha });
  assert.equal(out.requests.length, 2);
  for (const r of out.requests) assert.equal(r.userName, 'Asha');
});

// --- NGO: inbox --------------------------------------------------------------

test('the NGO inbox shows every member\'s requests, filtered by status', async () => {
  const db = fakeDb();
  const a = await make(db, asha);
  await make(db, ravi);
  await reply({ databases: db, user: ngo, body: slot(a.id) });

  const all = await requests({ databases: db, body: {} });
  assert.equal(all.requests.length, 2);

  const open = await requests({ databases: db, body: { status: 'open' } });
  assert.equal(open.requests.length, 1);
  assert.equal(open.requests[0].userName, 'Ravi');
});

test('the inbox never exposes account ids', async () => {
  const db = fakeDb();
  const a = await make(db);
  await reply({ databases: db, user: ngo, body: slot(a.id) });
  const { requests: list } = await requests({ databases: db, body: {} });
  assert.equal('userId' in list[0], false);
  assert.equal('repliedBy' in list[0], false);
  assert.equal('$permissions' in list[0], false);
});

test('the inbox pages with a cursor', async () => {
  const db = fakeDb();
  for (let i = 0; i < 3; i++) {
    await make(db, { ...asha, $id: `u${i}` });
  }
  const first = await requests({ databases: db, body: { limit: 2 } });
  assert.equal(first.requests.length, 2);
  assert.ok(first.nextCursor);
  const second = await requests({ databases: db, body: { limit: 2, cursor: first.nextCursor } });
  assert.equal(second.requests.length, 1);
  assert.equal(second.nextCursor, null);
});

test('an unknown status filter is refused', async () => {
  await assert.rejects(
    requests({ databases: fakeDb(), body: { status: 'bogus' } }),
    (e) => e instanceof Rejected && e.code === 'bad_request',
  );
});

test('whoami says who the NGO caller is', async () => {
  const out = await whoami({ user: ngo });
  assert.equal(out.role, 'ngo');
  assert.equal(out.email, 'team@greens.org');
});

// --- NGO reply ---------------------------------------------------------------

test('a reply schedules the request, notifies the member and is audited', async () => {
  const db = fakeDb();
  const a = await make(db);
  const out = await reply({ databases: db, user: ngo, body: slot(a.id) });

  assert.equal(out.request.status, 'scheduled');
  assert.equal(out.request.meetingPoint, 'Main gate');
  assert.equal(out.request.siteAddress, 'Cubbon Park bandstand');

  const notes = notesFor(db, 'u-asha').filter((x) => x.title === 'A planting place is ready');
  assert.equal(notes.length, 1);
  assert.equal(notes[0].deepLink, `/planting/${a.id}`);

  const [audit] = db.rows('admin_actions');
  assert.equal(audit.action, 'planting.reply');
  assert.equal(audit.adminId, 'u-ngo');
  assert.equal(audit.targetId, a.id);
});

test('a reply with a past time or missing site changes nothing', async () => {
  const db = fakeDb();
  const a = await make(db);
  await assert.rejects(
    reply({ databases: db, user: ngo, body: slot(a.id, { meetingAt: inDays(-1) }) }),
    (e) => e.code === 'invalid_time',
  );
  await assert.rejects(
    reply({ databases: db, user: ngo, body: slot(a.id, { siteAddress: '' }) }),
    (e) => e.code === 'site_required',
  );
  assert.equal(db.rows('planting_requests')[0].status, 'open');
  assert.equal(db.rows('admin_actions').length, 0);
});

test('replying to a missing request is not found', async () => {
  await assert.rejects(
    reply({ databases: fakeDb(), user: ngo, body: slot('nope') }),
    (e) => e.code === 'not_found',
  );
});

// --- member: respond ---------------------------------------------------------

test('the member can confirm a scheduled request, and the NGO is told', async () => {
  const db = fakeDb();
  const a = await make(db);
  await reply({ databases: db, user: ngo, body: slot(a.id) });

  const out = await respond({ databases: db, user: asha, body: { id: a.id, response: 'accept' } });
  assert.equal(out.request.status, 'confirmed');
  assert.equal(out.request.userResponse, 'accepted');

  const told = notesFor(db, 'u-ngo');
  assert.equal(told.length, 1);
  assert.equal(told[0].title, 'Planting confirmed');
});

test('a request that was not replied to cannot be answered', async () => {
  const db = fakeDb();
  const a = await make(db);
  await assert.rejects(
    respond({ databases: db, user: asha, body: { id: a.id, response: 'accept' } }),
    (e) => e.code === 'invalid_state',
  );
});

test('only accept or decline are understood', async () => {
  const db = fakeDb();
  const a = await make(db);
  await reply({ databases: db, user: ngo, body: slot(a.id) });
  await assert.rejects(
    respond({ databases: db, user: asha, body: { id: a.id, response: 'maybe' } }),
    (e) => e.code === 'bad_request',
  );
});

test('another member cannot answer or cancel someone else\'s request', async () => {
  const db = fakeDb();
  const a = await make(db, asha);
  await reply({ databases: db, user: ngo, body: slot(a.id) });

  await assert.rejects(
    respond({ databases: db, user: ravi, body: { id: a.id, response: 'accept' } }),
    (e) => e.code === 'not_found',
  );
  await assert.rejects(
    cancel({ databases: db, user: ravi, body: { id: a.id } }),
    (e) => e.code === 'not_found',
  );
  assert.equal(db.rows('planting_requests')[0].status, 'scheduled');
});

test('a decline can be answered with a new slot, which resets the answer', async () => {
  const db = fakeDb();
  const a = await make(db);
  await reply({ databases: db, user: ngo, body: slot(a.id) });

  const declined = await respond({ databases: db, user: asha, body: { id: a.id, response: 'decline' } });
  assert.equal(declined.request.status, 'declined');
  assert.equal(declined.request.userResponse, 'declined');

  const again = await reply({
    databases: db,
    user: ngo,
    body: slot(a.id, { meetingAt: inDays(6), meetingPoint: 'Side gate' }),
  });
  assert.equal(again.request.status, 'scheduled');
  assert.equal(again.request.meetingPoint, 'Side gate');
  assert.equal(again.request.userResponse, '');

  const titles = notesFor(db, 'u-asha').map((x) => x.title);
  assert.ok(titles.includes('New planting time proposed'));
  assert.ok(db.rows('admin_actions').some((x) => x.action === 'planting.reschedule'));
});

// --- complete / cancel -------------------------------------------------------

test('only a confirmed request can be completed', async () => {
  const db = fakeDb();
  const a = await make(db);
  await assert.rejects(
    complete({ databases: db, user: ngo, body: { id: a.id } }),
    (e) => e.code === 'invalid_state',
  );

  await reply({ databases: db, user: ngo, body: slot(a.id) });
  await assert.rejects(
    complete({ databases: db, user: ngo, body: { id: a.id } }),
    (e) => e.code === 'invalid_state',
  );

  await respond({ databases: db, user: asha, body: { id: a.id, response: 'accept' } });
  const done = await complete({ databases: db, user: ngo, body: { id: a.id } });
  assert.equal(done.request.status, 'completed');
  assert.ok(db.rows('admin_actions').some((x) => x.action === 'planting.complete'));
});

test('a member can cancel before confirming, but not after', async () => {
  const db = fakeDb();
  const a = await make(db);
  const out = await cancel({ databases: db, user: asha, body: { id: a.id } });
  assert.equal(out.request.status, 'cancelled');

  const b = await make(db);
  await reply({ databases: db, user: ngo, body: slot(b.id) });
  await respond({ databases: db, user: asha, body: { id: b.id, response: 'accept' } });
  await assert.rejects(
    cancel({ databases: db, user: asha, body: { id: b.id } }),
    (e) => e.code === 'invalid_state',
  );
});

test('a cancelled request can no longer be replied to', async () => {
  const db = fakeDb();
  const a = await make(db);
  await cancel({ databases: db, user: asha, body: { id: a.id } });
  await assert.rejects(
    reply({ databases: db, user: ngo, body: slot(a.id) }),
    (e) => e.code === 'invalid_state',
  );
});

test('the full journey ends completed with a notification at each step', async () => {
  const db = fakeDb();
  const a = await make(db);
  await reply({ databases: db, user: ngo, body: slot(a.id) });
  await respond({ databases: db, user: asha, body: { id: a.id, response: 'accept' } });
  await complete({ databases: db, user: ngo, body: { id: a.id } });

  assert.equal(db.rows('planting_requests')[0].status, 'completed');
  // Member: request sent, place ready, planting complete. NGO: confirmed.
  assert.equal(notesFor(db, 'u-asha').length, 3);
  assert.equal(notesFor(db, 'u-ngo').length, 1);
});

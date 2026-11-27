/**
 * Live check of the planting-request flow and its access rules.
 *
 *   cd scripts && node e2e_planting.mjs
 *
 * Creates two throwaway accounts, a member and an NGO account (JWTs minted with
 * the server key), and walks a request through the whole journey:
 * request -> reply -> decline -> new slot -> confirm -> complete. It also checks
 * that a member cannot reach /ngo/, that an NGO account cannot reach /admin/,
 * and that nobody can answer someone else's request. Everything it creates is
 * deleted at the end, including on failure. No real account is touched.
 */
import { config } from 'dotenv';
config({ path: new URL('../.env', import.meta.url).pathname });

import { Client, Databases, ExecutionMethod, Functions, ID, Query, Users } from 'node-appwrite';

const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY } = process.env;
const DB = 'dhara';

const client = new Client().setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID).setKey(APPWRITE_API_KEY);
const users = new Users(client);
const db = new Databases(client);
const functions = new Functions(client);

let failures = 0;
const ok = (m) => console.log(`  \u001b[32m✔\u001b[0m ${m}`);
const bad = (m) => { console.log(`  \u001b[31m✖\u001b[0m ${m}`); failures++; };
const check = (c, p, f) => (c ? ok(p) : bad(f));

const startedAt = new Date().toISOString();
const memberId = ID.unique();
const otherId = ID.unique();
const ngoId = ID.unique();
const requestIds = [];

async function call(jwt, path, body = {}) {
  const e = await functions.createExecution(
    'api', JSON.stringify(body), false, path, ExecutionMethod.POST,
    { 'x-dhara-jwt': jwt, 'content-type': 'application/json' },
  );
  try { return JSON.parse(e.responseBody); } catch { return { ok: false, error: { code: 'unparseable', message: e.responseBody.slice(0, 160) } }; }
}

const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();
const codeOf = (r) => r?.error?.code;

async function makeUser(id, label, labels = []) {
  await users.create(id, `e2e-${label}-${Date.now()}@dhara.invalid`, undefined, `Pw-${ID.unique()}-x9!`, `E2E ${label}`);
  if (labels.length) await users.updateLabels(id, labels);
  return (await users.createJWT(id, undefined, 900)).jwt;
}

async function cleanup() {
  console.log('\nCleaning up');
  for (const id of requestIds) await db.deleteDocument(DB, 'planting_requests', id).catch(() => {});
  for (const uid of [memberId, otherId, ngoId]) {
    const r = await db.listDocuments(DB, 'notifications', [Query.equal('userId', uid), Query.limit(100)]).catch(() => null);
    for (const d of r?.documents ?? []) await db.deleteDocument(DB, 'notifications', d.$id).catch(() => {});
    await db.deleteDocument(DB, 'profiles', uid).catch(() => {});
    await users.delete(uid).catch(() => {});
  }
  const audit = await db.listDocuments(DB, 'admin_actions', [Query.equal('adminId', ngoId), Query.limit(100)]).catch(() => null);
  for (const d of audit?.documents ?? []) await db.deleteDocument(DB, 'admin_actions', d.$id).catch(() => {});
  console.log('  - throwaway accounts, requests, notifications and audit rows removed');
}

async function main() {
  console.log('Live planting requests\n');

  const memberJwt = await makeUser(memberId, 'member');
  const otherJwt = await makeUser(otherId, 'other');
  const ngoJwt = await makeUser(ngoId, 'ngo', ['ngo']);

  // --- Access ----------------------------------------------------------------
  console.log('Access');
  const asMember = await call(memberJwt, '/ngo/requests');
  check(codeOf(asMember) === 'forbidden', 'a member cannot open the NGO inbox', `member on /ngo/requests: ${JSON.stringify(asMember).slice(0, 140)}`);

  const ngoWho = await call(ngoJwt, '/ngo/whoami');
  check(ngoWho.ok && ngoWho.data.role === 'ngo', 'an NGO account can open the NGO area', `ngo whoami: ${JSON.stringify(ngoWho.error)}`);

  const ngoAdmin = await call(ngoJwt, '/admin/whoami');
  check(codeOf(ngoAdmin) === 'forbidden', 'an NGO account cannot open the admin area', `ngo on /admin/whoami: ${JSON.stringify(ngoAdmin).slice(0, 140)}`);
  const ngoStats = await call(ngoJwt, '/admin/stats');
  check(codeOf(ngoStats) === 'forbidden', 'an NGO account cannot read admin stats', `ngo on /admin/stats: ${JSON.stringify(ngoStats).slice(0, 140)}`);

  // --- Request ---------------------------------------------------------------
  console.log('\nMember requests a place');
  const bare = await call(memberJwt, '/planting/request', {});
  check(codeOf(bare) === 'location_required', 'a request with no place is refused', `bare request: ${JSON.stringify(bare).slice(0, 140)}`);

  const made = await call(memberJwt, '/planting/request', {
    lat: 12.9716, lng: 77.5946, addressLabel: 'Indiranagar, Bengaluru',
    note: 'Near the lake', preferredFrom: inDays(1), preferredTo: inDays(14),
  });
  check(made.ok && made.data.request.status === 'open', 'request stored as open', `request: ${JSON.stringify(made.error)}`);
  const id = made.data?.request?.id;
  if (id) requestIds.push(id);
  if (!id) return;

  check(!('userId' in made.data.request), 'the response carries no account ids', 'userId leaked in the response');

  const mine = await call(memberJwt, '/planting/mine');
  check(mine.ok && mine.data.requests.some((r) => r.id === id), 'it appears in the member\'s list', `mine: ${JSON.stringify(mine.error)}`);
  const otherMine = await call(otherJwt, '/planting/mine');
  check(otherMine.ok && otherMine.data.requests.length === 0, 'another member does not see it', 'another member saw the request');

  // The owner can read their own document directly; nobody else can.
  const stored = await db.getDocument(DB, 'planting_requests', id);
  check(stored.$permissions.some((p) => p.includes(`user:${memberId}`)), 'the member holds a read grant on it', `permissions: ${stored.$permissions}`);
  check(!stored.$permissions.some((p) => p.includes('any') || p.includes('users')), 'no wider read grant exists', `permissions too wide: ${stored.$permissions}`);

  // --- Inbox -----------------------------------------------------------------
  console.log('\nNGO inbox');
  const inbox = await call(ngoJwt, '/ngo/requests', { status: 'open' });
  check(inbox.ok && inbox.data.requests.some((r) => r.id === id), 'the NGO sees the open request', `inbox: ${JSON.stringify(inbox.error)}`);
  check(inbox.data.requests.every((r) => !('userId' in r)), 'the inbox shows no account ids', 'userId leaked in the inbox');

  // --- Reply -----------------------------------------------------------------
  console.log('\nNGO replies');
  const slot1 = {
    id, siteAddress: 'Cubbon Park, near the bandstand', siteLat: 12.976, siteLng: 77.592,
    meetingAt: inDays(5), meetingPoint: 'Main gate', replyNotes: 'Bring water',
  };
  const pastReply = await call(ngoJwt, '/ngo/reply', { ...slot1, meetingAt: inDays(-1) });
  check(codeOf(pastReply) === 'invalid_time', 'a meeting time in the past is refused', `past reply: ${JSON.stringify(pastReply).slice(0, 140)}`);

  const reply = await call(ngoJwt, '/ngo/reply', slot1);
  check(reply.ok && reply.data.request.status === 'scheduled', 'request is now scheduled', `reply: ${JSON.stringify(reply.error)}`);

  const early = await call(ngoJwt, '/ngo/complete', { id });
  check(codeOf(early) === 'invalid_state', 'it cannot be completed before the member confirms', `early complete: ${JSON.stringify(early).slice(0, 140)}`);

  let notes = (await db.listDocuments(DB, 'notifications', [Query.equal('userId', memberId), Query.limit(50)])).documents;
  check(notes.some((n) => n.title === 'A planting place is ready' && n.deepLink === `/planting/${id}`), 'the member was notified, with a link', 'no reply notification');

  // --- Member answers --------------------------------------------------------
  console.log('\nMember answers');
  const stranger = await call(otherJwt, '/planting/respond', { id, response: 'accept' });
  check(codeOf(stranger) === 'not_found', 'another member cannot answer it', `stranger respond: ${JSON.stringify(stranger).slice(0, 140)}`);

  const decline = await call(memberJwt, '/planting/respond', { id, response: 'decline' });
  check(decline.ok && decline.data.request.status === 'declined', 'member declines the slot', `decline: ${JSON.stringify(decline.error)}`);

  const again = await call(memberJwt, '/planting/respond', { id, response: 'accept' });
  check(codeOf(again) === 'invalid_state', 'a declined slot cannot be accepted afterwards', `accept after decline: ${JSON.stringify(again).slice(0, 140)}`);

  const slot2 = await call(ngoJwt, '/ngo/reply', { ...slot1, meetingAt: inDays(8), meetingPoint: 'Side gate' });
  check(slot2.ok && slot2.data.request.status === 'scheduled' && slot2.data.request.meetingPoint === 'Side gate' && !slot2.data.request.userResponse,
    'NGO proposes a new slot and the old answer is cleared', `reschedule: ${JSON.stringify(slot2.error ?? slot2.data)}`);

  const accept = await call(memberJwt, '/planting/respond', { id, response: 'accept' });
  check(accept.ok && accept.data.request.status === 'confirmed', 'member confirms the new slot', `accept: ${JSON.stringify(accept.error)}`);

  const cancelConfirmed = await call(memberJwt, '/planting/cancel', { id });
  check(codeOf(cancelConfirmed) === 'invalid_state', 'a confirmed request cannot be cancelled from the app', `cancel confirmed: ${JSON.stringify(cancelConfirmed).slice(0, 140)}`);

  notes = (await db.listDocuments(DB, 'notifications', [Query.equal('userId', ngoId), Query.limit(50)])).documents;
  check(notes.some((n) => n.title === 'Planting declined') && notes.some((n) => n.title === 'Planting confirmed'),
    'the NGO was told about the decline and the confirmation', `NGO notifications: ${notes.map((n) => n.title).join(', ')}`);

  // --- Complete --------------------------------------------------------------
  console.log('\nCompletion');
  const done = await call(ngoJwt, '/ngo/complete', { id });
  check(done.ok && done.data.request.status === 'completed', 'NGO marks it completed', `complete: ${JSON.stringify(done.error)}`);
  const afterDone = await call(memberJwt, '/planting/cancel', { id });
  check(codeOf(afterDone) === 'invalid_state', 'a completed request cannot be changed', `cancel completed: ${JSON.stringify(afterDone).slice(0, 140)}`);

  const audit = (await db.listDocuments(DB, 'admin_actions', [Query.equal('adminId', ngoId), Query.greaterThan('createdAt', startedAt), Query.limit(50)])).documents;
  const actions = audit.map((a) => a.action).sort();
  check(['planting.complete', 'planting.reply', 'planting.reschedule'].every((a) => actions.includes(a)),
    'every NGO action is in the audit log', `audit actions: ${actions.join(', ') || 'none'}`);

  // --- Cap -------------------------------------------------------------------
  console.log('\nLimit on live requests');
  const extra = [];
  for (let i = 0; i < 4; i++) {
    const r = await call(otherJwt, '/planting/request', { addressLabel: `Somewhere ${i}` });
    if (r.ok) { extra.push(r.data.request.id); requestIds.push(r.data.request.id); }
    else if (i === 3) check(codeOf(r) === 'too_many_requests', 'a fourth live request is refused', `fourth request: ${JSON.stringify(r).slice(0, 140)}`);
  }
  check(extra.length === 3, 'three live requests were accepted', `accepted ${extra.length}`);
  const freed = await call(otherJwt, '/planting/cancel', { id: extra[0] });
  const fifth = await call(otherJwt, '/planting/request', { addressLabel: 'Somewhere else' });
  if (fifth.ok) requestIds.push(fifth.data.request.id);
  check(freed.ok && fifth.ok, 'cancelling one frees a slot', `after cancel: ${JSON.stringify(fifth.error)}`);
}

try {
  await main();
} catch (e) {
  bad(`unexpected error: ${String(e.message).replace(APPWRITE_API_KEY, '[key]')}`);
} finally {
  await cleanup();
}
console.log(failures ? `\n\u001b[31m${failures} check(s) failed\u001b[0m` : '\n\u001b[32mAll checks passed\u001b[0m');
process.exit(failures ? 1 : 0);

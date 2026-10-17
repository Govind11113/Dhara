/**
 * Live check of the /admin/ write routes.
 *
 *   cd scripts && node e2e_admin_write.mjs <admin-email>
 *
 * Acts as the real admin account (JWT minted with the server key) against a
 * throwaway user and synthetic records, so no real submission is touched. Also
 * flips one config value and puts it back. Everything created is deleted at the
 * end, including on failure.
 */
import { config } from 'dotenv';
config({ path: new URL('../.env', import.meta.url).pathname });

import { Client, Databases, ExecutionMethod, Functions, ID, Query, Users } from 'node-appwrite';

const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY } = process.env;
// The admin account is passed in, never written into the repo: it is the login
// for the admin panel.
const ADMIN_EMAIL = process.argv[2] || process.env.ADMIN_EMAIL;
if (!ADMIN_EMAIL) {
  console.error('Usage: node %s <admin-email>   (or set ADMIN_EMAIL)', process.argv[1].split('/').pop());
  process.exit(1);
}
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
const uid = ID.unique();
const treeId = ID.unique();
const verId = ID.unique();
const rdId = ID.unique();
const fbId = { value: null };
let configRestore = null;

async function call(jwt, path, body = {}) {
  const e = await functions.createExecution(
    'api', JSON.stringify(body), false, path, ExecutionMethod.POST,
    { 'x-dhara-jwt': jwt, 'content-type': 'application/json' },
  );
  try { return JSON.parse(e.responseBody); } catch { return { ok: false, error: { code: 'unparseable', message: e.responseBody.slice(0, 160) } }; }
}

const profile = async () => db.getDocument(DB, 'profiles', uid);
const ledger = async () => (await db.listDocuments(DB, 'credit_ledger', [Query.equal('userId', uid), Query.limit(50)])).documents;
const auditFor = async (action) =>
  (await db.listDocuments(DB, 'admin_actions', [Query.equal('action', action), Query.greaterThan('createdAt', startedAt), Query.limit(50)])).documents;

async function cleanup() {
  console.log('\nCleaning up');
  if (configRestore) {
    await call(configRestore.jwt, '/admin/config/set', { key: configRestore.key, value: configRestore.value }).catch(() => {});
    console.log(`  - config ${configRestore.key} restored to "${configRestore.value}"`);
  }
  const sweep = async (col, field) => {
    for (let i = 0; i < 5; i++) {
      const r = await db.listDocuments(DB, col, [Query.equal(field, uid), Query.limit(100)]).catch(() => null);
      if (!r || !r.documents.length) break;
      for (const d of r.documents) await db.deleteDocument(DB, col, d.$id).catch(() => {});
    }
  };
  for (const [c, f] of [['trees', 'ownerId'], ['tree_verifications', 'userId'], ['redemptions', 'userId'],
    ['credit_ledger', 'userId'], ['notifications', 'userId'], ['feedback', 'userId'], ['fraud_flags', 'userId']]) await sweep(c, f);
  // Audit rows this run created, found by the ids it made up.
  for (const target of [treeId, verId, rdId, uid, fbId.value].filter(Boolean)) {
    const r = await db.listDocuments(DB, 'admin_actions', [Query.equal('targetId', target), Query.limit(50)]).catch(() => null);
    for (const d of r?.documents ?? []) await db.deleteDocument(DB, 'admin_actions', d.$id).catch(() => {});
  }
  const cfg = await db.listDocuments(DB, 'admin_actions', [Query.equal('action', 'config.set'), Query.greaterThan('createdAt', startedAt), Query.limit(20)]).catch(() => null);
  for (const d of cfg?.documents ?? []) await db.deleteDocument(DB, 'admin_actions', d.$id).catch(() => {});
  await db.deleteDocument(DB, 'profiles', uid).catch(() => {});
  await users.delete(uid).catch(() => {});
  console.log('  - throwaway user, records and this run\'s audit rows removed');
}

async function main() {
  console.log('Live admin write routes\n');

  const admin = (await users.list([Query.equal('email', ADMIN_EMAIL), Query.limit(1)])).users[0];
  if (!admin) { bad(`no account for ${ADMIN_EMAIL}`); return; }
  const adminJwt = (await users.createJWT(admin.$id, undefined, 900)).jwt;

  await users.create(uid, `e2e-${Date.now()}@dhara.invalid`, undefined, `Pw-${ID.unique()}-x9!`, 'E2E Member');
  const userJwt = (await users.createJWT(uid, undefined, 900)).jwt;
  const boot = await call(userJwt, '/profile/bootstrap', { name: 'E2E Member' });
  check(boot.ok, 'throwaway member created', `bootstrap: ${JSON.stringify(boot.error)}`);
  await db.updateDocument(DB, 'profiles', uid, { treesPlanted: 1 });

  const now = new Date().toISOString();
  const month = now.slice(0, 7);

  // --- Tree review -----------------------------------------------------------
  console.log('\nTree review');
  await db.createDocument(DB, 'trees', treeId, {
    ownerId: uid, speciesCode: 'neem', speciesName: 'Neem', nickname: 'e2e tree',
    lat: 12.97, lng: 77.59, geohash: 'tdr1vxxxx', accuracyM: 5, plantPhotoFileId: 'none',
    plantedAt: now, status: 'pending_review', rejectReason: 'held for the test', markerCode: `E2E-${Date.now()}`,
  });
  const q = await call(adminJwt, '/admin/queue');
  check(q.data?.items?.some((i) => i.id === treeId), 'held tree appears in the review queue', 'held tree missing from the queue');

  const approve = await call(adminJwt, '/admin/review/decide', { kind: 'tree', id: treeId, decision: 'approve' });
  check(approve.ok && approve.data.credits === 5, `approved, ${approve.data?.credits} credits`, `approve failed: ${JSON.stringify(approve.error)}`);
  check((await db.getDocument(DB, 'trees', treeId)).status === 'alive', 'tree is now alive', 'tree not alive');
  const p1 = await profile();
  check(p1.creditsAvailable === 5 && p1.treesAlive === 1, `balance ${p1.creditsAvailable}, trees alive ${p1.treesAlive}`, `profile wrong: ${p1.creditsAvailable}/${p1.treesAlive}`);

  const again = await call(adminJwt, '/admin/review/decide', { kind: 'tree', id: treeId, decision: 'approve' });
  check(again.error?.code === 'already_decided', 'approving again is refused', `second approve: ${JSON.stringify(again).slice(0, 140)}`);
  check((await ledger()).length === 1 && (await profile()).creditsAvailable === 5, 'credits were paid exactly once', 'credits were paid more than once');
  check((await auditFor('review.approve')).some((a) => a.targetId === treeId && a.adminId === admin.$id), 'approval is in the audit log with the admin id', 'no audit row for the approval');

  // --- Check-in review -------------------------------------------------------
  console.log('\nCheck-in review');
  await db.createDocument(DB, 'tree_verifications', verId, {
    treeId, userId: uid, monthKey: month, photoFileId: 'none', lat: 12.97, lng: 77.59,
    accuracyM: 5, distanceM: 4, status: 'manual_review', rejectReason: 'held for the test', verifiedAt: now,
  });
  const v = await call(adminJwt, '/admin/review/decide', { kind: 'verification', id: verId, decision: 'approve' });
  check(v.ok && v.data.credits === 12, `approved, ${v.data?.credits} credits (neem rate)`, `verification approve: ${JSON.stringify(v.error)}`);
  const t2 = await db.getDocument(DB, 'trees', treeId);
  check(t2.verificationCount === 1 && t2.creditsVested === 12, `tree progress ${t2.verificationCount}/12, vested ${t2.creditsVested}`, `tree counters wrong: ${t2.verificationCount}/${t2.creditsVested}`);
  const p2 = await profile();
  check(p2.creditsAvailable === 17 && p2.streakCount === 1, `balance ${p2.creditsAvailable}, streak ${p2.streakCount}`, `profile after check-in: ${p2.creditsAvailable}/${p2.streakCount}`);
  const v2 = await call(adminJwt, '/admin/review/decide', { kind: 'verification', id: verId, decision: 'approve' });
  check(v2.error?.code === 'already_decided' && (await ledger()).length === 2, 'a second approval is refused and pays nothing', 'a check-in was paid twice');

  // --- Redemption refund -----------------------------------------------------
  console.log('\nRedemption refund');
  await db.updateDocument(DB, 'profiles', uid, { creditsSpent: 8 });
  await db.createDocument(DB, 'redemptions', rdId, {
    userId: uid, rewardId: 'none', rewardTitle: 'E2E reward', type: 'movie_voucher',
    creditsSpent: 8, status: 'pending', idempotencyKey: `e2e:${rdId}`, requestedAt: now,
  });
  const before = await profile();
  const rd = await call(adminJwt, '/admin/redemption/update', { id: rdId, status: 'failed', failureReason: 'Partner was out of stock.' });
  check(rd.ok && rd.data.refunded === 8, `failed and refunded ${rd.data?.refunded}`, `redemption: ${JSON.stringify(rd.error)}`);
  const after = await profile();
  check(after.creditsAvailable === before.creditsAvailable + 8, `balance ${before.creditsAvailable} -> ${after.creditsAvailable}`, 'balance did not rise by the refund');
  check(after.creditsLifetime === before.creditsLifetime && after.xp === before.xp, 'lifetime credits and XP unchanged by the refund', `refund inflated lifetime/xp: ${before.creditsLifetime}->${after.creditsLifetime}, ${before.xp}->${after.xp}`);
  const rd2 = await call(adminJwt, '/admin/redemption/update', { id: rdId, status: 'failed', failureReason: 'Again.' });
  check(rd2.error?.code === 'bad_transition', 'a second refund is refused', `second refund: ${JSON.stringify(rd2).slice(0, 140)}`);

  // --- Ban / unban -----------------------------------------------------------
  console.log('\nSuspend and restore');
  const b = await call(adminJwt, '/admin/user/ban', { userId: uid, banned: true, reason: 'End to end test.' });
  check(b.ok && (await profile()).isBanned === true, 'user suspended', `ban: ${JSON.stringify(b.error)}`);
  const ub = await call(adminJwt, '/admin/user/ban', { userId: uid, banned: false });
  check(ub.ok && (await profile()).isBanned === false, 'user restored', `unban: ${JSON.stringify(ub.error)}`);
  const selfBan = await call(adminJwt, '/admin/user/ban', { userId: admin.$id, banned: true, reason: 'Trying to lock myself out.' });
  check(selfBan.error?.code === 'bad_request', 'an administrator cannot be suspended', `admin ban: ${JSON.stringify(selfBan).slice(0, 140)}`);

  // --- Feedback --------------------------------------------------------------
  console.log('\nFeedback reply');
  const fb = await call(userJwt, '/feedback/submit', { category: 'idea', message: 'End to end test of the reply flow.' });
  fbId.value = fb.data?.feedback?.$id;
  check(fb.ok, 'member sent feedback', `feedback: ${JSON.stringify(fb.error)}`);
  const rep = await call(adminJwt, '/admin/feedback/reply', { id: fbId.value, reply: 'Thanks, noted for the next release.' });
  check(rep.ok && rep.data.status === 'answered', 'admin replied', `reply: ${JSON.stringify(rep.error)}`);
  const doc = await db.getDocument(DB, 'feedback', fbId.value);
  check(doc.adminReply === 'Thanks, noted for the next release.' && doc.status === 'answered', 'reply stored on the feedback', 'reply not stored');
  const notes = (await db.listDocuments(DB, 'notifications', [Query.equal('userId', uid), Query.limit(50)])).documents;
  check(notes.some((n) => n.title === 'We replied to your feedback'), 'member was notified', 'no reply notification');

  // --- Config ----------------------------------------------------------------
  console.log('\nConfig');
  const list = await call(adminJwt, '/admin/config/list');
  check(list.ok && list.data.items.length > 10 && list.data.items.every((i) => i.spec), `${list.data?.items?.length} editable settings listed`, `config list: ${JSON.stringify(list.error)}`);
  const cur = list.data.items.find((i) => i.key === 'vision.on_unavailable');
  configRestore = { jwt: adminJwt, key: 'vision.on_unavailable', value: cur.value };
  const flip = cur.value === 'review' ? 'approve' : 'review';
  const set = await call(adminJwt, '/admin/config/set', { key: 'vision.on_unavailable', value: flip });
  check(set.ok && set.data.changed, `vision.on_unavailable ${cur.value} -> ${flip}`, `config set: ${JSON.stringify(set.error)}`);
  const stats = await call(adminJwt, '/admin/stats');
  check(stats.data?.ai?.onUnavailable === flip, 'the change is live (stats reads it back)', `stats shows ${stats.data?.ai?.onUnavailable}`);
  const badKey = await call(adminJwt, '/admin/config/set', { key: 'xp.level_curve', value: '[0]' });
  const badVal = await call(adminJwt, '/admin/config/set', { key: 'tree.plant_credits', value: 100000 });
  check(badKey.error?.code === 'bad_request' && badVal.error?.code === 'bad_request', 'unlisted keys and out-of-range values are refused', 'config validation let something through');
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

import test from 'node:test';
import assert from 'node:assert/strict';

import { WRITE_ROUTES, canMoveRedemption } from './admin_write.js';
import { tally } from '../lib/ledger.js';
import { validateConfigValue, CONFIG_SPEC } from '../lib/config_spec.js';

// ---------------------------------------------------------------------------
// A small in-memory Appwrite. The ledger enforces the same unique index on
// idempotencyKey the real collection has, which is what the "pays once" claims
// depend on.
// ---------------------------------------------------------------------------

function fakeDb(seed = {}) {
  const cols = {};
  for (const [c, docs] of Object.entries(seed)) {
    cols[c] = new Map(docs.map((d) => [d.$id, { ...d }]));
  }
  const col = (c) => (cols[c] ??= new Map());
  const err = (code, message) => Object.assign(new Error(message), { code });
  let n = 0;

  return {
    cols,
    rows: (c) => [...col(c).values()],
    getDocument: async (_db, c, id) => {
      await Promise.resolve();
      const d = col(c).get(id);
      if (!d) throw err(404, `${c}/${id} not found`);
      return { ...d };
    },
    createDocument: async (_db, c, id, data) => {
      await Promise.resolve();
      const realId = id === 'unique()' ? `gen${++n}` : id;
      if (col(c).has(realId)) throw err(409, 'exists');
      if (c === 'credit_ledger') {
        for (const d of col(c).values()) {
          if (d.idempotencyKey === data.idempotencyKey) throw err(409, 'duplicate key');
        }
      }
      const doc = { $id: realId, $createdAt: new Date().toISOString(), ...data };
      col(c).set(realId, doc);
      return { ...doc };
    },
    updateDocument: async (_db, c, id, patch) => {
      await Promise.resolve();
      const d = col(c).get(id);
      if (!d) throw err(404, `${c}/${id} not found`);
      Object.assign(d, patch);
      return { ...d };
    },
    listDocuments: async (_db, c, queries = []) => {
      await Promise.resolve();
      let docs = [...col(c).values()];
      for (const q of queries) {
        const j = JSON.parse(String(q));
        if (j.method === 'equal') docs = docs.filter((d) => j.values.includes(d[j.attribute]));
      }
      return { documents: docs.map((d) => ({ ...d })), total: docs.length };
    },
  };
}

const admin = { $id: 'adm', email: 'admin@example.com', labels: ['admin'] };
const config = {
  'tree.plant_credits': 5,
  'tree.credits_per_verification': 10,
  'xp.level_curve': [0, 100, 250, 500],
};
const users = { get: async () => ({ labels: [] }) };

const profile = (over = {}) => ({
  $id: 'u1',
  userId: 'u1',
  name: 'Asha',
  creditsAvailable: 0,
  creditsLifetime: 0,
  creditsSpent: 0,
  creditsPending: 0,
  xp: 0,
  level: 1,
  treesPlanted: 1,
  treesAlive: 0,
  co2OffsetGrams: 0,
  streakCount: 0,
  longestStreak: 0,
  trustScore: 100,
  isBanned: false,
  ...over,
});

const heldTree = (over = {}) => ({
  $id: 't1',
  ownerId: 'u1',
  status: 'pending_review',
  speciesCode: 'neem',
  speciesName: 'Neem',
  nickname: '',
  verificationCount: 0,
  creditsVested: 0,
  consecutiveMisses: 0,
  ...over,
});

const heldVerification = (over = {}) => ({
  $id: 'v1',
  treeId: 't1',
  userId: 'u1',
  monthKey: '2026-11',
  status: 'manual_review',
  verifiedAt: '2026-11-10T08:00:00.000Z',
  creditsAwarded: 0,
  ...over,
});

const species = [{ $id: 'neem', creditsPerVerification: 12, co2PerYearGrams: 21000 }];

const decide = (db, body) =>
  WRITE_ROUTES['/admin/review/decide']({ databases: db, users, user: admin, body, config });

const ledger = (db) => db.rows('credit_ledger');
const audit = (db) => db.rows('admin_actions');

// ---------------------------------------------------------------------------
// Tree review
// ---------------------------------------------------------------------------

test('approving a held tree pays the plant credits and makes it alive', async () => {
  const db = fakeDb({ profiles: [profile()], trees: [heldTree()] });
  const out = await decide(db, { kind: 'tree', id: 't1', decision: 'approve' });

  assert.equal(out.credits, 5);
  assert.equal(db.cols.trees.get('t1').status, 'alive');
  assert.equal(db.cols.profiles.get('u1').creditsAvailable, 5);
  assert.equal(db.cols.profiles.get('u1').treesAlive, 1);
  // treesPlanted was counted at submission; approval must not count it again.
  assert.equal(db.cols.profiles.get('u1').treesPlanted, 1);
  assert.equal(ledger(db).length, 1);
  assert.equal(ledger(db)[0].idempotencyKey, 'tree_plant:t1');
});

test('approving the same tree twice pays once', async () => {
  const db = fakeDb({ profiles: [profile()], trees: [heldTree()] });
  await decide(db, { kind: 'tree', id: 't1', decision: 'approve' });
  await assert.rejects(
    decide(db, { kind: 'tree', id: 't1', decision: 'approve' }),
    (e) => e.code === 'already_decided',
  );
  assert.equal(ledger(db).length, 1);
  assert.equal(db.cols.profiles.get('u1').creditsAvailable, 5);
});

test('a tree already paid by the normal path is not paid again', async () => {
  const db = fakeDb({
    profiles: [profile({ creditsAvailable: 5, creditsLifetime: 5, xp: 5, treesAlive: 1 })],
    trees: [heldTree()],
    credit_ledger: [{ $id: 'old', userId: 'u1', delta: 5, idempotencyKey: 'tree_plant:t1', source: 'tree_plant' }],
  });
  const out = await decide(db, { kind: 'tree', id: 't1', decision: 'approve' });

  assert.equal(out.credits, 0);
  assert.equal(ledger(db).length, 1);
  assert.equal(db.cols.profiles.get('u1').creditsAvailable, 5);
  // The alive count rode with the payout that already happened.
  assert.equal(db.cols.profiles.get('u1').treesAlive, 1);
  assert.equal(db.cols.trees.get('t1').status, 'alive');
});

test('rejecting a tree pays nothing and keeps the reason', async () => {
  const db = fakeDb({ profiles: [profile()], trees: [heldTree()] });
  await decide(db, { kind: 'tree', id: 't1', decision: 'reject', reason: 'Photo is of a different place.' });

  assert.equal(db.cols.trees.get('t1').status, 'rejected');
  assert.equal(db.cols.trees.get('t1').rejectReason, 'Photo is of a different place.');
  assert.equal(ledger(db).length, 0);
  assert.equal(db.cols.profiles.get('u1').creditsAvailable, 0);
});

test('a rejection without a reason is refused and changes nothing', async () => {
  const db = fakeDb({ profiles: [profile()], trees: [heldTree()] });
  await assert.rejects(
    decide(db, { kind: 'tree', id: 't1', decision: 'reject', reason: ' ' }),
    (e) => e.code === 'reason_required',
  );
  assert.equal(db.cols.trees.get('t1').status, 'pending_review');
});

test('an alive tree cannot be decided', async () => {
  const db = fakeDb({ profiles: [profile()], trees: [heldTree({ status: 'alive' })] });
  await assert.rejects(
    decide(db, { kind: 'tree', id: 't1', decision: 'reject', reason: 'nope nope' }),
    (e) => e.code === 'already_decided',
  );
});

// A banned owner makes award() throw. The tree must stay in the queue so the
// admin can unban and retry, not end up alive-but-unpaid.
test('approving for a suspended user fails and leaves the tree waiting', async () => {
  const db = fakeDb({ profiles: [profile({ isBanned: true })], trees: [heldTree()] });
  await assert.rejects(
    decide(db, { kind: 'tree', id: 't1', decision: 'approve' }),
    (e) => e.code === 'account_suspended',
  );
  assert.equal(db.cols.trees.get('t1').status, 'pending_review');
  assert.equal(ledger(db).length, 0);
});

test('an unknown tree is not found', async () => {
  const db = fakeDb({ profiles: [profile()] });
  await assert.rejects(
    decide(db, { kind: 'tree', id: 'ghost', decision: 'approve' }),
    (e) => e.code === 'not_found',
  );
});

test('bad input is refused before anything is read', async () => {
  const db = fakeDb({});
  await assert.rejects(decide(db, { kind: 'banana', id: 'x', decision: 'approve' }), (e) => e.code === 'bad_request');
  await assert.rejects(decide(db, { kind: 'tree', id: 'x', decision: 'maybe' }), (e) => e.code === 'bad_request');
  await assert.rejects(decide(db, { kind: 'tree', decision: 'approve' }), (e) => e.code === 'bad_request');
});

// ---------------------------------------------------------------------------
// Check-in review
// ---------------------------------------------------------------------------

const verifySeed = (extra = {}) => ({
  profiles: [profile(extra.profile)],
  trees: [heldTree({ status: 'alive', ...extra.tree })],
  tree_verifications: [heldVerification(extra.ver)],
  species,
});

test('approving a check-in pays the species rate and advances the tree', async () => {
  const db = fakeDb(verifySeed());
  const out = await decide(db, { kind: 'verification', id: 'v1', decision: 'approve' });

  assert.equal(out.credits, 12);
  assert.equal(db.cols.tree_verifications.get('v1').status, 'approved');
  assert.equal(db.cols.tree_verifications.get('v1').creditsAwarded, 12);
  assert.equal(db.cols.trees.get('t1').verificationCount, 1);
  assert.equal(db.cols.trees.get('t1').creditsVested, 12);
  assert.equal(db.cols.profiles.get('u1').streakCount, 1);
  assert.equal(ledger(db)[0].idempotencyKey, 'tree_verify:t1:2026-11');
  assert.ok(db.cols.profiles.get('u1').co2OffsetGrams > 0);
});

test('approving a check-in twice pays and counts once', async () => {
  const db = fakeDb(verifySeed());
  await decide(db, { kind: 'verification', id: 'v1', decision: 'approve' });
  await assert.rejects(
    decide(db, { kind: 'verification', id: 'v1', decision: 'approve' }),
    (e) => e.code === 'already_decided',
  );
  assert.equal(ledger(db).length, 1);
  assert.equal(db.cols.trees.get('t1').verificationCount, 1);
});

// Two admins (or one admin and a double click) approving at the same moment:
// both read "waiting", but only the call that actually paid may bump counters.
// The rule behind "pays once": counters and streaks belong to the call that
// actually paid. This is the state a late second approver sees — the payout is
// already in the ledger and the tree already counts it, but the check-in has not
// been flipped yet. It must not count it again.
test('a late approver does not count a check-in that was already paid', async () => {
  const db = fakeDb({
    ...verifySeed({ tree: { verificationCount: 1, creditsVested: 12 } }),
    profiles: [profile({ creditsAvailable: 12, creditsLifetime: 12, xp: 12, streakCount: 1, lastVerifyAt: '2026-11-10T08:00:00.000Z' })],
    credit_ledger: [
      { $id: 'paid', userId: 'u1', delta: 12, idempotencyKey: 'tree_verify:t1:2026-11', source: 'tree_verify' },
    ],
  });

  const out = await decide(db, { kind: 'verification', id: 'v1', decision: 'approve' });

  assert.equal(out.credits, 0);
  assert.equal(ledger(db).length, 1);
  assert.equal(db.cols.trees.get('t1').verificationCount, 1);
  assert.equal(db.cols.trees.get('t1').creditsVested, 12);
  assert.equal(db.cols.profiles.get('u1').streakCount, 1);
  assert.equal(db.cols.profiles.get('u1').creditsAvailable, 12);
  // The check-in is still resolved, so it leaves the queue.
  assert.equal(db.cols.tree_verifications.get('v1').status, 'approved');
});

test('a late approver does not pay a streak bonus twice', async () => {
  const db = fakeDb({
    ...verifySeed({ tree: { verificationCount: 3 } }),
    profiles: [profile({ creditsAvailable: 42, creditsLifetime: 42, streakCount: 3, longestStreak: 3, lastVerifyAt: '2026-11-10T08:00:00.000Z' })],
    credit_ledger: [
      { $id: 'paid', userId: 'u1', delta: 12, idempotencyKey: 'tree_verify:t1:2026-11', source: 'tree_verify' },
      { $id: 'bonus', userId: 'u1', delta: 30, idempotencyKey: 'streak:u1:3', source: 'streak_bonus' },
    ],
  });
  await decide(db, { kind: 'verification', id: 'v1', decision: 'approve' });
  assert.equal(ledger(db).length, 2);
  assert.equal(db.cols.profiles.get('u1').creditsAvailable, 42);
});

test('two simultaneous approvals pay once and count once', async () => {
  const db = fakeDb(verifySeed());
  const results = await Promise.allSettled([
    decide(db, { kind: 'verification', id: 'v1', decision: 'approve' }),
    decide(db, { kind: 'verification', id: 'v1', decision: 'approve' }),
  ]);

  assert.ok(results.some((r) => r.status === 'fulfilled'));
  assert.equal(ledger(db).length, 1);
  assert.equal(db.cols.profiles.get('u1').creditsAvailable, 12);
  assert.equal(db.cols.trees.get('t1').verificationCount, 1);
  assert.equal(db.cols.trees.get('t1').creditsVested, 12);
  assert.equal(db.cols.profiles.get('u1').streakCount, 1);
});

test('an approval that completes a streak pays the bonus once', async () => {
  const db = fakeDb(
    verifySeed({
      profile: { streakCount: 2, longestStreak: 2, lastVerifyAt: '2026-10-12T09:00:00.000Z' },
    }),
  );
  await decide(db, { kind: 'verification', id: 'v1', decision: 'approve' });

  assert.equal(db.cols.profiles.get('u1').streakCount, 3);
  const bonus = ledger(db).filter((r) => r.source === 'streak_bonus');
  assert.equal(bonus.length, 1);
  assert.equal(bonus[0].delta, 30);
  assert.equal(bonus[0].idempotencyKey, 'streak:u1:3');
  assert.equal(db.cols.profiles.get('u1').creditsAvailable, 12 + 30);
});

// The streak is measured from when the user checked in. Approving a month-end
// check-in a week late must not read as a skipped month.
test('streak is measured from the check-in date, not the approval date', async () => {
  const db = fakeDb(
    verifySeed({
      profile: { streakCount: 4, longestStreak: 4, lastVerifyAt: '2026-10-28T09:00:00.000Z' },
      ver: { verifiedAt: '2026-11-03T09:00:00.000Z' },
    }),
  );
  await decide(db, { kind: 'verification', id: 'v1', decision: 'approve' });
  assert.equal(db.cols.profiles.get('u1').streakCount, 5);
  assert.equal(db.cols.profiles.get('u1').lastVerifyAt, '2026-11-03T09:00:00.000Z');
});

test('approving an older check-in never moves the last-verified date backwards', async () => {
  const db = fakeDb(
    verifySeed({
      profile: { streakCount: 5, lastVerifyAt: '2026-12-02T09:00:00.000Z' },
      ver: { verifiedAt: '2026-11-10T09:00:00.000Z' },
    }),
  );
  await decide(db, { kind: 'verification', id: 'v1', decision: 'approve' });
  assert.equal(db.cols.profiles.get('u1').lastVerifyAt, '2026-12-02T09:00:00.000Z');
});

test('rejecting a check-in pays nothing and leaves the tree unchanged', async () => {
  const db = fakeDb(verifySeed());
  await decide(db, { kind: 'verification', id: 'v1', decision: 'reject', reason: 'Not the same tree.' });

  assert.equal(db.cols.tree_verifications.get('v1').status, 'rejected');
  assert.equal(db.cols.tree_verifications.get('v1').creditsAwarded, 0);
  assert.equal(db.cols.trees.get('t1').verificationCount, 0);
  assert.equal(ledger(db).length, 0);
});

test('every decision is audited with who, what and the credits moved', async () => {
  const db = fakeDb(verifySeed());
  await decide(db, { kind: 'verification', id: 'v1', decision: 'approve' });

  assert.equal(audit(db).length, 1);
  const row = audit(db)[0];
  assert.equal(row.adminId, 'adm');
  assert.equal(row.action, 'review.approve');
  assert.equal(row.targetType, 'verification');
  assert.equal(row.targetId, 'v1');
  assert.ok(row.detail.includes('"credits":12'));
});

test('a refused decision leaves no audit row', async () => {
  const db = fakeDb(verifySeed());
  await assert.rejects(decide(db, { kind: 'verification', id: 'v1', decision: 'reject', reason: '' }));
  assert.equal(audit(db).length, 0);
});

// ---------------------------------------------------------------------------
// Redemptions and the ledger
// ---------------------------------------------------------------------------

const redemption = (over = {}) => ({
  $id: 'r1',
  userId: 'u1',
  rewardId: 'rw1',
  rewardTitle: 'Movie ticket',
  type: 'movie_voucher',
  creditsSpent: 60,
  status: 'pending',
  ...over,
});

const redemptionSeed = (p = {}) => ({
  // A user who earned 100, spent 60, and is waiting on the reward.
  profiles: [profile({ creditsAvailable: 40, creditsLifetime: 100, creditsSpent: 60, xp: 100, level: 2, ...p })],
  redemptions: [redemption()],
  rewards: [{ $id: 'rw1', stockRemaining: 3 }],
});

const updateRd = (db, body) =>
  WRITE_ROUTES['/admin/redemption/update']({ databases: db, user: admin, body, config });

test('failing a redemption refunds it without touching lifetime credits or XP', async () => {
  const db = fakeDb(redemptionSeed());
  const out = await updateRd(db, { id: 'r1', status: 'failed', failureReason: 'Partner was out of stock.' });

  const p = db.cols.profiles.get('u1');
  assert.equal(out.refunded, 60);
  assert.equal(p.creditsAvailable, 100);
  assert.equal(p.creditsSpent, 0);
  // A refund is not new income: it must not count as earned or grant XP.
  assert.equal(p.creditsLifetime, 100);
  assert.equal(p.xp, 100);
  assert.equal(p.level, 2);
  assert.equal(ledger(db)[0].source, 'reversal');
  assert.equal(ledger(db)[0].idempotencyKey, 'redeem_refund:r1');
  assert.equal(db.cols.rewards.get('rw1').stockRemaining, 4);
});

test('a redemption is refunded at most once', async () => {
  const db = fakeDb(redemptionSeed());
  await updateRd(db, { id: 'r1', status: 'cancelled', reason: 'User asked to cancel.' });
  await assert.rejects(
    updateRd(db, { id: 'r1', status: 'failed', failureReason: 'Again please' }),
    (e) => e.code === 'bad_transition',
  );
  assert.equal(ledger(db).length, 1);
  assert.equal(db.cols.profiles.get('u1').creditsAvailable, 100);
});

test('a simultaneous double refund still pays once', async () => {
  const db = fakeDb(redemptionSeed());
  await Promise.allSettled([
    updateRd(db, { id: 'r1', status: 'failed', failureReason: 'Out of stock.' }),
    updateRd(db, { id: 'r1', status: 'failed', failureReason: 'Out of stock.' }),
  ]);
  assert.equal(ledger(db).length, 1);
  assert.equal(db.cols.profiles.get('u1').creditsAvailable, 100);
});

test('a refund works for a suspended account', async () => {
  const db = fakeDb(redemptionSeed({ isBanned: true }));
  const out = await updateRd(db, { id: 'r1', status: 'failed', failureReason: 'Account closed.' });
  assert.equal(out.refunded, 60);
});

test('a failure needs a reason the user can read', async () => {
  const db = fakeDb(redemptionSeed());
  await assert.rejects(updateRd(db, { id: 'r1', status: 'failed' }), (e) => e.code === 'reason_required');
  assert.equal(db.cols.redemptions.get('r1').status, 'pending');
  assert.equal(ledger(db).length, 0);
});

test('fulfilling records the code and spends nothing more', async () => {
  const db = fakeDb(redemptionSeed());
  await updateRd(db, { id: 'r1', status: 'fulfilled', voucherCode: 'ABC-123' });
  assert.equal(db.cols.redemptions.get('r1').status, 'fulfilled');
  assert.equal(db.cols.redemptions.get('r1').voucherCode, 'ABC-123');
  assert.ok(db.cols.redemptions.get('r1').fulfilledAt);
  assert.equal(ledger(db).length, 0);
});

test('only forward moves are allowed between redemption states', () => {
  assert.equal(canMoveRedemption('pending', 'processing'), true);
  assert.equal(canMoveRedemption('processing', 'fulfilled'), true);
  assert.equal(canMoveRedemption('pending', 'failed'), true);
  for (const done of ['fulfilled', 'failed', 'cancelled']) {
    for (const next of ['pending', 'processing', 'fulfilled', 'failed', 'cancelled']) {
      assert.equal(canMoveRedemption(done, next), false, `${done} -> ${next}`);
    }
  }
  assert.equal(canMoveRedemption('processing', 'pending'), false);
  assert.equal(canMoveRedemption('nonsense', 'fulfilled'), false);
});

test('ledger tally treats a refund as un-spending, not as income', () => {
  const t = tally([
    { delta: 100, source: 'tree_verify' },
    { delta: -60, source: 'redemption' },
    { delta: 60, source: 'reversal' },
  ]);
  assert.deepEqual(t, { available: 100, lifetime: 100, spent: 0 });
});

test('ledger tally treats a negative reversal as clawing back earnings', () => {
  const t = tally([
    { delta: 100, source: 'tree_verify' },
    { delta: -30, source: 'reversal' },
  ]);
  assert.deepEqual(t, { available: 70, lifetime: 70, spent: 0 });
});

test('ledger tally is unchanged for ordinary earn and spend rows', () => {
  const t = tally([
    { delta: 50, source: 'tree_plant' },
    { delta: 25, source: 'referral' },
    { delta: -40, source: 'redemption' },
  ]);
  assert.deepEqual(t, { available: 35, lifetime: 75, spent: 40 });
});

// ---------------------------------------------------------------------------
// Users, feedback, flags
// ---------------------------------------------------------------------------

const ban = (db, body, u = users) =>
  WRITE_ROUTES['/admin/user/ban']({ databases: db, users: u, user: admin, body });

test('suspending a user needs a reason and sets the flag', async () => {
  const db = fakeDb({ profiles: [profile()] });
  await assert.rejects(ban(db, { userId: 'u1', banned: true }), (e) => e.code === 'reason_required');
  await ban(db, { userId: 'u1', banned: true, reason: 'Repeated fake photos.' });
  assert.equal(db.cols.profiles.get('u1').isBanned, true);
  assert.equal(db.cols.profiles.get('u1').banReason, 'Repeated fake photos.');
  await ban(db, { userId: 'u1', banned: false });
  assert.equal(db.cols.profiles.get('u1').isBanned, false);
  assert.equal(db.cols.profiles.get('u1').banReason, '');
});

test('an administrator cannot be suspended from the panel', async () => {
  const db = fakeDb({ profiles: [profile()] });
  const adminUsers = { get: async () => ({ labels: ['admin'] }) };
  await assert.rejects(
    ban(db, { userId: 'u1', banned: true, reason: 'oops oops' }, adminUsers),
    (e) => e.code === 'bad_request',
  );
  assert.equal(db.cols.profiles.get('u1').isBanned, false);
});

test('replying to feedback stores the reply, answers it and tells the user', async () => {
  const db = fakeDb({ feedback: [{ $id: 'f1', userId: 'u1', status: 'open', adminReply: '' }] });
  await WRITE_ROUTES['/admin/feedback/reply']({
    databases: db, user: admin, body: { id: 'f1', reply: 'Fixed in the next build.' },
  });
  assert.equal(db.cols.feedback.get('f1').status, 'answered');
  assert.equal(db.cols.feedback.get('f1').adminReply, 'Fixed in the next build.');
  assert.equal(db.rows('notifications').length, 1);
  assert.equal(db.rows('notifications')[0].userId, 'u1');
});

test('marking feedback answered without a reply is refused', async () => {
  const db = fakeDb({ feedback: [{ $id: 'f1', userId: 'u1', status: 'open' }] });
  await assert.rejects(
    WRITE_ROUTES['/admin/feedback/reply']({ databases: db, user: admin, body: { id: 'f1', status: 'answered' } }),
    (e) => e.code === 'reason_required',
  );
});

test('a flag can be resolved once', async () => {
  const db = fakeDb({ fraud_flags: [{ $id: 'g1', userId: 'u1', kind: 'not_a_plant', resolved: false }] });
  const resolve = () =>
    WRITE_ROUTES['/admin/flag/resolve']({ databases: db, user: admin, body: { id: 'g1', resolution: 'Checked, fine.' } });
  await resolve();
  assert.equal(db.cols.fraud_flags.get('g1').resolved, true);
  await assert.rejects(resolve(), (e) => e.code === 'already_decided');
});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const setCfg = (db, body) => WRITE_ROUTES['/admin/config/set']({ databases: db, user: admin, body });
const cfgSeed = () => ({
  app_config: [
    { $id: 'c1', key: 'vision.on_unavailable', value: 'approve', valueType: 'string' },
    { $id: 'c2', key: 'tree.plant_credits', value: '5', valueType: 'int' },
  ],
});

test('a valid change is applied and audited with before and after', async () => {
  const db = fakeDb(cfgSeed());
  const out = await setCfg(db, { key: 'vision.on_unavailable', value: 'review' });
  assert.equal(out.changed, true);
  assert.equal(db.cols.app_config.get('c1').value, 'review');
  assert.ok(audit(db)[0].detail.includes('"from":"approve"'));
  assert.ok(audit(db)[0].detail.includes('"to":"review"'));
});

test('setting the value it already has changes and audits nothing', async () => {
  const db = fakeDb(cfgSeed());
  const out = await setCfg(db, { key: 'tree.plant_credits', value: 5 });
  assert.equal(out.changed, false);
  assert.equal(audit(db).length, 0);
});

test('keys outside the whitelist cannot be edited', async () => {
  const db = fakeDb({ app_config: [{ $id: 'c9', key: 'xp.level_curve', value: '[0]', valueType: 'json' }] });
  await assert.rejects(setCfg(db, { key: 'xp.level_curve', value: '[0,1]' }), (e) => e.code === 'bad_request');
  await assert.rejects(setCfg(db, { key: 'made.up', value: '1' }), (e) => e.code === 'bad_request');
  assert.equal(db.cols.app_config.get('c9').value, '[0]');
});

test('values are validated against the key', () => {
  assert.equal(validateConfigValue('vision.ai_enabled', false), 'false');
  assert.equal(validateConfigValue('vision.ai_enabled', 'true'), 'true');
  assert.equal(validateConfigValue('tree.plant_credits', '7'), '7');
  assert.equal(validateConfigValue('vision.ai_confidence_min', 0.75), '0.75');
  assert.equal(validateConfigValue('vision.on_unavailable', 'review'), 'review');
  assert.equal(validateConfigValue('vision.model', 'google/gemma-4-31b-it:free'), 'google/gemma-4-31b-it:free');

  for (const [k, v] of [
    ['vision.ai_enabled', 'maybe'],
    ['tree.plant_credits', 1.5],
    ['tree.plant_credits', -1],
    ['tree.plant_credits', 999999],
    ['tree.plant_credits', 'abc'],
    ['vision.ai_confidence_min', 2],
    ['vision.on_unavailable', 'ignore'],
    ['vision.model', 'bad model; rm -rf'],
    ['vision.model', ''],
    ['tree.verify_radius_m', 0],
  ]) {
    assert.throws(() => validateConfigValue(k, v), (e) => e.code === 'bad_request', `${k}=${v}`);
  }
});

test('every editable key has a type and a label', () => {
  for (const [key, spec] of Object.entries(CONFIG_SPEC)) {
    assert.ok(['bool', 'int', 'float', 'enum', 'string'].includes(spec.type), key);
    assert.ok(spec.label, key);
    if (spec.type === 'int' || spec.type === 'float') assert.ok(spec.min < spec.max, key);
    if (spec.type === 'enum') assert.ok(spec.options.length > 1, key);
  }
});

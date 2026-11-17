import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LISTS,
  READ_ROUTES,
  aggregateInspections,
  buildListQuery,
  flagRefs,
  flagsFor,
  sanitize,
  sniffMime,
  sumField,
} from './admin_read.js';
import { Rejected } from '../lib/context.js';

const text = (queries) => queries.map((q) => String(q));

test('an unknown list is refused', () => {
  assert.throws(
    () => buildListQuery('secrets', {}),
    (e) => e instanceof Rejected && e.code === 'bad_request',
  );
});

test('every registered list builds a default query', () => {
  for (const name of Object.keys(LISTS)) {
    const { queries, limit, offset } = buildListQuery(name, {});
    assert.ok(queries.length >= 3, name);
    assert.equal(limit, 25);
    assert.equal(offset, 0);
  }
});

test('page size is capped and never below one', () => {
  assert.equal(buildListQuery('trees', { limit: 100000 }).limit, 50);
  assert.equal(buildListQuery('trees', { limit: 0 }).limit, 1);
  assert.equal(buildListQuery('trees', { limit: -4 }).limit, 1);
  assert.equal(buildListQuery('trees', { offset: -9 }).offset, 0);
});

test('a registered filter becomes an equality query', () => {
  const { queries } = buildListQuery('trees', { filters: { status: 'pending_review' } });
  assert.ok(text(queries).some((q) => q.includes('status') && q.includes('pending_review')));
});

test('boolean filters are kept as booleans', () => {
  const { queries } = buildListQuery('flags', { filters: { resolved: false } });
  assert.ok(text(queries).some((q) => q.includes('resolved') && q.includes('false')));
});

test('empty filter values are ignored rather than matched', () => {
  const base = buildListQuery('trees', {}).queries.length;
  const withBlank = buildListQuery('trees', { filters: { status: '', ownerId: null } }).queries.length;
  assert.equal(withBlank, base);
});

// The registry is the allow-list. A field outside it must not reach the
// database, or the panel could be used to probe arbitrary columns.
test('a filter field outside the registry is refused', () => {
  assert.throws(
    () => buildListQuery('trees', { filters: { lat: 12 } }),
    (e) => e.code === 'bad_request',
  );
  assert.throws(
    () => buildListQuery('users', { filters: { email: 'a@b.c' } }),
    (e) => e.code === 'bad_request',
  );
});

test('structured filter values are refused', () => {
  assert.throws(
    () => buildListQuery('trees', { filters: { status: { $ne: 'alive' } } }),
    (e) => e.code === 'bad_request',
  );
  assert.throws(
    () => buildListQuery('trees', { filters: { status: ['a', 'b'] } }),
    (e) => e.code === 'bad_request',
  );
});

test('search works on users and nowhere else', () => {
  const { queries } = buildListQuery('users', { search: 'govind' });
  assert.ok(text(queries).some((q) => q.includes('search') && q.includes('name')));
  assert.throws(() => buildListQuery('trees', { search: 'neem' }), (e) => e.code === 'bad_request');
});

test('sanitize drops internals and device secrets but keeps ids and times', () => {
  const out = sanitize({
    $id: 'u1',
    $createdAt: '2026-10-17T00:00:00.000Z',
    $updatedAt: '2026-10-17T00:00:00.000Z',
    $permissions: ['read("user:u1")'],
    $databaseId: 'dhara',
    $collectionId: 'profiles',
    name: 'Govind',
    fcmToken: 'secret-token',
    deviceFingerprint: 'fp',
  });
  assert.equal(out.$id, 'u1');
  assert.equal(out.name, 'Govind');
  assert.ok(out.$createdAt);
  assert.equal('fcmToken' in out, false);
  assert.equal('deviceFingerprint' in out, false);
  assert.equal('$permissions' in out, false);
  assert.equal('$databaseId' in out, false);
});

test('aggregation counts outcomes, unavailability and per-model latency', () => {
  const rows = [
    { action: 'approve', status: 'ok', latencyMs: 1000, model: 'm1' },
    { action: 'approve', status: 'ok', latencyMs: 3000, model: 'm1' },
    { action: 'reject', status: 'ok', latencyMs: 2000, model: 'm1' },
    { action: 'approve', status: 'unavailable', latencyMs: 9000, model: 'm1' },
    { action: 'review', status: 'ok', latencyMs: 500, model: 'm2' },
  ];
  const a = aggregateInspections(rows);
  assert.equal(a.total, 5);
  assert.equal(a.approve, 3);
  assert.equal(a.reject, 1);
  assert.equal(a.review, 1);
  assert.equal(a.unavailable, 1);
  // The 9 s failure is not a real answer time and must not inflate the average.
  assert.equal(a.avgLatencyMs, Math.round((1000 + 3000 + 2000 + 500) / 4));
  assert.equal(a.byModel.m1.calls, 4);
  assert.equal(a.byModel.m1.unavailable, 1);
  assert.equal(a.byModel.m1.avgLatencyMs, 2000);
  assert.equal(a.byModel.m2.avgLatencyMs, 500);
});

test('aggregating nothing yields zeros, not NaN', () => {
  const a = aggregateInspections([]);
  assert.equal(a.total, 0);
  assert.equal(a.avgLatencyMs, 0);
  assert.deepEqual(a.byModel, {});
});

test('file types are recognised by content, not by name', () => {
  assert.equal(sniffMime(new Uint8Array([0xff, 0xd8, 0xff])), 'image/jpeg');
  assert.equal(sniffMime(new Uint8Array([0x89, 0x50, 0x4e])), 'image/png');
  assert.equal(sniffMime(new Uint8Array([0x25, 0x50, 0x44])), 'application/pdf');
  assert.equal(sniffMime(new Uint8Array([0x00, 0x01])), null);
});

test('sumField adds numbers and treats everything else as zero', () => {
  const rows = [
    { co2OffsetGrams: 1500 },
    { co2OffsetGrams: 2500 },
    { co2OffsetGrams: null },
    { co2OffsetGrams: '900' },
    { co2OffsetGrams: Number.NaN },
    { co2OffsetGrams: Number.POSITIVE_INFINITY },
    {},
    null,
  ];
  assert.equal(sumField(rows, 'co2OffsetGrams'), 4000);
});

test('sumField of nothing is zero', () => {
  assert.equal(sumField([], 'x'), 0);
});

// ---------------------------------------------------------------------------
// Review queue: fraud flags and pHash distance
// ---------------------------------------------------------------------------

/** In-memory Appwrite that understands the equal/limit queries the queue uses. */
function queueDb(seed, { failOn } = {}) {
  return {
    listDocuments: async (_db, col, queries = []) => {
      if (col === failOn) throw new Error('boom');
      let docs = [...(seed[col] ?? [])];
      let limit = 25;
      for (const q of queries) {
        const j = JSON.parse(String(q));
        if (j.method === 'equal') docs = docs.filter((d) => j.values.includes(d[j.attribute]));
        if (j.method === 'limit') limit = j.values[0];
      }
      return { documents: docs.slice(0, limit), total: docs.length };
    },
  };
}

const queueRoute = READ_ROUTES['/admin/queue'];

const seed = () => ({
  trees: [
    {
      $id: 't1', $createdAt: '2026-11-01T10:00:00.000Z', status: 'pending_review', ownerId: 'u1',
      speciesName: 'Other', plantPhotoFileId: 'file1', lat: 1, lng: 2, accuracyM: 5,
      rejectReason: 'ai_low_confidence', aiVerdict: 'conf=0.40 plant=true real=true', aiConfidence: 0.4, aiModel: 'm',
    },
    {
      $id: 't2', $createdAt: '2026-11-03T10:00:00.000Z', status: 'pending_review', ownerId: 'u2',
      speciesName: 'Neem', plantPhotoFileId: 'file2', lat: 1, lng: 2, accuracyM: 5,
    },
    // Parent of the check-in; not itself waiting.
    { $id: 't3', $createdAt: '2026-10-01T10:00:00.000Z', status: 'alive', ownerId: 'u1', speciesName: 'Mango', nickname: 'Big' },
  ],
  tree_verifications: [
    {
      $id: 'v1', $createdAt: '2026-11-02T10:00:00.000Z', status: 'manual_review', userId: 'u1', treeId: 't3',
      monthKey: '2026-11', photoFileId: 'file3', phashDistanceToNearest: 11, rejectReason: 'ai_species_mismatch',
    },
  ],
  profiles: [
    { $id: 'u1', name: 'Asha', email: 'a@example.com', trustScore: 90 },
    { $id: 'u2', name: 'Ravi', email: 'r@example.com', trustScore: 40, isBanned: false },
  ],
  fraud_flags: [
    { $id: 'f1', userId: 'u1', kind: 'not_a_plant', severity: 'medium', detail: 'client confidence 0.40', refType: 'tree_plant', refId: 'file1', resolved: false },
    { $id: 'f2', userId: 'u1', kind: 'duplicate_photo', severity: 'high', detail: 'hamming 5 vs x', refType: 'tree_verify', refId: 't3:2026-11', resolved: false },
    { $id: 'f3', userId: 'u1', kind: 'out_of_radius', severity: 'medium', detail: '80 m from tree', refType: 'tree', refId: 't3', resolved: true },
    // Same tree, a different month: not about this check-in.
    { $id: 'f4', userId: 'u1', kind: 'duplicate_photo', severity: 'critical', detail: 'old', refType: 'tree_verify', refId: 't3:2026-10', resolved: false },
    // Unrelated record entirely.
    { $id: 'f5', userId: 'u9', kind: 'mock_location', severity: 'critical', detail: 'x', refType: 'tree_plant', refId: 'fileX', resolved: false },
  ],
});

test('flagRefs follows the refIds tree.js files flags under', () => {
  assert.deepEqual(flagRefs('tree', { $id: 't1', plantPhotoFileId: 'file1' }), ['file1', 't1']);
  assert.deepEqual(flagRefs('verification', { treeId: 't3', monthKey: '2026-11' }), ['t3:2026-11', 't3']);
  assert.deepEqual(flagRefs('verification', { treeId: 't3' }), ['t3']);
  assert.deepEqual(flagRefs('tree', {}), []);
});

test('flagsFor keeps only matching flags, unresolved and worst first', () => {
  const rows = [
    { refId: 'a', kind: 'k1', severity: 'low', detail: 'd1', resolved: false },
    { refId: 'a', kind: 'k2', severity: 'critical', detail: 'd2', resolved: true },
    { refId: 'a', kind: 'k3', severity: 'high', detail: 'd3', resolved: false, userId: 'u', trustScoreDelta: -5 },
    { refId: 'b', kind: 'k4', severity: 'critical', detail: 'd4', resolved: false },
  ];
  assert.deepEqual(flagsFor(['a'], rows), [
    { kind: 'k3', severity: 'high', detail: 'd3', resolved: false },
    { kind: 'k1', severity: 'low', detail: 'd1', resolved: false },
    { kind: 'k2', severity: 'critical', detail: 'd2', resolved: true },
  ]);
  assert.deepEqual(flagsFor(['zzz'], rows), []);
});

test('queue attaches the matching flags to trees and check-ins', async () => {
  const out = await queueRoute({ databases: queueDb(seed()), config: {} });
  const byId = Object.fromEntries(out.items.map((i) => [i.id, i]));

  assert.deepEqual(byId.t1.flags, [
    { kind: 'not_a_plant', severity: 'medium', detail: 'client confidence 0.40', resolved: false },
  ]);
  assert.deepEqual(byId.v1.flags, [
    { kind: 'duplicate_photo', severity: 'high', detail: 'hamming 5 vs x', resolved: false },
    { kind: 'out_of_radius', severity: 'medium', detail: '80 m from tree', resolved: true },
  ]);
  // Neither another month's flag nor an unrelated record leaks in.
  const all = out.items.flatMap((i) => i.flags);
  assert.ok(!all.some((f) => f.detail === 'old' || f.kind === 'mock_location'));
  // Internal lookup keys never reach the panel.
  assert.ok(out.items.every((i) => !('flagRefs' in i)));
});

test('queue items without flags get an empty list', async () => {
  const out = await queueRoute({ databases: queueDb(seed()), config: {} });
  assert.deepEqual(out.items.find((i) => i.id === 't2').flags, []);
});

test('queue returns the pHash distance for check-ins and the threshold', async () => {
  const out = await queueRoute({ databases: queueDb(seed()), config: { 'fraud.phash_hamming_threshold': 6 } });
  assert.equal(out.items.find((i) => i.id === 'v1').phashDistanceToNearest, 11);
  // Trees do not store it.
  assert.equal(out.items.find((i) => i.id === 't1').phashDistanceToNearest, null);
  assert.equal(out.phashThreshold, 6);
  assert.equal((await queueRoute({ databases: queueDb(seed()) })).phashThreshold, 8);
});

test('a missing pHash distance on a check-in is null, not undefined or NaN', async () => {
  const s = seed();
  delete s.tree_verifications[0].phashDistanceToNearest;
  const out = await queueRoute({ databases: queueDb(s), config: {} });
  assert.equal(out.items.find((i) => i.id === 'v1').phashDistanceToNearest, null);
});

test('a failed flag lookup keeps the queue and marks flags as unknown', async () => {
  const logs = [];
  const out = await queueRoute({
    databases: queueDb(seed(), { failOn: 'fraud_flags' }),
    config: {},
    log: (m) => logs.push(m),
  });
  assert.equal(out.items.length, 3);
  assert.ok(out.items.every((i) => i.flags === null));
  assert.ok(logs.some((m) => m.includes('flag lookup failed')));
});

test('queue keeps its existing shape, order and counts', async () => {
  const out = await queueRoute({ databases: queueDb(seed()), config: {} });
  assert.deepEqual(out.counts, { trees: 2, verifications: 1 });
  assert.deepEqual(out.items.map((i) => i.id), ['t1', 'v1', 't2']);

  const t1 = out.items[0];
  assert.equal(t1.kind, 'tree');
  assert.equal(t1.userName, 'Asha');
  assert.equal(t1.trustScore, 90);
  assert.equal(t1.photoFileId, 'file1');
  assert.equal(t1.reason, 'ai_low_confidence');
  assert.equal(t1.aiVerdict, 'conf=0.40 plant=true real=true');
  assert.equal(t1.aiConfidence, 0.4);

  const v1 = out.items[1];
  assert.equal(v1.kind, 'verification');
  assert.equal(v1.treeId, 't3');
  assert.equal(v1.photoFileId, 'file3');
  assert.equal(v1.reason, 'ai_species_mismatch');
  assert.ok(v1.title.includes('2026-11') && v1.title.includes('Mango') && v1.title.includes('Big'));
});

test('queue only reads', async () => {
  const db = queueDb(seed());
  for (const m of ['createDocument', 'updateDocument', 'deleteDocument']) {
    db[m] = async () => assert.fail(`queue must not call ${m}`);
  }
  await queueRoute({ databases: db, config: {} });
});

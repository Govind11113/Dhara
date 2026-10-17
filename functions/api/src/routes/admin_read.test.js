import test from 'node:test';
import assert from 'node:assert/strict';

import { LISTS, aggregateInspections, buildListQuery, sanitize, sniffMime, sumField } from './admin_read.js';
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

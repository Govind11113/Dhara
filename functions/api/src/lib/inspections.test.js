import test from 'node:test';
import assert from 'node:assert/strict';

import { buildInspection, recordInspection } from './inspections.js';
import { parseVerdict } from './vision.js';

const meta = {
  status: 'ok',
  provider: 'openrouter',
  model: 'nvidia/nemotron-3.5-super-vl:free',
  latencyMs: 912.6,
  attempts: 1,
  error: '',
};
const verdict = parseVerdict({
  isPlant: true,
  isRealPhoto: true,
  species: 'Neem',
  speciesMatches: true,
  confidence: 0.9,
  concerns: [],
});
const ai = { action: 'approve', reasons: [], confidence: 0.9 };

test('maps a vision result onto the row', () => {
  const row = buildInspection({
    userId: 'u1',
    refType: 'tree_plant',
    refId: 'r1',
    fileId: 'f1',
    meta,
    verdict,
    ai,
  });
  assert.equal(row.provider, 'openrouter');
  assert.equal(row.model, 'nvidia/nemotron-3.5-super-vl:free');
  assert.equal(row.action, 'approve');
  assert.equal(row.status, 'ok');
  assert.equal(row.latencyMs, 913);
  assert.ok(row.verdict.includes('conf=0.90'));
  assert.ok(!Number.isNaN(Date.parse(row.createdAt)));
});

test('an unavailable call is recorded with its error and no verdict', () => {
  const row = buildInspection({
    userId: 'u1',
    refType: 'tree_verify',
    refId: 'r2',
    fileId: 'f2',
    meta: { ...meta, status: 'unavailable', error: 'daily free-model cap reached', attempts: 1 },
    verdict: null,
    ai: { action: 'approve', reasons: [], confidence: 0 },
  });
  assert.equal(row.status, 'unavailable');
  assert.equal(row.error, 'daily free-model cap reached');
  assert.equal(row.verdict, '');
});

// One oversize string fails the whole document write, and the write is the
// only record of the call.
test('values are clamped to the schema limits', () => {
  const row = buildInspection({
    userId: 'u'.repeat(200),
    refType: 'x'.repeat(200),
    refId: 'y'.repeat(200),
    fileId: 'z'.repeat(200),
    meta: { ...meta, model: 'm'.repeat(500), error: 'e'.repeat(900), latencyMs: -5, attempts: NaN },
    verdict,
    ai: { action: 'approve', confidence: 7 },
  });
  assert.ok(row.userId.length <= 64);
  assert.ok(row.refType.length <= 32);
  assert.ok(row.refId.length <= 64);
  assert.ok(row.model.length <= 96);
  assert.ok(row.error.length <= 256);
  assert.equal(row.latencyMs, 0);
  assert.equal(row.attempts, 0);
  assert.equal(row.confidence, 1);
});

test('a failed write is swallowed so it cannot break a submission', async () => {
  const logged = [];
  const broken = {
    createDocument: async () => {
      throw new Error('database is down');
    },
  };
  await assert.doesNotReject(
    recordInspection(
      broken,
      { userId: 'u1', refType: 't', refId: 'r', fileId: 'f', meta, verdict, ai },
      (m) => logged.push(m),
    ),
  );
  assert.match(logged[0], /database is down/);
});

test('a successful write sends the built row to the right collection', async () => {
  let seen;
  const db = {
    createDocument: async (database, collection, id, data) => {
      seen = { database, collection, data };
      return {};
    },
  };
  await recordInspection(db, { userId: 'u1', refType: 't', refId: 'r', fileId: 'f', meta, verdict, ai });
  assert.equal(seen.collection, 'ai_inspections');
  assert.equal(seen.data.userId, 'u1');
});

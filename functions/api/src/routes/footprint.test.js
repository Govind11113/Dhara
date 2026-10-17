import test from 'node:test';
import assert from 'node:assert/strict';

import * as footprint from './footprint.js';
import { monthKeyOf } from '../lib/footprint.js';
import { FACTORS_VERSION } from '../lib/footprint_factors.js';

/**
 * In-memory Appwrite for one collection, with the unique (userId, monthKey)
 * index the real collection has. Also records the permissions each document
 * was created with, because "only the owner can read it" is a claim to check.
 */
function fakeDb() {
  const docs = new Map();
  let n = 0;
  const err = (code, message) => Object.assign(new Error(message), { code });
  const all = () => [...docs.values()];

  return {
    all,
    createDocument: async (_db, _col, id, data, permissions = []) => {
      await Promise.resolve();
      if (all().some((d) => d.userId === data.userId && d.monthKey === data.monthKey)) {
        throw err(409, 'duplicate (userId, monthKey)');
      }
      const doc = { $id: id === 'unique()' ? `f${++n}` : id, $permissions: permissions.map(String), ...data };
      docs.set(doc.$id, doc);
      return { ...doc };
    },
    updateDocument: async (_db, _col, id, patch) => {
      await Promise.resolve();
      const d = docs.get(id);
      if (!d) throw err(404, 'missing');
      Object.assign(d, patch);
      return { ...d };
    },
    deleteDocument: async (_db, _col, id) => {
      await Promise.resolve();
      if (!docs.delete(id)) throw err(404, 'missing');
    },
    listDocuments: async (_db, _col, queries = []) => {
      await Promise.resolve();
      let rows = all();
      for (const q of queries) {
        const j = JSON.parse(String(q));
        if (j.method === 'equal') rows = rows.filter((d) => j.values.includes(d[j.attribute]));
      }
      return { documents: rows.map((d) => ({ ...d })), total: rows.length };
    },
  };
}

const user = { $id: 'u1' };
const now = monthKeyOf(new Date());

const inputs = { householdSize: 4, electricityKwh: 200, lpgCylinders: 1, travel: { bus: 100 } };
const run = (fn, db, body, u = user) => fn({ databases: db, user: u, body });

test('estimate returns the footprint and writes nothing', async () => {
  const out = await footprint.estimate({ body: { inputs } });
  assert.equal(out.footprint.factorsVersion, FACTORS_VERSION);
  assert.ok(out.footprint.monthKg > 0);
  assert.equal(out.inputs.householdSize, 4);
});

test('estimate refuses an empty submission with a helpful message', async () => {
  await assert.rejects(
    footprint.estimate({ body: { inputs: {} } }),
    (e) => e.code === 'nothing_entered' && /electricity/i.test(e.message),
  );
  await assert.rejects(footprint.estimate({ body: {} }), (e) => e.code === 'invalid_input');
  await assert.rejects(footprint.estimate({ body: { inputs: { electricityKwh: -3 } } }), (e) => e.code === 'invalid_input');
});

test('save stores the figures, the inputs and the factor version', async () => {
  const db = fakeDb();
  const out = await run(footprint.save, db, { inputs });

  assert.equal(out.saved.replaced, false);
  assert.equal(out.saved.monthKey, now);
  const row = db.all()[0];
  assert.equal(row.userId, 'u1');
  assert.equal(row.monthKey, now);
  assert.equal(row.monthKg, out.footprint.monthKg);
  assert.equal(row.factorsVersion, FACTORS_VERSION);
  assert.equal(row.householdSize, 4);
  assert.equal(JSON.parse(row.inputs).electricityKwh, 200);
  assert.ok(row.electricityKg > 0 && row.cookingKg > 0 && row.transportKg > 0);
});

// Footprints are personal. The document must be readable by its owner and by
// nobody else.
test('a saved footprint is readable only by its owner', async () => {
  const db = fakeDb();
  await run(footprint.save, db, { inputs });
  assert.deepEqual(db.all()[0].$permissions, ['read("user:u1")']);
});

test('saving the same month again replaces it instead of adding a row', async () => {
  const db = fakeDb();
  await run(footprint.save, db, { inputs });
  const second = await run(footprint.save, db, { inputs: { ...inputs, electricityKwh: 400 } });

  assert.equal(second.saved.replaced, true);
  assert.equal(db.all().length, 1);
  assert.equal(JSON.parse(db.all()[0].inputs).electricityKwh, 400);
});

test('different months and different members keep separate rows', async () => {
  const db = fakeDb();
  const earlier = monthKeyOf(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 1)));
  await run(footprint.save, db, { inputs });
  await run(footprint.save, db, { inputs, monthKey: earlier });
  await run(footprint.save, db, { inputs }, { $id: 'u2' });
  assert.equal(db.all().length, 3);
});

test('two saves racing for the same new month leave one row', async () => {
  const db = fakeDb();
  const results = await Promise.allSettled([
    run(footprint.save, db, { inputs }),
    run(footprint.save, db, { inputs: { ...inputs, electricityKwh: 999 } }),
  ]);
  assert.ok(results.every((r) => r.status === 'fulfilled'), JSON.stringify(results.map((r) => r.reason?.message)));
  assert.equal(db.all().length, 1);
});

test('months outside the allowed window are refused', async () => {
  const db = fakeDb();
  for (const monthKey of ['2099-01', '2001-05', '2026-13', 'nope']) {
    await assert.rejects(run(footprint.save, db, { inputs, monthKey }), (e) => e.code === 'invalid_month', monthKey);
  }
  assert.equal(db.all().length, 0);
});

test('invalid inputs are refused before anything is written', async () => {
  const db = fakeDb();
  await assert.rejects(run(footprint.save, db, { inputs: { electricityKwh: 'lots' } }), (e) => e.code === 'invalid_input');
  await assert.rejects(run(footprint.save, db, { inputs: {} }), (e) => e.code === 'nothing_entered');
  assert.equal(db.all().length, 0);
});

test('a member can delete their own month', async () => {
  const db = fakeDb();
  await run(footprint.save, db, { inputs });
  const out = await run(footprint.remove, db, { monthKey: now });
  assert.equal(out.removed, true);
  assert.equal(db.all().length, 0);
});

// Deleting must be scoped by the JWT-resolved user, never by a body field.
test("a member cannot delete someone else's month", async () => {
  const db = fakeDb();
  await run(footprint.save, db, { inputs }, { $id: 'u2' });
  await assert.rejects(run(footprint.remove, db, { monthKey: now }), (e) => e.code === 'not_found');
  assert.equal(db.all().length, 1);
});

test('deleting needs a real month', async () => {
  const db = fakeDb();
  await assert.rejects(run(footprint.remove, db, { monthKey: 'x' }), (e) => e.code === 'invalid_month');
  await assert.rejects(run(footprint.remove, db, {}), (e) => e.code === 'invalid_month');
});

test('the methodology route returns the sources and the limits', async () => {
  const m = await footprint.methodologyRoute();
  assert.equal(m.version, FACTORS_VERSION);
  assert.ok(m.factors.every((f) => f.source && f.confidence));
  assert.ok(m.exclusions.length >= 4);
  assert.ok(m.caveats.length >= 4);
});

test('rowFor keeps every figure inside the schema limits', () => {
  const huge = { householdSize: 1, electricityKwh: 50000, lpgCylinders: 20, carOccupants: 1, travel: { car_petrol: 20000, flight_international: 60000 } };
  const fp = { monthKg: 999999, yearKg: 11999988, groups: { electricity: 1, cooking: 1, transport: 1, air: 1 }, factorsVersion: FACTORS_VERSION };
  const row = footprint.rowFor('u', now, huge, fp);
  assert.ok(row.inputs.length <= 2000);
  assert.ok(row.monthKg <= 1000000 && row.yearKg <= 12000000);
});

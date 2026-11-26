import test, { afterEach, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

import { UTILITY_ROUTES, makeUtilityRoutes } from './utilities.js';
import main from '../main.js';
import * as footprint from './footprint.js';
import { REGIONS, listProviders } from '../lib/utilities/providers.js';
import { extractFromText, parseDate } from '../lib/utilities/extract.js';
import { carbonFor } from '../lib/utilities/carbon.js';
import { CONSENT_PURPOSE, CONSENT_VERSION, accountHash, maskAccount, validPeriod } from '../lib/utilities/records.js';
import { FACTORS } from '../lib/footprint_factors.js';

// All account numbers here are made up. No real consumer data is used.
const ACCOUNT = '123456789012';
const PEPPER = 'test-pepper-not-a-real-secret-0123456789';

// ---------------------------------------------------------------------------
// In-memory Appwrite with the unique indexes the real collections have.
// ---------------------------------------------------------------------------

const UNIQUE = {
  utility_readings: (a, b) => a.dedupeKey === b.dedupeKey,
  utility_verifications: (a, b) => a.userId === b.userId && a.requestId === b.requestId,
  footprints: (a, b) => a.userId === b.userId && a.monthKey === b.monthKey,
};

function fakeDb() {
  const cols = {};
  const col = (c) => (cols[c] ??= new Map());
  const err = (code, m) => Object.assign(new Error(m), { code });
  let n = 0;
  return {
    cols,
    rows: (c) => [...col(c).values()],
    getDocument: async (_db, c, id) => {
      const d = col(c).get(id);
      if (!d) throw err(404, 'not found');
      return { ...d };
    },
    createDocument: async (_db, c, id, data, permissions = []) => {
      const clash = UNIQUE[c];
      if (clash && [...col(c).values()].some((d) => clash(d, data))) throw err(409, 'exists');
      const doc = { $id: id === 'unique()' ? `${c[0]}${++n}` : id, $permissions: permissions.map(String), ...data };
      col(c).set(doc.$id, doc);
      return { ...doc };
    },
    updateDocument: async (_db, c, id, patch) => {
      const d = col(c).get(id);
      if (!d) throw err(404, 'not found');
      Object.assign(d, patch);
      return { ...d };
    },
    deleteDocument: async (_db, c, id) => {
      if (!col(c).delete(id)) throw err(404, 'not found');
    },
    listDocuments: async (_db, c, queries = []) => {
      let docs = [...col(c).values()];
      let limit = 25;
      for (const q of queries) {
        const j = JSON.parse(String(q));
        if (j.method === 'equal') docs = docs.filter((d) => j.values.includes(d[j.attribute]));
        if (j.method === 'greaterThan') docs = docs.filter((d) => String(d[j.attribute]) > String(j.values[0]));
        if (j.method === 'limit') limit = j.values[0];
      }
      return { documents: docs.slice(0, limit).map((d) => ({ ...d })), total: docs.length };
    },
  };
}

function fakeStorage(files = {}) {
  return {
    getFile: async (_bucket, id) => {
      if (!files[id]) throw Object.assign(new Error('nf'), { code: 404 });
      return { $id: id, $permissions: files[id] };
    },
  };
}

const user = { $id: 'u1' };
const other = { $id: 'u2' };
let seq = 0;
const rid = () => `req_${Date.now()}_${++seq}`;

const uploadBody = (extra = {}) => ({
  utilityType: 'electricity',
  providerId: 'msedcl',
  account: ACCOUNT,
  requestId: rid(),
  consent: true,
  consentVersion: CONSENT_VERSION,
  values: { consumptionValue: 248, consumptionUnit: 'kWh', periodStart: '2026-10-01', periodEnd: '2026-10-31' },
  ...extra,
});

beforeEach(() => {
  process.env.UTILITY_ID_PEPPER = PEPPER;
});
afterEach(() => {
  delete process.env.UTILITY_ID_PEPPER;
});

const call = (routes, path, body, ctx = {}) =>
  routes[path]({ databases: ctx.db ?? fakeDb(), storage: ctx.storage ?? fakeStorage(), user: ctx.user ?? user, body, config: ctx.config ?? {} });

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

test('only enabled Maharashtra providers are listed, without internal details', () => {
  const all = listProviders({});
  const ids = all.map((p) => p.id).sort();
  assert.deepEqual(ids, ['adani_mumbai', 'best_mumbai', 'mgl', 'mngl', 'msedcl', 'tata_power_mumbai']);
  for (const p of all) {
    assert.equal(p.state, 'MH');
    assert.equal('legalName' in p, false);
    // This build has no automatic bill fetching, so nothing advertises it.
    assert.equal('autoFetch' in p, false);
    assert.equal('billFetch' in p, false);
  }
  assert.deepEqual(listProviders({ utilityType: 'png' }).map((p) => p.id).sort(), ['mgl', 'mngl']);
});

test('the providers route returns regions, consent text and providers', async () => {
  const out = await call(makeUtilityRoutes(), '/utilities/providers', { utilityType: 'electricity' });
  assert.equal(out.regions[0].states[0].code, 'MH');
  assert.equal(out.consent.version, CONSENT_VERSION);
  assert.ok(out.providers.every((p) => p.utilityType === 'electricity'));
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test('consent is required before anything is stored', async () => {
  const db = fakeDb();
  await assert.rejects(call(makeUtilityRoutes(), '/utilities/bills/upload', uploadBody({ consent: false }), { db }), (e) => e.code === 'consent_required');
  await assert.rejects(call(makeUtilityRoutes(), '/utilities/bills/upload', uploadBody({ consentVersion: 'old' }), { db }), (e) => e.code === 'consent_required');
  assert.equal(db.rows('utility_verifications').length, 0);
});

test('consumer numbers are validated per provider', async () => {
  await assert.rejects(
    call(makeUtilityRoutes(), '/utilities/bills/upload', uploadBody({ account: '12345678901' })),
    (e) => e.code === 'invalid_account' && /consumer number/i.test(e.message),
  );
  await assert.rejects(
    call(makeUtilityRoutes(), '/utilities/bills/upload', uploadBody({ account: '' })),
    (e) => e.code === 'invalid_account',
  );
});

test('unknown, hidden or wrong-type providers are refused', async () => {
  const r = makeUtilityRoutes();
  for (const providerId of ['nope', 'adani_total_gas_mh', 'mgl']) {
    await assert.rejects(call(r, '/utilities/bills/upload', uploadBody({ providerId })), (e) => e.code === 'unsupported_provider');
  }
});

test('without the server secret nothing is stored', async () => {
  delete process.env.UTILITY_ID_PEPPER;
  const db = fakeDb();
  await assert.rejects(call(makeUtilityRoutes(), '/utilities/bills/upload', uploadBody(), { db }), (e) => e.code === 'service_unavailable');
  assert.equal(db.rows('utility_verifications').length, 0);
});

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

test('a saved bill keeps no full account number and only its owner can read it', async () => {
  const db = fakeDb();
  const out = await call(makeUtilityRoutes(), '/utilities/bills/upload', uploadBody(), { db });
  const v = out.verification;
  assert.equal(v.accountMasked, '********9012');
  assert.equal(v.reading.consumptionValue, 248);
  assert.equal(v.reading.periodStart, '2026-10-01');
  assert.equal(v.reading.carbonStatus, 'calculated');
  assert.equal(v.reading.carbonKg, Math.round(248 * FACTORS.electricity.value * 1000) / 1000);
  assert.equal(v.reading.fetchedAt, null);

  const everything = JSON.stringify(db.cols, (_k, val) => (val instanceof Map ? [...val.values()] : val));
  assert.equal(everything.includes(ACCOUNT), false);
  for (const d of [...db.rows('utility_readings'), ...db.rows('utility_verifications')]) {
    assert.deepEqual(d.$permissions, ['read("user:u1")']);
  }
});

test('the same billing period is imported once; a second import is a duplicate', async () => {
  const db = fakeDb();
  const routes = makeUtilityRoutes();
  const first = await call(routes, '/utilities/bills/upload', uploadBody(), { db });
  const second = await call(routes, '/utilities/bills/upload', uploadBody({ values: { consumptionValue: 250, consumptionUnit: 'kWh', periodStart: '2026-10-01', periodEnd: '2026-10-31', billReferenceId: 'OTHER' } }), { db });
  assert.equal(first.verification.status, 'unverified');
  assert.equal(second.verification.status, 'duplicate');
  assert.equal(second.verification.reading.id, first.verification.reading.id);
  assert.equal(db.rows('utility_readings').length, 1);
});

test('replaying a request returns the first result and stores nothing again', async () => {
  const db = fakeDb();
  const routes = makeUtilityRoutes();
  const body = uploadBody();
  const a = await call(routes, '/utilities/bills/upload', body, { db });
  const b = await call(routes, '/utilities/bills/upload', body, { db });
  assert.equal(b.verification.id, a.verification.id);
  assert.equal(db.rows('utility_verifications').length, 1);
});

test('requests are rate limited per member', async () => {
  const db = fakeDb();
  const routes = makeUtilityRoutes();
  const config = { 'utility.requests_per_hour': 2 };
  for (let i = 0; i < 2; i++) await call(routes, '/utilities/bills/upload', uploadBody(), { db, config });
  await assert.rejects(call(routes, '/utilities/bills/upload', uploadBody(), { db, config }), (e) => e.code === 'rate_limited');
});

test('a member cannot read another member\'s verification', async () => {
  const db = fakeDb();
  const routes = makeUtilityRoutes();
  const mine = await call(routes, '/utilities/bills/upload', uploadBody(), { db });
  await assert.rejects(
    call(routes, '/utilities/verification', { id: mine.verification.id }, { db, user: other }),
    (e) => e.code === 'not_found',
  );
  const own = await call(routes, '/utilities/verification', { id: mine.verification.id }, { db });
  assert.equal(own.verification.id, mine.verification.id);
});

// ---------------------------------------------------------------------------
// Upload and manual entry
// ---------------------------------------------------------------------------

test('an uploaded bill is held for review and never marked verified', async () => {
  const db = fakeDb();
  const storage = fakeStorage({ bill1: ['read("user:u1")'] });
  const out = await call(makeUtilityRoutes(), '/utilities/bills/upload', uploadBody({ billFileId: 'bill1', ocrText: 'Units Consumed: 248 kWh' }), { db, storage });
  assert.equal(out.verification.status, 'document_review');
  assert.equal(out.verification.method, 'document');
  assert.equal(out.verification.reading.status, 'document_review');
  assert.equal(out.verification.reason, 'ocr_matches_entry');
  assert.equal(out.extracted.consumptionValue, 248);
});

test('typed-in consumption is recorded as unverified', async () => {
  const out = await call(makeUtilityRoutes(), '/utilities/bills/upload', uploadBody());
  assert.equal(out.verification.status, 'unverified');
  assert.equal(out.verification.method, 'manual');
});

test('someone else\'s uploaded file cannot be attached', async () => {
  const storage = fakeStorage({ bill2: ['read("user:u2")'] });
  await assert.rejects(
    call(makeUtilityRoutes(), '/utilities/bills/upload', uploadBody({ billFileId: 'bill2' }), { storage }),
    (e) => e.code === 'bill_not_found',
  );
});

test('uploads validate the consumption, its unit and the period', async () => {
  const r = makeUtilityRoutes();
  await assert.rejects(call(r, '/utilities/bills/upload', uploadBody({ values: { consumptionValue: 248, consumptionUnit: 'SCM', periodStart: '2026-10-01', periodEnd: '2026-10-31' } })), (e) => e.code === 'invalid_consumption');
  await assert.rejects(call(r, '/utilities/bills/upload', uploadBody({ values: { consumptionValue: -1, consumptionUnit: 'kWh', periodStart: '2026-10-01', periodEnd: '2026-10-31' } })), (e) => e.code === 'invalid_consumption');
  await assert.rejects(call(r, '/utilities/bills/upload', uploadBody({ values: { consumptionValue: 248, consumptionUnit: 'kWh', periodStart: '2026-10-31', periodEnd: '2026-10-01' } })), (e) => e.code === 'invalid_period');
});

test('gas consumption is saved but its carbon stays pending without a verified factor', async () => {
  const out = await call(
    makeUtilityRoutes(),
    '/utilities/bills/upload',
    uploadBody({ utilityType: 'png', providerId: 'mgl', account: 'BP12345678', values: { consumptionValue: 14.5, consumptionUnit: 'SCM', periodStart: '2026-09-15', periodEnd: '2026-11-14' } }),
  );
  assert.equal(out.verification.reading.consumptionValue, 14.5);
  assert.equal(out.verification.reading.consumptionUnit, 'SCM');
  assert.equal(out.verification.reading.carbonStatus, 'pending_factor');
  assert.equal(out.verification.reading.carbonKg, null);
});

test('history lists only the caller\'s readings and deletion removes them all', async () => {
  const db = fakeDb();
  const r = makeUtilityRoutes();
  await call(r, '/utilities/bills/upload', uploadBody(), { db });
  await call(r, '/utilities/bills/upload', uploadBody(), { db, user: other });
  const mine = await call(r, '/utilities/consumption/history', {}, { db });
  assert.equal(mine.readings.length, 1);
  assert.equal(mine.readings[0].accountMasked, '********9012');

  const out = await call(r, '/utilities/delete', {}, { db });
  assert.equal(out.removed, 2);
  assert.equal((await call(r, '/utilities/consumption/history', {}, { db })).readings.length, 0);
  assert.equal((await call(r, '/utilities/consumption/history', {}, { db, user: other })).readings.length, 1);
});

// ---------------------------------------------------------------------------
// Footprint integration
// ---------------------------------------------------------------------------

test('an imported reading fills the footprint once, with its source recorded', async () => {
  const db = fakeDb();
  const up = await call(makeUtilityRoutes(), '/utilities/bills/upload', uploadBody(), { db });
  const readingId = up.verification.reading.id;
  const inputs = { householdSize: 2, electricityKwh: 248 };

  const saved = await footprint.save({ databases: db, user, body: { monthKey: '2026-10', inputs, sources: { electricityKwh: readingId } } });
  assert.deepEqual(saved.sources.electricityKwh, { source: 'unverified', readingId, periodStart: '2026-10-01', periodEnd: '2026-10-31' });
  assert.equal(db.cols.utility_readings.get(readingId).appliedMonthKey, '2026-10');
  assert.match(db.rows('footprints')[0].inputSources, /unverified/);

  // The same bill cannot be added to a second month.
  await assert.rejects(
    footprint.save({ databases: db, user, body: { monthKey: '2026-09', inputs, sources: { electricityKwh: readingId } } }),
    (e) => e.code === 'reading_already_used',
  );

  // Edited after import, the figure is the user's own.
  const edited = await footprint.save({ databases: db, user, body: { monthKey: '2026-10', inputs: { ...inputs, electricityKwh: 250 }, sources: { electricityKwh: readingId } } });
  assert.deepEqual(edited.sources.electricityKwh, { source: 'user_entered' });
  // ...and the bill is no longer counted, so it is free to use again.
  assert.equal(db.cols.utility_readings.get(readingId).appliedMonthKey, '');
});

test('another member\'s reading cannot be used as a source', async () => {
  const db = fakeDb();
  const up = await call(makeUtilityRoutes(), '/utilities/bills/upload', uploadBody(), { db, user: other });
  await assert.rejects(
    footprint.save({ databases: db, user, body: { monthKey: '2026-10', inputs: { electricityKwh: 248 }, sources: { electricityKwh: up.verification.reading.id } } }),
    (e) => e.code === 'reading_not_found',
  );
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test('OCR suggestions read labelled figures and nothing else', () => {
  const e = extractFromText('electricity', 'Billing Period: 01-10-2026 to 31-10-2026\nPrevious Reading 10230\nCurrent Reading 10478\nUnits Consumed 248');
  assert.equal(e.consumptionValue, 248);
  assert.equal(e.previousReading, 10230);
  assert.equal(e.currentReading, 10478);
  assert.equal(e.periodStart, '2026-10-01');
  assert.equal(e.periodEnd, '2026-10-31');

  // Readings that contradict the stated consumption make it untrustworthy.
  assert.equal(extractFromText('electricity', 'Previous Reading 100\nCurrent Reading 200\nUnits Consumed 248').consumptionValue, null);
  // Only readings: their difference is used.
  assert.equal(extractFromText('electricity', 'Previous Reading 100\nCurrent Reading 180').consumptionValue, 80);
  assert.equal(extractFromText('png', 'Gas consumed 14.5 SCM').consumptionValue, 14.5);
  assert.equal(extractFromText('electricity', '').consumptionValue, null);
  assert.equal(parseDate('05-Oct-2026'), '2026-10-05');
  assert.equal(parseDate('31-02-2026'), null);
});

test('records helpers mask, hash and validate', () => {
  assert.equal(maskAccount('123456789012'), '********9012');
  assert.equal(maskAccount('12'), '**');
  assert.notEqual(accountHash('msedcl', ACCOUNT, PEPPER), accountHash('msedcl', ACCOUNT, `${PEPPER}x`));
  assert.throws(() => accountHash('msedcl', ACCOUNT, ''));
  assert.deepEqual(validPeriod('2026-10-01', '2026-10-31', new Date('2026-11-05')), { start: '2026-10-01', end: '2026-10-31' });
  assert.equal(validPeriod('2026-01-01', '2026-06-30', new Date('2026-11-05')), null);
  assert.equal(validPeriod('2026-10-01', '2027-01-31', new Date('2026-11-05')), null);
});

test('carbon uses the calculator\'s own electricity factor and none for gas', () => {
  const e = carbonFor('electricity', 100, 'kWh');
  assert.equal(e.kg, Math.round(100 * FACTORS.electricity.value * 1000) / 1000);
  assert.equal(e.factorKey, 'electricity');
  assert.equal(carbonFor('png', 10, 'SCM').status, 'pending_factor');
  assert.equal(carbonFor('electricity', 100, 'SCM').status, 'pending_factor');
});

// ---------------------------------------------------------------------------
// Router registration: the routes the app calls must exist on the entry point.
// ---------------------------------------------------------------------------

/** Paths exactly as the app builds them (lib/state/utility_controller.dart). */
const APP_PATHS = [
  '/utilities/providers',
  '/utilities/bills/extract',
  '/utilities/bills/upload',
  '/utilities/verification',
  '/utilities/consumption/history',
  '/utilities/delete',
];

async function hitMain(path) {
  const sent = [];
  const res = { json: (body, status = 200) => { sent.push({ body, status }); return body; } };
  await main({ req: { path, headers: {}, body: '' }, res, log: () => {}, error: () => {} });
  return sent[0];
}

test('every utility path the app calls is registered on the entry point', async () => {
  assert.deepEqual(Object.keys(UTILITY_ROUTES).sort(), [...APP_PATHS].sort());
  for (const path of APP_PATHS) {
    const out = await hitMain(path);
    // Known route: it gets as far as authentication, which a call without a
    // token fails. An unregistered route would be a 404 instead.
    assert.equal(out.status, 200, path);
    assert.equal(out.body.error.code, 'unauthenticated', path);
  }
  // Trailing slashes and query strings resolve to the same route.
  assert.equal((await hitMain('/utilities/providers/')).body.error.code, 'unauthenticated');
  assert.equal((await hitMain('/utilities/providers?x=1')).body.error.code, 'unauthenticated');
});

test('a truly unknown path says so with its own code', async () => {
  const out = await hitMain('/utilities/nope');
  assert.equal(out.status, 404);
  assert.equal(out.body.error.code, 'unknown_route');
});

test('automatic bill fetching is not part of this build', async () => {
  for (const path of ['/utilities/electricity/fetch', '/utilities/gas/fetch']) {
    assert.equal(path in UTILITY_ROUTES, false, path);
    assert.equal((await hitMain(path)).body.error.code, 'unknown_route', path);
  }
});

// The app ships a copy of the public provider list (assets/config/
// utility_providers.json) so provider selection works even before this server
// is deployed. That copy must never drift from the registry.
test('the app\'s bundled provider list matches the server registry exactly', () => {
  const bundled = JSON.parse(
    readFileSync(new URL('../../../../assets/config/utility_providers.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(bundled, {
    regions: REGIONS,
    providers: listProviders({ country: 'IN' }),
    consent: { version: CONSENT_VERSION, purpose: CONSENT_PURPOSE },
  });
});

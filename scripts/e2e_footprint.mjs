/**
 * Live check of the footprint routes, as a throwaway member.
 *
 *   cd scripts && node e2e_footprint.mjs
 *
 * Mints a JWT with the server key, calls the real routes, reads the stored row
 * back, proves a different member cannot see it, and deletes everything it made.
 */
import { config } from 'dotenv';
config({ path: new URL('../.env', import.meta.url).pathname });

import { Account, Client, Databases, ExecutionMethod, Functions, ID, Query, Users } from 'node-appwrite';

const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY } = process.env;
const DB = 'dhara';

const admin = new Client().setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID).setKey(APPWRITE_API_KEY);
const users = new Users(admin);
const db = new Databases(admin);
const functions = new Functions(admin);

let failures = 0;
const ok = (m) => console.log(`  \u001b[32m✔\u001b[0m ${m}`);
const bad = (m) => { console.log(`  \u001b[31m✖\u001b[0m ${m}`); failures++; };
const check = (c, p, f) => (c ? ok(p) : bad(f));

const ids = [ID.unique(), ID.unique()];

async function call(jwt, path, body = {}) {
  const e = await functions.createExecution('api', JSON.stringify(body), false, path, ExecutionMethod.POST,
    { 'x-dhara-jwt': jwt, 'content-type': 'application/json' });
  try { return JSON.parse(e.responseBody); } catch { return { ok: false, error: { code: 'unparseable', message: e.responseBody.slice(0, 160) } }; }
}

/** Reads the member's own rows the way the app does: as the member. */
async function readAsMember(jwt, filter = []) {
  const client = new Client().setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID).setJWT(jwt);
  return new Databases(client).listDocuments(DB, 'footprints', [...filter, Query.limit(50)]);
}

/**
 * The first call to a freshly deployed runtime can fail at the platform level
 * (HTTP 500 "general_unknown", no function logs), then every later call works.
 * That is not what this script is testing, so warm the function up first and
 * say so rather than let it masquerade as a footprint failure.
 */
async function warmUp() {
  for (let i = 1; i <= 4; i++) {
    const e = await functions.createExecution('api', '', false, '/health', ExecutionMethod.GET, {});
    if (e.responseStatusCode === 200 && e.responseBody) {
      if (i > 1) console.log(`  (runtime needed ${i} attempts to warm up)`);
      return;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.log('  (runtime did not warm up; results below may include platform errors)');
}

async function main() {
  console.log('Live footprint routes\n');
  await warmUp();
  const [a, b] = ids;
  for (const [id, name] of [[a, 'FP Member A'], [b, 'FP Member B']]) {
    await users.create(id, `e2e-fp-${id}@dhara.invalid`, undefined, `Pw-${ID.unique()}-x9!`, name);
  }
  const jwtA = (await users.createJWT(a, undefined, 900)).jwt;
  const jwtB = (await users.createJWT(b, undefined, 900)).jwt;

  const inputs = { householdSize: 4, electricityKwh: 200, lpgCylinders: 1, carOccupants: 2,
    travel: { car_petrol: 300, bus: 100, flight_domestic: 1000 } };

  console.log('Estimate');
  const est = await call(jwtA, '/footprint/estimate', { inputs });
  check(est.ok, 'estimate answered', `estimate failed: ${JSON.stringify(est.error)}`);
  // Worked by hand: 36.35 + 10.435 + 24.228 + 10.151 + 75.59 = 156.754
  check(est.data?.footprint?.monthKg === 156.8, `monthly total is 156.8 kg (hand-calculated), server says ${est.data?.footprint?.monthKg}`, 'the server total differs from the hand calculation');
  check(est.data?.footprint?.factorsVersion === '2026.1', 'stamped with factor version 2026.1', 'factor version missing');
  check((await db.listDocuments(DB, 'footprints', [Query.equal('userId', a)])).total === 0, 'estimating saved nothing', 'estimate wrote a row');

  const empty = await call(jwtA, '/footprint/estimate', { inputs: {} });
  check(empty.error?.code === 'nothing_entered', 'an empty form is refused politely', `empty: ${JSON.stringify(empty).slice(0, 140)}`);
  const typo = await call(jwtA, '/footprint/estimate', { inputs: { travel: { flights: 5 } } });
  check(typo.error?.code === 'invalid_input', 'a mistyped travel type is refused', `typo: ${JSON.stringify(typo).slice(0, 140)}`);
  const anon = await call('not-a-token', '/footprint/estimate', { inputs });
  check(anon.error?.code === 'unauthenticated', 'a bad token is unauthenticated', `anon: ${JSON.stringify(anon).slice(0, 100)}`);

  console.log('\nSave and replace');
  const saved = await call(jwtA, '/footprint/save', { inputs });
  check(saved.ok && saved.data.saved.replaced === false, 'saved for the current month', `save: ${JSON.stringify(saved.error)}`);
  const again = await call(jwtA, '/footprint/save', { inputs: { ...inputs, electricityKwh: 400 } });
  check(again.ok && again.data.saved.replaced === true, 'saving again replaces it', `resave: ${JSON.stringify(again.error)}`);
  const rows = await db.listDocuments(DB, 'footprints', [Query.equal('userId', a)]);
  check(rows.total === 1, 'still exactly one row for the month', `expected 1 row, found ${rows.total}`);
  check(JSON.parse(rows.documents[0].inputs).electricityKwh === 400, 'the row holds the latest numbers', 'row was not updated');

  const old = await call(jwtA, '/footprint/save', { inputs, monthKey: '2001-01' });
  check(old.error?.code === 'invalid_month', 'a month outside the window is refused', `old month: ${JSON.stringify(old).slice(0, 120)}`);

  console.log('\nPrivacy');
  const mine = await readAsMember(jwtA);
  check(mine.total === 1, 'the owner can read their own footprint', `owner sees ${mine.total}`);
  const theirs = await readAsMember(jwtB);
  check(theirs.total === 0, "another member cannot see it", `member B sees ${theirs.total} row(s)!`);
  const denied = await call(jwtB, '/footprint/delete', { monthKey: rows.documents[0].monthKey });
  check(denied.error?.code === 'not_found', "another member cannot delete it", `delete by B: ${JSON.stringify(denied).slice(0, 120)}`);
  const adminList = await call(jwtA, '/admin/list', { list: 'footprints' });
  check(adminList.ok === false, 'the admin list route offers no per-member footprint rows (and refuses a non-admin)', `admin/list answered: ${JSON.stringify(adminList).slice(0, 120)}`);

  console.log('\nMethodology');
  const m = await call(jwtB, '/footprint/methodology');
  check(m.ok && m.data.factors.length === 10 && m.data.factors.every((f) => f.source), 'ten sourced factors served', `methodology: ${JSON.stringify(m.error)}`);
  check(m.data?.factors.find((f) => f.key === 'electricity')?.value === 0.727, 'grid factor is the CEA figure 0.727', 'wrong grid factor');

  console.log('\nDelete');
  const del = await call(jwtA, '/footprint/delete', { monthKey: rows.documents[0].monthKey });
  check(del.ok && del.data.removed, 'the owner can delete their month', `delete: ${JSON.stringify(del.error)}`);
  check((await db.listDocuments(DB, 'footprints', [Query.equal('userId', a)])).total === 0, 'and it is gone', 'row still present');
}

try {
  await main();
} catch (e) {
  bad(`unexpected error: ${String(e.message).replace(APPWRITE_API_KEY, '[key]')}`);
} finally {
  for (const id of ids) {
    const r = await db.listDocuments(DB, 'footprints', [Query.equal('userId', id)]).catch(() => null);
    for (const d of r?.documents ?? []) await db.deleteDocument(DB, 'footprints', d.$id).catch(() => {});
    await users.delete(id).catch(() => {});
  }
}
console.log(failures ? `\n\u001b[31m${failures} check(s) failed\u001b[0m` : '\n\u001b[32mAll checks passed\u001b[0m');
process.exit(failures ? 1 : 0);

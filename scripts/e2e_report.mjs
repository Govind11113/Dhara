/**
 * Live check of /admin/report, including the footprint privacy threshold.
 *
 *   cd scripts && node e2e_report.mjs <admin-email>
 *
 * Creates five throwaway members, gives each a footprint, and watches the real
 * report publish an average only once five have one, then withdraw it when one
 * is deleted. Everything created is removed at the end.
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

const ids = Array.from({ length: 5 }, () => ID.unique());
const month = new Date().toISOString().slice(0, 7);

async function call(jwt, path, body = {}) {
  const e = await functions.createExecution('api', JSON.stringify(body), false, path, ExecutionMethod.POST,
    { 'x-dhara-jwt': jwt, 'content-type': 'application/json' });
  try { return JSON.parse(e.responseBody); } catch { return { ok: false, error: { code: 'unparseable', message: e.responseBody.slice(0, 160) } }; }
}

async function warmUp() {
  for (let i = 0; i < 4; i++) {
    const e = await functions.createExecution('api', '', false, '/health', ExecutionMethod.GET, {});
    if (e.responseStatusCode === 200 && e.responseBody) return;
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function main() {
  console.log('Live impact report\n');
  await warmUp();

  const admin = (await users.list([Query.equal('email', ADMIN_EMAIL), Query.limit(1)])).users[0];
  if (!admin) { bad(`no account for ${ADMIN_EMAIL}`); return; }
  const adminJwt = (await users.createJWT(admin.$id, undefined, 900)).jwt;

  console.log('Shape and access');
  const plain = ID.unique();
  ids.push(plain);
  await users.create(plain, `e2e-rp-${plain}@dhara.invalid`, undefined, `Pw-${ID.unique()}-x9!`, 'Plain');
  const denied = await call((await users.createJWT(plain, undefined, 900)).jwt, '/admin/report');
  check(denied.error?.code === 'forbidden', 'a non-admin is refused the report', `non-admin got: ${JSON.stringify(denied).slice(0, 120)}`);

  const base = await call(adminJwt, '/admin/report', { months: 12 });
  check(base.ok, 'the admin gets a report', `report failed: ${JSON.stringify(base.error)}`);
  if (!base.ok) return;
  const r0 = base.data;
  check(r0.months.length === 12 && r0.series.length === 12, 'twelve months of trend', `months=${r0.months.length}`);
  check(r0.months.at(-1) === month, `ending this month (${month})`, `ends ${r0.months.at(-1)}`);
  check(typeof r0.totals.members === 'number' && r0.totals.trees >= 0, `totals present (${r0.totals.members} members, ${r0.totals.trees} trees)`, 'totals missing');
  check(r0.footprint.available === false, 'footprints are hidden while fewer than five members have one', `footprint: ${JSON.stringify(r0.footprint)}`);

  const six = await call(adminJwt, '/admin/report', { months: 6 });
  const huge = await call(adminJwt, '/admin/report', { months: 999 });
  const tiny = await call(adminJwt, '/admin/report', { months: 0 });
  check(six.data?.months.length === 6, '6 months can be asked for', `got ${six.data?.months.length}`);
  check(huge.data?.months.length === 24, 'a huge range is capped at 24', `got ${huge.data?.months.length}`);
  check(tiny.data?.months.length === 3, 'a tiny range is raised to 3', `got ${tiny.data?.months.length}`);

  const text = JSON.stringify(r0);
  check(!/@/.test(text.replace(/e2e-rp-[^"]*@dhara\.invalid/g, '')), 'no email addresses anywhere in the report', 'an email address is in the report');

  console.log('\nThe privacy threshold');
  const kgs = [100, 200, 300, 400, 500];
  for (let i = 0; i < 5; i++) {
    await users.create(ids[i], `e2e-rp-${ids[i]}@dhara.invalid`, undefined, `Pw-${ID.unique()}-x9!`, `Member ${i}`);
  }
  // Save four, as the real save route would, by electricity use that gives known totals.
  const save = async (i) => {
    const jwt = (await users.createJWT(ids[i], undefined, 900)).jwt;
    const r = await call(jwt, '/footprint/save', { inputs: { electricityKwh: Math.round(kgs[i] / 0.727 * 100) / 100 } });
    return r;
  };
  for (let i = 0; i < 4; i++) {
    const r = await save(i);
    if (!r.ok) bad(`member ${i} could not save: ${JSON.stringify(r.error)}`);
  }
  const four = (await call(adminJwt, '/admin/report', { months: 12 })).data;
  check(four.footprint.available === false, 'four members with footprints: still hidden', `available with four: ${JSON.stringify(four.footprint)}`);
  const fourText = JSON.stringify(four.footprint);
  check(!/avg|median|members\"/.test(fourText), 'and not even a count or average leaks', `leaked: ${fourText}`);

  const fifth = await save(4);
  check(fifth.ok, 'a fifth member saves', `fifth: ${JSON.stringify(fifth.error)}`);
  const five = (await call(adminJwt, '/admin/report', { months: 12 })).data;
  const f = five.footprint;
  check(f.available === true, 'five members: the average is published', `still hidden: ${JSON.stringify(f)}`);
  if (f.available) {
    check(f.members >= 5, `counting ${f.members} members`, `members=${f.members}`);
    // The five throwaway members average 300 kg; any real members would move it,
    // so only check the maths when exactly these five are counted.
    if (f.members === 5) check(Math.abs(f.avgMonthKg - 300) < 1, `average is 300 kg (hand-calculated), report says ${f.avgMonthKg}`, `average ${f.avgMonthKg} != 300`);
    check(!JSON.stringify(f).includes(ids[0]), 'no member id appears in the published section', 'a member id leaked');
    check(f.trend.find((t) => t.month === month)?.avgMonthKg !== null, 'this month\'s trend value is shown (five contributors)', 'trend suppressed unexpectedly');
  }

  const jwt0 = (await users.createJWT(ids[0], undefined, 900)).jwt;
  const del = await call(jwt0, '/footprint/delete', { monthKey: month });
  check(del.ok, 'one member deletes their footprint', `delete: ${JSON.stringify(del.error)}`);
  const after = (await call(adminJwt, '/admin/report', { months: 12 })).data;
  check(after.footprint.available === false, 'back to four: the average is withdrawn at once', `still shown: ${JSON.stringify(after.footprint)}`);

  console.log('\nNo per-member footprints through the list route');
  const list = await call(adminJwt, '/admin/list', { list: 'footprints' });
  check(list.error?.code === 'bad_request', 'the generic list route refuses to list footprints', `list answered: ${JSON.stringify(list).slice(0, 140)}`);
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

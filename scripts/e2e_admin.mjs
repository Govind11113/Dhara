/**
 * Live check of the /admin/ routes.
 *
 *   cd scripts && node e2e_admin.mjs <admin-email>
 *
 * Mints short-lived JWTs with the server key (no passwords involved), so it
 * can act as the real admin account and as a throwaway ordinary user to prove
 * the gate. Read-only against real data; the throwaway user is deleted at the
 * end. The write-route checks live in e2e_admin_write.mjs.
 */
import { config } from 'dotenv';
config({ path: new URL('../.env', import.meta.url).pathname });

import { Client, ExecutionMethod, Functions, ID, Query, Storage, Users } from 'node-appwrite';

const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY } = process.env;
// The admin account is passed in, never written into the repo: it is the login
// for the admin panel.
const ADMIN_EMAIL = process.argv[2] || process.env.ADMIN_EMAIL;
if (!ADMIN_EMAIL) {
  console.error('Usage: node %s <admin-email>   (or set ADMIN_EMAIL)', process.argv[1].split('/').pop());
  process.exit(1);
}

const client = new Client().setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID).setKey(APPWRITE_API_KEY);
const users = new Users(client);
const functions = new Functions(client);
const storage = new Storage(client);

let failures = 0;
const ok = (m) => console.log(`  \u001b[32m✔\u001b[0m ${m}`);
const bad = (m) => { console.log(`  \u001b[31m✖\u001b[0m ${m}`); failures++; };
const check = (c, p, f) => (c ? ok(p) : bad(f));

async function call(jwt, path, body = {}) {
  const e = await functions.createExecution(
    'api', JSON.stringify(body), false, path, ExecutionMethod.POST,
    { 'x-dhara-jwt': jwt, 'content-type': 'application/json' },
  );
  try { return JSON.parse(e.responseBody); } catch { return { ok: false, error: { code: 'unparseable', message: e.responseBody.slice(0, 160) } }; }
}

const throwaway = ID.unique();

async function main() {
  console.log('Live admin routes\n');

  const found = await users.list([Query.equal('email', ADMIN_EMAIL), Query.limit(1)]);
  const admin = found.users[0];
  if (!admin) { bad(`no account for ${ADMIN_EMAIL}`); return; }
  const adminJwt = (await users.createJWT(admin.$id, undefined, 900)).jwt;

  console.log('The gate');
  await users.create(throwaway, `e2e-${Date.now()}@dhara.invalid`, undefined, `Pw-${ID.unique()}-x9!`, 'Plain User');
  const plainJwt = (await users.createJWT(throwaway, undefined, 900)).jwt;
  for (const path of ['/admin/whoami', '/admin/stats', '/admin/list', '/admin/queue', '/admin/photo']) {
    const r = await call(plainJwt, path, { list: 'users' });
    check(r.ok === false && r.error?.code === 'forbidden', `${path} refuses an ordinary user`, `${path} answered an ordinary user: ${JSON.stringify(r).slice(0, 140)}`);
  }
  const anon = await call('not-a-real-token', '/admin/stats');
  check(anon.error?.code === 'unauthenticated', 'a bad token is unauthenticated', `bad token got: ${JSON.stringify(anon).slice(0, 120)}`);

  console.log('\nwhoami');
  const who = await call(adminJwt, '/admin/whoami');
  check(who.ok && who.data.isAdmin === true, `admin session recognised (${who.data?.email})`, `whoami: ${JSON.stringify(who).slice(0, 160)}`);

  console.log('\nstats');
  const st = await call(adminJwt, '/admin/stats');
  check(st.ok, 'stats returned', `stats failed: ${JSON.stringify(st.error)}`);
  if (st.ok) {
    const d = st.data;
    console.log(`     users=${d.users.total} trees=${d.trees.total} verifications=${d.verifications.total} credits issued=${d.credits.lifetimeIssued}`);
    console.log(`     queue: ${d.queue.trees} trees + ${d.queue.verifications} check-ins | open: ${d.open.flags} flags, ${d.open.feedback} feedback, ${d.open.redemptions} redemptions`);
    console.log(`     ai(7d): ${d.ai.total} calls, ${d.ai.approve} approve / ${d.ai.review} review / ${d.ai.reject} reject, ${d.ai.unavailable} unavailable, avg ${d.ai.avgLatencyMs}ms | model=${d.ai.model} onUnavailable=${d.ai.onUnavailable}`);
    check(typeof d.users.total === 'number' && typeof d.ai.total === 'number', 'numbers are numbers', 'stats shape is wrong');
    check(Number.isFinite(d.co2?.offsetGrams) && d.co2.offsetGrams >= 0, `CO2 credited is reported (${d.co2?.offsetGrams} g)`, `stats.co2 is wrong: ${JSON.stringify(d.co2)}`);
  }

  console.log('\nlists (every registered list, with its filters exercised)');
  const probes = {
    users: { isBanned: false },
    trees: { status: 'alive' },
    verifications: { status: 'approved' },
    flags: { resolved: false },
    feedback: { status: 'open' },
    redemptions: { status: 'pending' },
    inspections: { action: 'approve' },
    actions: {},
  };
  for (const [name, filters] of Object.entries(probes)) {
    const plain = await call(adminJwt, '/admin/list', { list: name, limit: 5 });
    const filt = await call(adminJwt, '/admin/list', { list: name, limit: 5, filters });
    const both = plain.ok && filt.ok;
    check(both, `${name.padEnd(13)} plain=${plain.data?.items?.length ?? '-'}/${plain.data?.total ?? '-'}  filtered=${filt.data?.items?.length ?? '-'}/${filt.data?.total ?? '-'}`,
      `${name} failed: plain=${JSON.stringify(plain.error)} filtered=${JSON.stringify(filt.error)}`);
  }
  const srch = await call(adminJwt, '/admin/list', { list: 'users', search: 'govind' });
  check(srch.ok, `user search works (${srch.data?.items?.length ?? 0} hit)`, `search failed: ${JSON.stringify(srch.error)}`);
  const leak = await call(adminJwt, '/admin/list', { list: 'users', limit: 50 });
  check(leak.ok && leak.data.items.every((u) => !('fcmToken' in u) && !('deviceFingerprint' in u)), 'device secrets are never returned', 'a device secret leaked');
  const evil = await call(adminJwt, '/admin/list', { list: 'users', filters: { email: 'x' } });
  check(evil.error?.code === 'bad_request', 'a filter outside the registry is refused', `evil filter got: ${JSON.stringify(evil).slice(0, 120)}`);

  console.log('\nreview queue');
  const q = await call(adminJwt, '/admin/queue');
  check(q.ok, `queue returned ${q.data?.items?.length ?? 0} item(s)`, `queue failed: ${JSON.stringify(q.error)}`);

  console.log('\nphoto');
  const files = await storage.listFiles('tree_photos', [Query.limit(1)]);
  if (files.files[0]) {
    const p = await call(adminJwt, '/admin/photo', { bucketId: 'tree_photos', fileId: files.files[0].$id });
    check(p.ok && p.data.dataUrl.startsWith('data:image/'), `photo served (${p.data?.mime}, ${p.data?.bytes} bytes)`, `photo failed: ${JSON.stringify(p.error)}`);
  } else {
    console.log('     (no photos in the bucket to test with)');
  }
  const nb = await call(adminJwt, '/admin/photo', { bucketId: 'profiles', fileId: 'x' });
  check(nb.error?.code === 'bad_request', 'a non-whitelisted bucket is refused', `bucket guard got: ${JSON.stringify(nb).slice(0, 120)}`);
}

try {
  await main();
} catch (e) {
  bad(`unexpected error: ${String(e.message).replace(APPWRITE_API_KEY, '[key]')}`);
} finally {
  await users.delete(throwaway).catch(() => {});
}
console.log(failures ? `\n\u001b[31m${failures} check(s) failed\u001b[0m` : '\n\u001b[32mAll checks passed\u001b[0m');
process.exit(failures ? 1 : 0);

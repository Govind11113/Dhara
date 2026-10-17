/**
 * End-to-end check of server-side photo verification against the LIVE project.
 *
 *   cd scripts && node e2e_vision.mjs
 *
 * Creates a throwaway user, uploads two photos (a real neem and an app-logo
 * graphic), calls /tree/plant for each exactly as the Flutter client does, and
 * checks the outcome and the ai_inspections rows. Everything it created is
 * deleted at the end, including on failure.
 *
 * Costs two free-model requests.
 */
import { config } from 'dotenv';
config({ path: new URL('../.env', import.meta.url).pathname });

import {
  Client, Databases, ExecutionMethod, Functions, ID, Permission,
  Query, Role, Storage, Users,
} from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';
import { existsSync, readFileSync } from 'node:fs';

const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY } = process.env;
const DB = 'dhara';
const CACHE = new URL('./.bench_cache/', import.meta.url).pathname;
const ASSETS = new URL('../assets/brand/', import.meta.url).pathname;

const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID)
  .setKey(APPWRITE_API_KEY);
const users = new Users(client);
const db = new Databases(client);
const storage = new Storage(client);
const functions = new Functions(client);

const ok = (m) => console.log(`  \u001b[32m✔\u001b[0m ${m}`);
const bad = (m) => { console.log(`  \u001b[31m✖\u001b[0m ${m}`); failures++; };
let failures = 0;

const userId = ID.unique();
const files = [];
const check = (cond, pass, fail) => (cond ? ok(pass) : bad(fail));

async function api(jwt, path, body) {
  const e = await functions.createExecution(
    'api', JSON.stringify(body), false, path, ExecutionMethod.POST,
    { 'x-dhara-jwt': jwt, 'content-type': 'application/json' },
  );
  try { return JSON.parse(e.responseBody); } catch { return { ok: false, raw: e.responseBody.slice(0, 200) }; }
}

async function upload(path, name) {
  const f = await storage.createFile(
    'tree_photos', ID.unique(), InputFile.fromBuffer(readFileSync(path), name),
    [Permission.read(Role.user(userId))],
  );
  files.push(f.$id);
  return f.$id;
}

/** A tiny perceptual-hash stand-in: unique per call so the duplicate check never trips. */
const fakeHash = () => Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

async function cleanup() {
  console.log('\nCleaning up');
  const sweep = async (col, field) => {
    let n = 0;
    for (let i = 0; i < 5; i++) {
      const r = await db.listDocuments(DB, col, [Query.equal(field, userId), Query.limit(100)]).catch(() => null);
      if (!r || !r.documents.length) break;
      for (const d of r.documents) { await db.deleteDocument(DB, col, d.$id).catch(() => {}); n++; }
    }
    if (n) console.log(`  - ${col}: ${n}`);
  };
  for (const [col, field] of [
    ['trees', 'ownerId'], ['ai_inspections', 'userId'], ['photo_hashes', 'userId'],
    ['fraud_flags', 'userId'], ['credit_ledger', 'userId'], ['notifications', 'userId'],
  ]) await sweep(col, field);
  await db.deleteDocument(DB, 'profiles', userId).catch(() => {});
  for (const id of files) await storage.deleteFile('tree_photos', id).catch(() => {});
  await users.delete(userId).catch(() => {});
  console.log('  - test user, profile and photos removed');
}

async function main() {
  console.log('Live end-to-end: server-side photo verification\n');

  await users.create(userId, `e2e-${Date.now()}@dhara.invalid`, undefined, `Pw-${ID.unique()}-x9!`, 'E2E Test');
  const jwt = (await users.createJWT(userId, undefined, 900)).jwt;
  const boot = await api(jwt, '/profile/bootstrap', { name: 'E2E Test' });
  check(boot.ok, 'test user and profile created', `bootstrap failed: ${JSON.stringify(boot).slice(0, 200)}`);

  const neem = [CACHE + 'plant-neem.jpg', '/tmp/plant.jpg'].find(existsSync);
  const base = { speciesCode: 'neem', nickname: 'e2e', accuracyM: 5, mocked: false, plantConfidence: 0.9 };

  // 1. A genuine neem photo.
  console.log('\n1. Genuine neem photo');
  const goodFile = await upload(neem, 'neem.jpg');
  const good = await api(jwt, '/tree/plant', { ...base, lat: 12.9716, lng: 77.5946, photoFileId: goodFile, phash: fakeHash() });
  console.log(`     response: ok=${good.ok} needsReview=${good.data?.needsReview} credits=${good.data?.creditsAwarded} reasons=${JSON.stringify(good.data?.reasons)}`);
  check(good.ok === true, 'accepted', `rejected: ${JSON.stringify(good.error)}`);
  check(good.data?.needsReview === false, 'not held for review', `held: ${JSON.stringify(good.data?.reasons)}`);
  check((good.data?.creditsAwarded ?? 0) > 0, `credits awarded (${good.data?.creditsAwarded})`, 'no credits awarded');
  const tree = good.data?.tree;
  check(tree?.aiModel === 'nvidia/nemotron-3.5-super-vl:free', `tree stamped with model ${tree?.aiModel}`, `tree aiModel was "${tree?.aiModel}" (AI did not run)`);
  check((tree?.aiConfidence ?? 0) > 0, `tree aiConfidence=${tree?.aiConfidence}`, 'tree has no aiConfidence');

  // 2. A graphic that is not a photo of a plant.
  console.log('\n2. App logo graphic (should be refused)');
  const fakeFile = await upload(ASSETS + 'logo.png', 'logo.png');
  const fake = await api(jwt, '/tree/plant', { ...base, lat: 12.9730, lng: 77.5960, photoFileId: fakeFile, phash: fakeHash() });
  console.log(`     response: ok=${fake.ok} error=${fake.error?.code}`);
  check(fake.ok === false, 'refused', 'a logo was accepted as a tree!');
  check(['ai_screen_photo', 'ai_not_a_plant'].includes(fake.error?.code), `refused for the right reason (${fake.error?.code})`, `wrong reason: ${fake.error?.code}`);

  // 3. The inspection log.
  console.log('\n3. ai_inspections log');
  await new Promise((r) => setTimeout(r, 1500));
  const rows = (await db.listDocuments(DB, 'ai_inspections', [Query.equal('userId', userId), Query.limit(20)])).documents;
  for (const r of rows) {
    console.log(`     ${r.refType.padEnd(11)} ${r.action.padEnd(7)} status=${r.status} ${r.latencyMs}ms attempts=${r.attempts} model=${r.model}`);
  }
  check(rows.length === 2, 'one row per call (2)', `expected 2 rows, found ${rows.length}`);
  check(rows.some((r) => r.action === 'approve'), 'an approve row exists', 'no approve row');
  check(rows.some((r) => r.action === 'reject'), 'a reject row exists (refused photos are logged too)', 'no reject row');
  check(rows.every((r) => r.provider === 'openrouter'), 'every row labelled openrouter', 'a row has the wrong provider');
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

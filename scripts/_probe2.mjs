/**
 * Throwaway. Answers two questions that change how the whole backend is written:
 *   1. Does node-appwrite 17 take positional or object params?
 *   2. Does the modern /tables/:id/rows endpoint work on collections that were
 *      created through the collections API? (decides Dart Databases vs TablesDB)
 */
import { config } from 'dotenv';
config({ path: new URL('../.env', import.meta.url).pathname });

import { Client, Databases, Query } from 'node-appwrite';
import { readFileSync } from 'node:fs';

const ENDPOINT = process.env.APPWRITE_ENDPOINT;
const PROJECT = process.env.APPWRITE_PROJECT_ID;
const KEY = process.env.APPWRITE_API_KEY;
const DB = 'dhara';

// --- 1. static signatures, multi-line aware ------------------------------
const dts = readFileSync(
  new URL('./node_modules/node-appwrite/dist/services/databases.d.ts', import.meta.url),
  'utf8',
);
console.log('--- declared signatures ---');
for (const name of ['listDocuments', 'getDocument', 'createDocument', 'updateDocument']) {
  const i = dts.indexOf(`\n    ${name}(`);
  if (i === -1) {
    console.log(`${name}: NOT FOUND`);
    continue;
  }
  const end = dts.indexOf(';', i);
  console.log(dts.slice(i + 5, end).replace(/\s+/g, ' '));
}

const client = new Client().setEndpoint(ENDPOINT).setProject(PROJECT).setKey(KEY);
const databases = new Databases(client);

// --- 2. positional vs object -------------------------------------------
console.log('\n--- live param style ---');
try {
  const r = await databases.listDocuments(DB, 'species', [Query.limit(2)]);
  console.log('POSITIONAL: ok, total =', r.total);
} catch (e) {
  console.log('POSITIONAL: FAILED', e.code, e.message?.slice(0, 90));
}
try {
  const r = await databases.listDocuments({
    databaseId: DB,
    collectionId: 'species',
    queries: [Query.limit(2)],
  });
  console.log('OBJECT: ok, total =', r.total);
} catch (e) {
  console.log('OBJECT: FAILED', e.code, e.message?.slice(0, 90));
}

// --- 3. rows endpoint on a collection-created resource ------------------
console.log('\n--- REST: rows vs documents ---');
const q = encodeURIComponent(JSON.stringify({ method: 'limit', values: [1] }));
for (const path of [
  `tables/${'species'}/rows`,
  `collections/${'species'}/documents`,
]) {
  try {
    const res = await fetch(`${ENDPOINT}/databases/${DB}/${path}?queries[]=${q}`, {
      headers: { 'X-Appwrite-Project': PROJECT, 'X-Appwrite-Key': KEY },
    });
    const text = await res.text();
    console.log(`${path} -> ${res.status} ${text.slice(0, 110)}`);
  } catch (e) {
    console.log(`${path} -> fetch error ${e.message}`);
  }
}

// --- 4. does the JWT-scoped Account path exist for requireUser? ---------
console.log('\n--- node-appwrite exports Account? ---');
const sdk = await import('node-appwrite');
console.log('Account:', 'Account' in sdk, '| TablesDB:', 'TablesDB' in sdk);

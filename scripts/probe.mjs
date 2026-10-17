import { config } from 'dotenv';
config({ path: new URL('../.env', import.meta.url).pathname });

import * as sdk from 'node-appwrite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(
  readFileSync(new URL('./node_modules/node-appwrite/package.json', import.meta.url)),
);
console.log('sdk version:', pkg.version);
console.log(
  'endpoint:', process.env.APPWRITE_ENDPOINT,
  '| project:', process.env.APPWRITE_PROJECT_ID,
  '| key len:', (process.env.APPWRITE_API_KEY || '').length,
);

const client = new sdk.Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT)
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);

const createMethods = (obj) =>
  Object.getOwnPropertyNames(Object.getPrototypeOf(obj))
    .filter((m) => m.startsWith('create'))
    .join(', ');

console.log('has TablesDB:', 'TablesDB' in sdk);
console.log('has Databases:', 'Databases' in sdk);
console.log('has Messaging:', 'Messaging' in sdk);

const health = new sdk.Health(client);
try {
  console.log('server version:', JSON.stringify(await health.getVersion()));
} catch (e) {
  console.log('getVersion err:', e.code, e.message);
}

if ('Databases' in sdk) {
  const db = new sdk.Databases(client);
  console.log('Databases.create*:', createMethods(db));
  try {
    const list = await db.list();
    console.log('databases:', list.total, list.databases.map((d) => d.$id).join(',') || '(none)');
  } catch (e) {
    console.log('db.list err:', e.code, e.message);
  }
}

if ('TablesDB' in sdk) {
  const tdb = new sdk.TablesDB(client);
  console.log('TablesDB.create*:', createMethods(tdb));
}

const storage = new sdk.Storage(client);
try {
  const b = await storage.listBuckets();
  console.log('buckets:', b.total, b.buckets.map((x) => x.$id).join(',') || '(none)');
} catch (e) {
  console.log('buckets err:', e.code, e.message);
}

const functions = new sdk.Functions(client);
try {
  const f = await functions.list();
  console.log('functions:', f.total, f.functions.map((x) => x.$id).join(',') || '(none)');
} catch (e) {
  console.log('functions err:', e.code, e.message);
}

const users = new sdk.Users(client);
try {
  console.log('users total:', (await users.list()).total);
} catch (e) {
  console.log('users err:', e.code, e.message);
}

console.log('RelationshipType:', JSON.stringify(sdk.RelationshipType ?? null));
console.log('IndexType:', JSON.stringify(sdk.IndexType ?? null));

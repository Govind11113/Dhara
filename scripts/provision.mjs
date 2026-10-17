/**
 * Idempotent Appwrite provisioner for Dhara Green Credits.
 *
 *   cd scripts && npm run provision
 *
 * Safe to re-run: existing resources are detected and skipped.
 */
import { config } from 'dotenv';
config({ path: new URL('../.env', import.meta.url).pathname });

import { Client, Databases, Storage, Compression, Query } from 'node-appwrite';
import { DB_ID, DB_NAME, COLLECTIONS, BUCKETS } from './schema.mjs';

const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY } = process.env;
if (!APPWRITE_ENDPOINT || !APPWRITE_PROJECT_ID || !APPWRITE_API_KEY) {
  console.error('Missing APPWRITE_* env vars. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID)
  .setKey(APPWRITE_API_KEY);

const db = new Databases(client);
const storage = new Storage(client);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (m) => console.log(`  \u001b[32m+\u001b[0m ${m}`);
const skip = (m) => console.log(`  \u001b[90m=\u001b[0m ${m}`);
const warn = (m) => console.log(`  \u001b[33m!\u001b[0m ${m}`);

const EXISTS = 409;

/**
 * Attributes fetched per page when polling status.
 *
 * Well above the largest collection in schema.mjs, because the default of 25 is
 * silently below it and the failure that causes is invisible.
 */
const ATTR_PAGE = 200;

/** Retries transient failures; treats 409 as success. */
async function idem(label, fn, tries = 4) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      await fn();
      ok(label);
      return true;
    } catch (e) {
      if (e.code === EXISTS) {
        skip(`${label} (exists)`);
        return false;
      }
      const retryable = e.code === 429 || e.code === 503 || e.code >= 500 || !e.code;
      if (retryable && attempt < tries) {
        await sleep(600 * attempt * attempt);
        continue;
      }
      warn(`${label} -> [${e.code}] ${e.message}`);
      return false;
    }
  }
  return false;
}

/**
 * Appwrite forbids a default value on a required attribute. When the schema
 * supplies both, the default wins and the attribute becomes optional, so
 * documents that omit the field still land on a sane value.
 */
function normalize(a) {
  const hasDefault = a.def !== null && a.def !== undefined;
  if (a.required && hasDefault) return { ...a, required: false };
  return a;
}

async function createAttribute(collectionId, raw) {
  const a = normalize(raw);
  const d = a.def === null ? undefined : a.def;
  const min = a.min === null ? undefined : a.min;
  const max = a.max === null ? undefined : a.max;
  const arr = a.array || false;
  const c = DB_ID;

  const call = {
    string: () => db.createStringAttribute(c, collectionId, a.key, a.size, a.required, d, arr),
    enum: () => db.createEnumAttribute(c, collectionId, a.key, a.elements, a.required, d, arr),
    integer: () => db.createIntegerAttribute(c, collectionId, a.key, a.required, min, max, d, arr),
    float: () => db.createFloatAttribute(c, collectionId, a.key, a.required, min, max, d, arr),
    boolean: () => db.createBooleanAttribute(c, collectionId, a.key, a.required, d, arr),
    datetime: () => db.createDatetimeAttribute(c, collectionId, a.key, a.required, d, arr),
    email: () => db.createEmailAttribute(c, collectionId, a.key, a.required, d, arr),
  }[a.kind];

  if (!call) throw new Error(`Unknown attribute kind: ${a.kind}`);
  return idem(`attr ${collectionId}.${a.key} (${a.kind})`, call);
}

/**
 * Indexes fail unless every attribute has finished processing.
 *
 * The limit is not optional. Appwrite pages this endpoint at 25, and an
 * attribute missing from the response reads as 'missing' rather than
 * 'processing' — so without it any collection past 25 attributes reported
 * "nothing pending" immediately and indexes were built against attributes that
 * were still coming up.
 */
async function waitForAttributes(collectionId, expected, timeoutMs = 150000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { attributes, total } = await db.listAttributes(DB_ID, collectionId, [
      Query.limit(ATTR_PAGE),
    ]);
    if (total > attributes.length) {
      warn(
        `${collectionId}: only saw ${attributes.length} of ${total} attributes; ` +
          'raise ATTR_PAGE',
      );
    }

    const byKey = new Map(attributes.map((x) => [x.key, x.status]));
    const pending = expected.filter((k) => byKey.get(k) === 'processing');
    const failed = expected.filter((k) => ['failed', 'stuck'].includes(byKey.get(k)));
    // Absent means the create call did not land. That was already reported by
    // idem() at creation, and no amount of waiting will conjure it, so it is
    // named here rather than waited on.
    const absent = expected.filter((k) => !byKey.has(k));

    if (failed.length) warn(`${collectionId}: attributes failed -> ${failed.join(', ')}`);
    if (absent.length) warn(`${collectionId}: attributes absent -> ${absent.join(', ')}`);
    if (!pending.length) return true;
    await sleep(1200);
  }
  warn(`${collectionId}: timed out waiting for attributes`);
  return false;
}

async function provisionCollection(spec) {
  console.log(`\n\u001b[1m${spec.id}\u001b[0m  (${spec.name})`);
  await idem(`collection ${spec.id}`, () =>
    db.createCollection(DB_ID, spec.id, spec.name, spec.permissions, spec.documentSecurity, true),
  );

  for (const attr of spec.attributes) {
    await createAttribute(spec.id, attr);
    await sleep(120);
  }

  await waitForAttributes(spec.id, spec.attributes.map((a) => a.key));

  for (const index of spec.indexes ?? []) {
    await idem(`index ${spec.id}.${index.key}`, () =>
      db.createIndex(
        DB_ID, spec.id, index.key, index.type, index.attributes,
        index.orders === null ? undefined : index.orders,
      ),
    );
    await sleep(250);
  }
}

async function main() {
  console.log(`\u001b[1mDhara provisioning\u001b[0m -> ${APPWRITE_ENDPOINT} / ${APPWRITE_PROJECT_ID}\n`);

  await idem(`database ${DB_ID}`, () => db.create(DB_ID, DB_NAME, true));

  for (const spec of COLLECTIONS) await provisionCollection(spec);

  console.log('\n\u001b[1mbuckets\u001b[0m');
  for (const b of BUCKETS) {
    await idem(`bucket ${b.id}`, () =>
      storage.createBucket(
        b.id, b.name, b.permissions, b.fileSecurity, true,
        b.maximumFileSize, b.allowedFileExtensions,
        b.compression === 'gzip' ? Compression.Gzip : Compression.None,
        b.encryption, b.antivirus,
      ),
    );
  }

  console.log('\n\u001b[32mProvisioning complete.\u001b[0m Run `npm run seed` next.');
}

main().catch((e) => {
  console.error('\nFATAL', e);
  process.exit(1);
});

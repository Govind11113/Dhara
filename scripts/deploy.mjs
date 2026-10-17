/**
 * Deploys functions/api and sets its server-side variables.
 *
 *   cd scripts && npm run deploy
 *
 * Appwrite wants a gzipped tar of the function directory with the entrypoint
 * at a path relative to the archive root. node_modules is excluded: the
 * `commands` step installs dependencies on the build machine.
 */
import { config } from 'dotenv';
config({ path: new URL('../.env', import.meta.url).pathname });

import { Client, Functions } from 'node-appwrite';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY, OPENROUTER_API_KEY } =
  process.env;

if (!APPWRITE_ENDPOINT || !APPWRITE_PROJECT_ID || !APPWRITE_API_KEY) {
  console.error('Missing APPWRITE_* env vars. Fill in .env first.');
  process.exit(1);
}

const FUNCTION_ID = 'api';
const SOURCE = new URL('../functions/api', import.meta.url).pathname;

const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID)
  .setKey(APPWRITE_API_KEY);

const functions = new Functions(client);

const ok = (m) => console.log(`  \u001b[32m+\u001b[0m ${m}`);
const warn = (m) => console.log(`  \u001b[33m!\u001b[0m ${m}`);

/**
 * Upserts a function variable.
 *
 * Appwrite has no upsert, and a duplicate key is a 409, so an existing
 * variable is deleted and recreated rather than left stale.
 */
async function setVariable(key, value) {
  if (!value) {
    warn(`${key} not set in .env — skipping (AI checks will no-op)`);
    return;
  }
  try {
    const existing = await functions.listVariables(FUNCTION_ID);
    const hit = existing.variables.find((v) => v.key === key);
    if (hit) await functions.deleteVariable(FUNCTION_ID, hit.$id);
  } catch (e) {
    warn(`could not list variables: ${e.message}`);
  }
  try {
    await functions.createVariable(FUNCTION_ID, key, value, true);
    ok(`variable ${key} (secret)`);
  } catch (e) {
    warn(`variable ${key} -> [${e.code}] ${e.message}`);
  }
}

async function removeVariable(key) {
  try {
    const existing = await functions.listVariables(FUNCTION_ID);
    const hit = existing.variables.find((v) => v.key === key);
    if (!hit) return;
    await functions.deleteVariable(FUNCTION_ID, hit.$id);
    ok(`removed stale variable ${key}`);
  } catch (e) {
    warn(`could not remove ${key}: ${e.message}`);
  }
}

async function main() {
  console.log(`\u001b[1mDeploying ${FUNCTION_ID}\u001b[0m -> ${APPWRITE_PROJECT_ID}\n`);

  try {
    const fn = await functions.get(FUNCTION_ID);
    ok(`function ${FUNCTION_ID} found (runtime ${fn.runtime})`);
  } catch (e) {
    console.error(
      `\nFunction "${FUNCTION_ID}" does not exist (${e.code}). Create it in the ` +
        'console first: Functions -> Create, ID "api", runtime Node 22, ' +
        'entrypoint src/main.js, execute access "Any".',
    );
    process.exit(1);
  }

  await setVariable('APPWRITE_API_KEY', APPWRITE_API_KEY);
  await setVariable('OPENROUTER_API_KEY', OPENROUTER_API_KEY);

  // Providers that were removed. Left in place they would sit in the function's
  // environment as dead secrets.
  await removeVariable('GEMINI_API_KEY');
  await removeVariable('OPENCODE_API_KEY');

  const archive = join(tmpdir(), `dhara-api-${Date.now()}.tar.gz`);
  execFileSync('tar', ['--exclude=node_modules', '-czf', archive, '-C', SOURCE, '.']);

  const bytes = readFileSync(archive);
  ok(`packed ${(bytes.length / 1024).toFixed(0)} KB`);

  try {
    const deployment = await functions.createDeployment(
      FUNCTION_ID,
      new File([bytes], 'code.tar.gz', { type: 'application/gzip' }),
      true,
      'src/main.js',
      'npm install',
    );
    ok(`deployment ${deployment.$id} (${deployment.status})`);
    console.log(
      '\n\u001b[32mUploaded.\u001b[0m Appwrite is building it now — watch the ' +
        'console for "ready" (usually under a minute).',
    );
  } catch (e) {
    warn(`deployment failed -> [${e.code}] ${e.message}`);
    process.exit(1);
  } finally {
    rmSync(archive, { force: true });
  }
}

main().catch((e) => {
  console.error('\nFATAL', e);
  process.exit(1);
});

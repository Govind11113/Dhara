/**
 * Builds and deploys the admin panel to an Appwrite Site.
 *
 *   cd scripts && npm run deploy:admin
 *
 * Uploads the *built* bundle (admin/dist) rather than the source, so what runs
 * is exactly what was type-checked, tested and secret-scanned here, with no
 * second build on a different Node version.
 *
 * The site holds no secrets. Only the public endpoint and project id are baked
 * in; every privileged call goes through the `api` function, which checks the
 * signed-in user's admin label.
 */
import { config } from 'dotenv';
config({ path: new URL('../.env', import.meta.url).pathname });

import { Adapter, BuildRuntime, Client, Framework, ID, Sites } from 'node-appwrite';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY } = process.env;
if (!APPWRITE_ENDPOINT || !APPWRITE_PROJECT_ID || !APPWRITE_API_KEY) {
  console.error('Missing APPWRITE_* env vars. Fill in .env first.');
  process.exit(1);
}

const SITE_ID = 'admin';
const SITE_NAME = 'Dhara Admin';
const ADMIN_DIR = new URL('../admin', import.meta.url).pathname;
const DIST = join(ADMIN_DIR, 'dist');

const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID)
  .setKey(APPWRITE_API_KEY);
const sites = new Sites(client);

const ok = (m) => console.log(`  \u001b[32m+\u001b[0m ${m}`);
const warn = (m) => console.log(`  \u001b[33m!\u001b[0m ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Keys the bundle must never contain. Checked on the real output, not the source. */
function scanBundle(dir) {
  const bad = [
    [/standard_[0-9a-f]{40,}/, 'an Appwrite server API key'],
    [/oc_sk_[A-Za-z0-9_-]{10,}/, 'an OpenCode key'],
    [/sk-or-v1-[0-9a-f]{20,}/, 'an OpenRouter key'],
  ];
  const hits = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else {
        const text = readFileSync(p, 'latin1');
        for (const [re, what] of bad) if (re.test(text)) hits.push(`${p}: ${what}`);
      }
    }
  };
  walk(dir);
  return hits;
}

async function rest(path, init = {}) {
  const res = await fetch(`${APPWRITE_ENDPOINT}${path}`, {
    ...init,
    headers: {
      'x-appwrite-project': APPWRITE_PROJECT_ID,
      'x-appwrite-key': APPWRITE_API_KEY,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  let body = null;
  try { body = await res.json(); } catch { /* not json */ }
  return { status: res.status, body };
}

async function main() {
  console.log(`\u001b[1mDeploying the admin site\u001b[0m -> ${APPWRITE_PROJECT_ID}\n`);

  // 1. Build, then check what was built.
  console.log('Building');
  execFileSync('npm', ['run', 'build'], { cwd: ADMIN_DIR, stdio: 'inherit', env: { ...process.env, npm_config_cache: process.env.npm_config_cache ?? '' } });
  const leaks = scanBundle(DIST);
  if (leaks.length) {
    console.error('\nRefusing to deploy: the bundle contains secrets:\n  ' + leaks.join('\n  '));
    process.exit(2);
  }
  ok('bundle scanned: no server keys inside');

  // 2. Create the site once.
  let site;
  try {
    site = await sites.get(SITE_ID);
    ok(`site "${SITE_ID}" exists`);
  } catch (e) {
    if (e.code !== 404) throw e;
    site = await sites.create(
      SITE_ID, SITE_NAME, Framework.Other, BuildRuntime.Node22,
      true, true, 15, '', '', './', Adapter.Static, undefined, 'index.html',
    );
    ok(`site "${SITE_ID}" created`);
  }

  // 3. Upload the bundle.
  const archive = join(tmpdir(), `dhara-admin-${Date.now()}.tar.gz`);
  execFileSync('tar', ['-czf', archive, '-C', DIST, '.']);
  const bytes = readFileSync(archive);
  ok(`packed ${(bytes.length / 1024).toFixed(0)} KB`);

  let deployment;
  try {
    deployment = await sites.createDeployment(
      SITE_ID, new File([bytes], 'admin.tar.gz', { type: 'application/gzip' }), true, '', '', './',
    );
    ok(`deployment ${deployment.$id} uploaded`);
  } finally {
    rmSync(archive, { force: true });
  }

  // 4. Wait for it to go live.
  let status = deployment.status;
  for (let i = 0; i < 60 && !['ready', 'failed', 'canceled'].includes(status); i++) {
    await sleep(3000);
    status = (await sites.getDeployment(SITE_ID, deployment.$id)).status;
  }
  if (status !== 'ready') {
    const d = await sites.getDeployment(SITE_ID, deployment.$id);
    console.error(`\nDeployment ended as "${status}".\n${String(d.buildLogs ?? '').slice(-1500)}`);
    process.exit(1);
  }
  ok('deployment is ready');

  const live = await sites.get(SITE_ID);
  if (live.deploymentId !== deployment.$id) {
    await sites.updateSiteDeployment(SITE_ID, deployment.$id);
    ok('activated');
  }

  // 5. Give it a public address.
  //
  // A deployment only gets a *preview* URL, and Appwrite puts that behind a
  // console sign-in ("Sign in again to view this preview"). The public address
  // is a separate site rule, created once and then left alone.
  const found = await rest(`/proxy/rules?queries[]=${encodeURIComponent(JSON.stringify({ method: 'limit', values: [100] }))}`);
  if (found.status !== 200) {
    warn(`could not read domain rules (HTTP ${found.status}); add a domain under Console -> Sites -> ${SITE_NAME} -> Domains`);
    return [];
  }
  let rule = (found.body?.rules ?? []).find(
    (r) => r.deploymentResourceType === 'site' && r.deploymentResourceId === SITE_ID && r.trigger === 'manual',
  );
  if (!rule) {
    const suffix = Math.random().toString(36).slice(2, 8);
    const made = await rest('/proxy/rules/site', {
      method: 'POST',
      body: JSON.stringify({ domain: `dhara-admin-${suffix}.appwrite.network`, siteId: SITE_ID }),
    });
    if (made.status !== 201) {
      warn(`could not create a public domain (HTTP ${made.status}: ${String(made.body?.message ?? '').slice(0, 120)}); add one in the console`);
      return [];
    }
    rule = made.body;
    ok(`created public domain ${rule.domain}`);
  }

  ok(`live at https://${rule.domain}`);
  await registerPlatforms([rule.domain]);
  console.log('\n\u001b[32mDeployed.\u001b[0m');
  return [rule.domain];
}

/**
 * Appwrite refuses browser requests from any host that is not a registered web
 * platform ("Invalid Origin", HTTP 403), so the site's own hostname has to be
 * added or nobody can sign in. Idempotent: hosts already registered are skipped.
 */
async function registerPlatforms(domains) {
  const existing = await rest('/project/platforms');
  if (existing.status !== 200) {
    warn(`could not read platforms (HTTP ${existing.status}); add ${domains.join(', ')} by hand under Console -> Overview -> Platforms`);
    return;
  }
  const have = new Set((existing.body?.platforms ?? []).map((p) => p.hostname).filter(Boolean));

  for (const hostname of domains) {
    if (have.has(hostname)) {
      ok(`platform for ${hostname} already registered`);
      continue;
    }
    const res = await rest('/project/platforms/web', {
      method: 'POST',
      body: JSON.stringify({ platformId: ID.unique(), name: `Dhara Admin (${hostname})`.slice(0, 128), hostname }),
    });
    if (res.status === 201 || res.status === 200) ok(`registered ${hostname} as a web platform`);
    else warn(`could not register ${hostname} (HTTP ${res.status}: ${String(res.body?.message ?? '').replace(APPWRITE_API_KEY, '[key]').slice(0, 120)}) - add it by hand under Console -> Overview -> Platforms`);
  }
}

main().catch((e) => {
  console.error('\nFATAL', String(e.stack ?? e.message).replace(APPWRITE_API_KEY, '[key]'));
  process.exit(1);
});

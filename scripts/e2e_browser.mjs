/**
 * Browser end-to-end test of the admin panel, against the LIVE Appwrite project.
 *
 *   npm i --no-save --prefix /tmp/pw playwright-core      # once; uses installed Chrome
 *   cd scripts && PW_CORE=/tmp/pw/node_modules/playwright-core node e2e_browser.mjs
 *
 * Serves admin/dist locally (localhost is an accepted origin for the project),
 * then drives a real Chrome through the real UI:
 *
 *   - a non-admin account is refused and signed out
 *   - a throwaway admin signs in, approves a held tree (credits land once),
 *     replies to feedback, changes a setting, suspends and restores a member
 *   - the audit log shows what was done, and sign-out works
 *
 * Everything runs on throwaway accounts and synthetic records. The real review
 * queue item is never selected. All created data is deleted at the end.
 */
import { config } from 'dotenv';
config({ path: new URL('../.env', import.meta.url).pathname });

import { Client, Databases, ID, Permission, Query, Role, Storage, Users } from 'node-appwrite';
import { InputFile } from 'node-appwrite/file';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';

const playwright = await import(process.env.PW_CORE || 'playwright-core');
const chromium = playwright.chromium ?? playwright.default.chromium;

const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY } = process.env;
const DB = 'dhara';
const ADMIN_DIR = new URL('../admin', import.meta.url).pathname;
const SHOTS = process.env.SHOTS || '/tmp/pw/shots';
const PORT = 4173;
const SITE = process.env.SITE_URL || `http://localhost:${PORT}`;

const client = new Client().setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID).setKey(APPWRITE_API_KEY);
const users = new Users(client);
const db = new Databases(client);
const storage = new Storage(client);

let failures = 0;
const ok = (m) => console.log(`  \u001b[32m✔\u001b[0m ${m}`);
const bad = (m) => { console.log(`  \u001b[31m✖\u001b[0m ${m}`); failures++; };
const check = (c, p, f) => (c ? ok(p) : bad(f));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const stamp = Date.now();
const pw = `Pw-${ID.unique()}-aZ9!`;
const adminId = ID.unique();
const plainId = ID.unique();
const memberId = ID.unique();
const treeId = ID.unique();
const adminEmail = `e2e-admin-${stamp}@dhara.invalid`;
const plainEmail = `e2e-plain-${stamp}@dhara.invalid`;
let fileId = null;
let feedbackId = null;
let configBefore = null;
let server = null;

async function startServer() {
  if (process.env.SITE_URL) return;
  server = spawn(`${ADMIN_DIR}/node_modules/.bin/vite`, ['preview', '--port', String(PORT), '--strictPort'], { cwd: ADMIN_DIR, stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(SITE)).ok) return; } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('preview server did not start');
}

async function seed() {
  await users.create(adminId, adminEmail, undefined, pw, 'E2E Admin');
  await users.updateLabels(adminId, ['admin']);
  await users.create(plainId, plainEmail, undefined, pw, 'E2E Plain');
  await users.create(memberId, `e2e-member-${stamp}@dhara.invalid`, undefined, pw, 'E2E Member');

  await db.createDocument(DB, 'profiles', memberId, {
    userId: memberId, name: 'E2E Member', email: `e2e-member-${stamp}@dhara.invalid`,
    creditsAvailable: 0, creditsLifetime: 0, creditsPending: 0, creditsSpent: 0, xp: 0, level: 1,
    treesPlanted: 1, treesAlive: 0, bottlesReturned: 0, co2OffsetGrams: 0, streakCount: 0, longestStreak: 0,
    trustScore: 92, isBanned: false, electricityVerified: false,
  });

  const photo = ['/tmp/plant.jpg', new URL('./.bench_cache/plant-neem.jpg', import.meta.url).pathname].find((p) => {
    try { readFileSync(p); return true; } catch { return false; }
  });
  const file = await storage.createFile('tree_photos', ID.unique(), InputFile.fromBuffer(readFileSync(photo), 'e2e.jpg'), [Permission.read(Role.user(memberId))]);
  fileId = file.$id;

  await db.createDocument(DB, 'trees', treeId, {
    ownerId: memberId, speciesCode: 'neem', speciesName: 'Neem', nickname: 'E2E tree',
    lat: 12.97, lng: 77.59, geohash: 'tdr1vxxxx', accuracyM: 8, addressLabel: 'Test Street, Bengaluru',
    plantPhotoFileId: fileId, plantedAt: new Date().toISOString(), status: 'pending_review',
    rejectReason: 'ai_low_confidence', markerCode: `E2E-${stamp}`,
    aiVerdict: 'conf=0.55 plant=true real=true species=Neem (Azadirachta indica) match=true concerns=photo is slightly dark',
    aiConfidence: 0.55, aiModel: 'nvidia/nemotron-3.5-super-vl:free',
  });

  const fb = await db.createDocument(DB, 'feedback', ID.unique(), {
    userId: memberId, category: 'idea', message: 'E2E: please add a dark mode to the app.',
    deviceModel: 'Pixel 8 (SDK 35)', platform: 'android', appVersion: '1.0.0+1', status: 'open', adminReply: '',
    createdAt: new Date().toISOString(),
  }, [Permission.read(Role.user(memberId))]);
  feedbackId = fb.$id;

  const cfg = (await db.listDocuments(DB, 'app_config', [Query.equal('key', 'vision.on_unavailable'), Query.limit(1)])).documents[0];
  configBefore = { id: cfg.$id, value: cfg.value };
}

async function cleanup() {
  console.log('\nCleaning up');
  if (configBefore) await db.updateDocument(DB, 'app_config', configBefore.id, { value: configBefore.value }).catch(() => {});
  const sweep = async (col, field, value) => {
    for (let i = 0; i < 5; i++) {
      const r = await db.listDocuments(DB, col, [Query.equal(field, value), Query.limit(100)]).catch(() => null);
      if (!r || !r.documents.length) break;
      for (const d of r.documents) await db.deleteDocument(DB, col, d.$id).catch(() => {});
    }
  };
  await sweep('trees', 'ownerId', memberId);
  for (const c of ['credit_ledger', 'notifications', 'feedback', 'fraud_flags']) await sweep(c, 'userId', memberId);
  await sweep('admin_actions', 'adminId', adminId);
  await db.deleteDocument(DB, 'profiles', memberId).catch(() => {});
  if (fileId) await storage.deleteFile('tree_photos', fileId).catch(() => {});
  for (const id of [adminId, plainId, memberId]) await users.delete(id).catch(() => {});
  if (server) server.kill();
  console.log('  - throwaway accounts, records, photo and audit rows removed; setting restored');
}

const nav = (page, name) => page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name });

async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function login(page, email) {
  await page.goto(SITE);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(pw);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  console.log(`Browser end-to-end -> ${SITE}\n`);
  await startServer();
  await seed();

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  try {
    console.log('Sign in');
    await page.goto(SITE);
    await page.getByRole('heading', { name: 'Dhara Admin' }).waitFor();
    ok('login page shown to a visitor');
    await shot(page, '01-login');

    await login(page, plainEmail);
    await page.getByText('not an administrator').first().waitFor({ timeout: 20000 });
    ok('a non-admin account is refused with a clear message');
    check(await page.getByRole('navigation', { name: 'Main' }).count() === 0, 'and never sees the admin navigation', 'non-admin saw the navigation');

    await login(page, adminEmail);
    await page.getByRole('navigation', { name: 'Main' }).waitFor({ timeout: 25000 });
    ok('the admin signs in and lands in the panel');
    check(page.url().endsWith('/#/queue'), 'on the review queue', `landed on ${page.url()}`);

    console.log('\nReview queue');
    const card = page.locator('li.card', { hasText: 'E2E tree' });
    await card.waitFor({ timeout: 20000 });
    ok('the held tree is in the queue');
    const img = card.locator('img');
    await img.waitFor({ timeout: 20000 });
    check(await img.evaluate((el) => el.naturalWidth > 0), 'its private photo loaded through the API', 'photo did not render');
    check((await card.innerText()).includes('A plant is visible') && (await card.innerText()).includes('55%'), 'AI reasoning is shown in plain words with the confidence', 'AI panel missing');
    check((await card.innerText()).includes('trust 92'), 'member trust score is shown', 'trust score missing');
    await shot(page, '02-queue');

    await card.getByRole('button', { name: 'Approve' }).click();
    await page.getByText(/Approved\. 5 credits paid/).waitFor({ timeout: 20000 });
    ok('approved from the browser: "5 credits paid"');
    await card.waitFor({ state: 'detached', timeout: 5000 });
    ok('the card left the queue');
    const tree = await db.getDocument(DB, 'trees', treeId);
    const prof = await db.getDocument(DB, 'profiles', memberId);
    const ledger = await db.listDocuments(DB, 'credit_ledger', [Query.equal('userId', memberId)]);
    check(tree.status === 'alive' && prof.creditsAvailable === 5 && ledger.total === 1, 'database agrees: tree alive, 5 credits, one ledger row', `tree=${tree.status} credits=${prof.creditsAvailable} rows=${ledger.total}`);

    console.log('\nDashboard');
    await nav(page, 'Dashboard').click();
    await page.getByRole('heading', { name: 'Needs attention' }).waitFor();
    await page.getByRole('heading', { name: /AI photo check/ }).waitFor();
    ok('stats and the AI section render');
    await page.getByText('CO₂ credited').waitFor();
    check((await page.locator('.tile', { hasText: 'CO₂ credited' }).innerText()).match(/\d+(\.\d)? (g|kg|t)/), 'the CO₂ credited tile shows a figure with a unit', 'CO₂ tile has no figure');
    await shot(page, '03-dashboard');

    console.log('\nFeedback');
    await nav(page, 'Feedback').click();
    const fbCard = page.locator('li.card', { hasText: 'E2E: please add a dark mode' });
    await fbCard.waitFor({ timeout: 20000 });
    check((await fbCard.innerText()).includes('Pixel 8'), 'device details are shown', 'device info missing');
    await shot(page, '04-feedback');
    await fbCard.getByLabel(/Your reply/).fill('Thanks, dark mode is on the roadmap.');
    await fbCard.getByRole('button', { name: 'Send reply' }).click();
    await page.getByText(/Reply sent/).waitFor({ timeout: 20000 });
    const fb = await db.getDocument(DB, 'feedback', feedbackId);
    check(fb.status === 'answered' && fb.adminReply.startsWith('Thanks, dark mode'), 'reply stored and feedback answered', `feedback is ${fb.status}`);

    console.log('\nMembers');
    await nav(page, 'Members').click();
    await page.getByLabel('Search members by name').fill('E2E Member');
    await page.getByRole('button', { name: 'Search' }).click();
    const row = page.locator('tr', { hasText: 'E2E Member' });
    await row.waitFor({ timeout: 20000 });
    await shot(page, '05-members');
    await row.getByRole('button', { name: /Suspend/ }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Reason').fill('End to end test suspension.');
    await dlg.getByRole('button', { name: 'Suspend' }).click();
    await page.getByText(/has been suspended/).waitFor({ timeout: 20000 });
    check((await db.getDocument(DB, 'profiles', memberId)).isBanned === true, 'member suspended in the database', 'ban not stored');
    await page.locator('tr', { hasText: 'E2E Member' }).getByRole('button', { name: 'Restore' }).click();
    await page.getByText(/has been restored/).waitFor({ timeout: 20000 });
    check((await db.getDocument(DB, 'profiles', memberId)).isBanned === false, 'and restored', 'unban not stored');

    console.log('\nPages not covered above');
    for (const [link, heading] of [['Trees', 'Trees'], ['Fraud flags', 'Fraud flags'], ['Redemptions', 'Redemptions']]) {
      await nav(page, link).click();
      await page.getByRole('heading', { name: heading, exact: true }).waitFor({ timeout: 20000 });
      // Let the list settle into data, an empty state or an error.
      await page.locator('table, .empty, .error-box').first().waitFor({ timeout: 20000 });
      const errors = await page.locator('.error-box').allInnerTexts();
      check(errors.length === 0, `${link} loads without an error`, `${link} shows an error: ${errors.join(' | ')}`);
    }
    await nav(page, 'Trees').click();
    await page.locator('tr', { hasText: 'E2E tree' }).waitFor({ timeout: 20000 });
    check((await page.locator('tr', { hasText: 'E2E tree' }).innerText()).includes('0/12'), 'tree progress reads from the tree itself (0/12)', 'tree progress column is wrong');
    await shot(page, '05b-trees');

    console.log('\nImpact report');
    await nav(page, 'Impact report').click();
    await page.getByRole('heading', { name: 'Impact report', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'By month' }).waitFor({ timeout: 25000 });
    check(await page.locator('.error-box').count() === 0 || (await page.locator('.error-box').allInnerTexts()).every((t) => /most recent 1,000/.test(t)), 'the report loads without an error', 'the report shows an error');
    check(await page.locator('figure.chart svg[role="img"]').count() === 4, 'four monthly charts, each with a text label for screen readers', 'chart count is wrong');
    check(await page.locator('figure.chart table.sr-only').count() === 4, 'and each chart also has its data as a table', 'chart data tables missing');
    check(await page.locator('.tile', { hasText: 'Survival rate' }).count() === 1, 'headline figures are shown', 'KPI tiles missing');
    check(await page.getByText('Not shown yet.').count() === 1, 'carbon footprints are hidden below five members, with the reason', 'footprint privacy notice missing');
    check((await page.locator('#footprint').locator('..').innerText()).includes('never visible to the team'), 'and it promises individuals are never visible', 'privacy wording missing');
    await shot(page, '05c-report');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Monthly activity (CSV)' }).click(),
    ]);
    const csv = readFileSync(await download.path(), 'utf8');
    const lines = csv.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean);
    check(csv.startsWith('\uFEFF'), 'the CSV starts with a byte-order mark so Excel reads it as UTF-8', 'no BOM');
    check(lines[0] === 'Month,Trees planted,Check-ins approved,New members,CO2 credited (kg)', 'the CSV header is right', `header: ${lines[0]}`);
    check(lines.length === 13, 'twelve months of rows', `rows: ${lines.length - 1}`);
    check(/^\d{4}-\d{2},/.test(lines[1]) && download.suggestedFilename().startsWith('dhara-impact-monthly-'), `downloaded as ${download.suggestedFilename()}`, `filename ${download.suggestedFilename()}`);

    await page.getByLabel('Period').selectOption('6');
    await page.waitForFunction(() => document.querySelectorAll('figure.chart')[0]?.querySelectorAll('rect').length === 6, null, { timeout: 25000 });
    ok('changing the period to 6 months redraws the charts');

    console.log('\nAI and settings');
    await nav(page, 'AI & settings').click();
    await page.getByRole('heading', { name: 'Settings' }).waitFor({ timeout: 20000 });
    const select = page.getByLabel('If the AI is down');
    const current = await select.inputValue();
    const flip = current === 'review' ? 'approve' : 'review';
    await select.selectOption(flip);
    await page.locator('.setting', { hasText: 'If the AI is down' }).getByRole('button', { name: 'Save' }).click();
    await page.getByText(/If the AI is down updated/).waitFor({ timeout: 20000 });
    const cfg = await db.getDocument(DB, 'app_config', configBefore.id);
    check(cfg.value === flip, `setting changed ${current} -> ${flip}`, `setting is ${cfg.value}`);
    await shot(page, '06-ai-settings');

    console.log('\nAudit log');
    await nav(page, 'Audit log').click();
    await page.getByRole('table', { name: 'Audit log' }).waitFor({ timeout: 20000 });
    const text = await page.getByRole('table', { name: 'Audit log' }).innerText();
    check(['Review approve', 'Feedback reply', 'User ban', 'User unban', 'Config set'].every((a) => text.includes(a)), 'every action above is in the audit log', `audit log was: ${text.slice(0, 200)}`);
    check(text.includes(adminEmail), 'with the admin who did it', 'admin email missing from the log');
    await shot(page, '07-audit');

    console.log('\nSign out');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('heading', { name: 'Dhara Admin' }).waitFor();
    ok('signed out, back at the login page');
    await page.goto(`${SITE}/#/users`);
    await page.getByRole('heading', { name: 'Dhara Admin' }).waitFor();
    ok('a deep link no longer opens without a session');

    check(errors.length === 0, 'no uncaught browser errors', `browser errors: ${errors.join(' | ')}`);
  } catch (e) {
    await shot(page, 'failure').catch(() => {});
    bad(`${String(e.message).split('\n')[0]}`);
  } finally {
    await browser.close();
  }
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

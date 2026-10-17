/**
 * Acceptance benchmark for a vision model behind the OpenCode API.
 *
 *   cd scripts && node bench_vision.mjs                    # default shortlist
 *   cd scripts && node bench_vision.mjs step-5-preview-free glm-5.3-flash-free
 *
 * Runs the *real* buildPrompt / parseVerdict / decide from the function, so the
 * numbers describe what production would do rather than a lookalike.
 *
 * Gate (a model must clear all three to be used as the checker):
 *   - catches >= 90% of fake photos (graphics, objects, screens)
 *   - returns valid JSON on >= 95% of calls
 *   - median latency < 8 s
 *
 * Fixtures are downloaded once into scripts/.bench_cache (gitignored).
 * The API key is read from .env and is never printed.
 */
import { config } from 'dotenv';
config({ path: new URL('../.env', import.meta.url).pathname });

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPrompt, decide, parseVerdict } from '../functions/api/src/lib/vision.js';

const PROVIDER = process.env.BENCH_PROVIDER || 'opencode';

const PROVIDERS = {
  opencode: {
    keyVar: 'OPENCODE_API_KEY',
    base: process.env.OPENCODE_BASE_URL || 'https://opencode.ai/zen/v1',
    paceMs: 0,
    models: [
      'step-5-preview-free',
      'glm-5.3-flash-free',
      'deepseek-v4.1-flash-free',
      'mimo-v2.6-flash-free',
      'longcat-2.5-preview-free',
      'space-bunny-free',
      'nemotron-3.5-super-vl-free',
    ],
  },
  openrouter: {
    keyVar: 'OPENROUTER_API_KEY',
    base: 'https://openrouter.ai/api/v1',
    // Free models are capped per minute, so calls are spaced out rather than
    // fired in a burst that would get most of them 429'd and skew the result.
    paceMs: 3500,
    models: [
      'google/gemma-4-31b-it:free',
      'google/gemma-4-26b-a4b-it:free',
      'nvidia/nemotron-3.5-super-vl:free',
    ],
  },
};

const P = PROVIDERS[PROVIDER];
if (!P) {
  console.error(`Unknown BENCH_PROVIDER "${PROVIDER}". Use: ${Object.keys(PROVIDERS).join(', ')}`);
  process.exit(1);
}

const KEY = process.env[P.keyVar];
if (!KEY) {
  console.error(`${P.keyVar} missing from .env`);
  process.exit(1);
}

const BASE = P.base;
const CACHE = new URL('./.bench_cache', import.meta.url).pathname;
const ASSETS = new URL('../assets/brand', import.meta.url).pathname;
const UA = 'dhara-bench/1.0 (vision acceptance test)';

const models = process.argv.slice(2).length ? process.argv.slice(2) : P.models;

/** kind: plant = genuine photo of a plant; fake = should be rejected outright. */
const FIXTURES = [
  { id: 'plant-neem', kind: 'plant', species: 'Neem', search: 'Azadirachta indica neem tree' },
  { id: 'plant-mango', kind: 'plant', species: 'Mango', search: 'mango tree Mangifera indica' },
  { id: 'plant-banyan', kind: 'plant', species: 'Banyan', search: 'banyan tree Ficus benghalensis' },
  { id: 'plant-coconut', kind: 'plant', species: 'Coconut', search: 'coconut palm tree trunk fronds' },
  { id: 'plant-bamboo', kind: 'plant', species: 'Bamboo', search: 'bamboo grove' },
  { id: 'plant-sapling', kind: 'plant', species: 'Other', search: 'newly planted tree sapling with stake close up' },
  { id: 'wrong-neem-as-coconut', kind: 'wrong', species: 'Coconut', reuse: 'plant-neem' },
  { id: 'wrong-mango-as-bamboo', kind: 'wrong', species: 'Bamboo', reuse: 'plant-mango' },
  { id: 'obj-cat', kind: 'fake', species: 'Neem', search: 'domestic cat portrait' },
  { id: 'obj-car', kind: 'fake', species: 'Neem', search: 'red car parked street' },
  { id: 'obj-building', kind: 'fake', species: 'Mango', search: 'office building facade' },
  { id: 'obj-cup', kind: 'fake', species: 'Neem', search: 'coffee cup on table' },
  { id: 'obj-bicycle', kind: 'fake', species: 'Banyan', search: 'bicycle leaning wall' },
  { id: 'screen-monitor', kind: 'fake', species: 'Neem', search: 'computer monitor on desk' },
  { id: 'screen-laptop', kind: 'fake', species: 'Mango', search: 'laptop open on desk' },
  { id: 'screen-tv', kind: 'fake', species: 'Neem', search: 'television set living room' },
  { id: 'gfx-logo', kind: 'fake', species: 'Neem', file: join(ASSETS, 'logo.png') },
  { id: 'gfx-splash', kind: 'fake', species: 'Neem', file: join(ASSETS, 'splash.png') },
  { id: 'gfx-icon', kind: 'fake', species: 'Mango', file: join(ASSETS, 'icon.png') },
  { id: 'gfx-flat', kind: 'fake', species: 'Neem', file: join(ASSETS, 'logo_flat.png') },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const redact = (s) => String(s).split(KEY).join('[key]');

async function commonsImage(search) {
  const q = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrnamespace: '6',
    gsrlimit: '8',
    gsrsearch: `${search} filemime:image/jpeg`,
    prop: 'imageinfo',
    iiprop: 'url|size',
    iiurlwidth: '800',
  });
  const r = await fetch(`https://commons.wikimedia.org/w/api.php?${q}`, {
    headers: { 'user-agent': UA },
  });
  const j = await r.json();
  const pages = Object.values(j?.query?.pages ?? {}).sort((a, b) => a.index - b.index);
  for (const p of pages) {
    const info = p.imageinfo?.[0];
    if (info?.thumburl && info.width >= 400) return info.thumburl;
  }
  return null;
}

async function loadFixture(f) {
  if (f.file) return readFileSync(f.file);
  const path = join(CACHE, `${f.reuse ?? f.id}.jpg`);
  if (existsSync(path)) return readFileSync(path);

  const src = FIXTURES.find((x) => x.id === f.reuse) ?? f;
  const url = await commonsImage(src.search);
  if (!url) return null;
  await sleep(600);
  const r = await fetch(url, { headers: { 'user-agent': UA } });
  if (!r.ok) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(path, buf);
  return buf;
}

function mimeOf(buf) {
  return buf[0] === 0x89 ? 'image/png' : 'image/jpeg';
}

/** Models like to wrap JSON in a markdown fence even when asked not to. */
function unfence(text) {
  const m = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  return (m ? m[1] : text).trim();
}

async function ask(model, buf, species, timeoutMs = 45000) {
  // Spacing between calls; see PROVIDERS.openrouter.paceMs.
  if (P.paceMs) await sleep(P.paceMs);

  for (let attempt = 1; attempt <= 2; attempt++) {
    const out = await askOnce(model, buf, species, timeoutMs);
    // One patient retry on a rate limit. Anything else is a real answer.
    if (out.status === 429 && attempt === 1) {
      await sleep(15000);
      continue;
    }
    return out;
  }
}

async function askOnce(model, buf, species, timeoutMs) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${KEY}`,
        'x-title': 'Dhara vision bench',
      },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 1200,
        // Reasoning models spend the whole token budget thinking and return an
        // empty answer (seen on nemotron-3.5-super-vl: 2000 reasoning tokens,
        // 0 content, 20 s). A yes/no photo check gains nothing from it.
        ...(PROVIDER === 'openrouter' ? { reasoning: { enabled: false } } : {}),
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  buildPrompt(species, false) +
                  '\n\nReply with ONLY a JSON object with keys: isPlant, isRealPhoto, ' +
                  'isFreshlyPlanted, species, speciesMatches, confidence, concerns.',
              },
              {
                type: 'image_url',
                image_url: { url: `data:${mimeOf(buf)};base64,${buf.toString('base64')}` },
              },
            ],
          },
        ],
      }),
    });
    const ms = Date.now() - t0;
    const body = await r.text();
    if (!r.ok) return { ok: false, ms, status: r.status, err: redact(body).slice(0, 140) };

    const text = JSON.parse(body)?.choices?.[0]?.message?.content ?? '';
    const verdict = parseVerdict(unfence(text));
    return { ok: true, ms, verdict, validJson: verdict !== null };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, status: 0, err: redact(e.message) };
  }
}

const median = (xs) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(0)}%` : 'n/a');

async function main() {
  console.log(`Vision benchmark -> ${BASE}\n`);

  console.log('Fixtures');
  const loaded = [];
  for (const f of FIXTURES) {
    const buf = await loadFixture(f).catch(() => null);
    if (!buf) {
      console.log(`  - ${f.id.padEnd(24)} (could not fetch, skipped)`);
      continue;
    }
    loaded.push({ ...f, buf });
    console.log(`  + ${f.id.padEnd(24)} ${f.kind.padEnd(6)} ${(buf.length / 1024).toFixed(0)} KB`);
  }
  const fakes = loaded.filter((f) => f.kind === 'fake').length;
  const plants = loaded.filter((f) => f.kind === 'plant').length;
  console.log(`\n${loaded.length} images: ${plants} genuine, ${fakes} fake, ${loaded.length - plants - fakes} wrong-species\n`);
  if (fakes < 5 || plants < 3) {
    console.error('Not enough fixtures to give a meaningful result. Aborting.');
    process.exit(2);
  }
  // Lets the fixtures be eyeballed before any quota is spent on them.
  if (process.env.BENCH_FETCH_ONLY) process.exit(0);

  // Re-test specific fixtures (comma-separated ids) without paying for the rest.
  if (process.env.BENCH_ONLY) {
    const only = new Set(process.env.BENCH_ONLY.split(',').map((s) => s.trim()));
    loaded.splice(0, loaded.length, ...loaded.filter((f) => only.has(f.id)));
    console.log(`Re-testing only: ${loaded.map((f) => f.id).join(', ')}\n`);
  }

  const cfg = { 'vision.ai_confidence_min': 0.6, 'vision.ai_hard_reject': true };
  const summary = [];

  // OpenRouter caps free-model requests per day (far lower on an account that
  // has never bought credits). Running out halfway would report half a
  // benchmark as a model failure, so check up front and say so.
  if (PROVIDER === 'openrouter') {
    try {
      const r = await fetch(`${BASE}/key`, { headers: { authorization: `Bearer ${KEY}` } });
      const q = (await r.json())?.data;
      const left = q?.free_model_daily_requests;
      if (left) {
        const need = models.length * loaded.length;
        console.log(
          `Free-model quota today: ${left.remaining}/${left.limit} left; this run needs about ${need}` +
            `${q.is_free_tier ? ' (account has never bought credits)' : ''}\n`,
        );
        if (left.remaining < need) {
          console.error(
            'Not enough free requests left for a full run. Pass fewer models on the ' +
              'command line, wait for the UTC day to roll over, or add credits.',
          );
          process.exit(3);
        }
      }
    } catch {
      console.log('(could not read the quota; continuing)\n');
    }
  }

  for (const model of models) {
    const ping = await ask(model, loaded[0].buf, loaded[0].species, 30000);
    if (!ping.ok) {
      console.log(`== ${model}\n   UNAVAILABLE  HTTP ${ping.status}  ${ping.err}\n`);
      summary.push({ model, available: false, why: `HTTP ${ping.status} ${ping.err}` });
      continue;
    }

    console.log(`== ${model}`);
    const rows = [];
    for (const f of loaded) {
      const res = f === loaded[0] ? ping : await ask(model, f.buf, f.species);
      let action = 'error';
      if (res.ok && res.verdict) action = decide(res.verdict, cfg).action;
      rows.push({ f, res, action });
      const v = res.verdict;
      console.log(
        `   ${f.id.padEnd(24)} ${f.kind.padEnd(6)} -> ${action.padEnd(7)} ` +
          `${String(res.ms).padStart(5)}ms  ` +
          (v ? `plant=${v.isPlant} real=${v.isRealPhoto} conf=${v.confidence}` : redact(res.err ?? 'invalid json')),
      );
    }

    const okRows = rows.filter((r) => r.res.ok);
    const caught = rows.filter((r) => r.f.kind === 'fake' && r.action === 'reject').length;
    const plantsOk = rows.filter((r) => r.f.kind === 'plant' && r.action === 'approve').length;
    const plantsRejected = rows.filter((r) => r.f.kind === 'plant' && r.action === 'reject').length;
    const wrongHeld = rows.filter((r) => r.f.kind === 'wrong' && r.action === 'review').length;
    const wrongTotal = rows.filter((r) => r.f.kind === 'wrong').length;
    const valid = rows.filter((r) => r.res.ok && r.res.validJson).length;
    const med = median(okRows.map((r) => r.res.ms));

    const s = {
      model,
      available: true,
      fakeCatch: caught / fakes,
      validJson: valid / rows.length,
      medianMs: med,
      genuineApproved: `${plantsOk}/${plants}`,
      genuineWronglyRejected: plantsRejected,
      wrongSpeciesHeld: `${wrongHeld}/${wrongTotal}`,
    };
    s.pass = s.fakeCatch >= 0.9 && s.validJson >= 0.95 && med < 8000 && plantsRejected === 0;
    summary.push(s);
    console.log('');
  }

  console.log('Summary (gate: fakes >= 90%, valid JSON >= 95%, median < 8 s, no genuine plant rejected)\n');
  console.log('model'.padEnd(30) + 'fakes'.padEnd(8) + 'json'.padEnd(7) + 'median'.padEnd(10) + 'genuine ok'.padEnd(12) + 'wrong held'.padEnd(12) + 'result');
  for (const s of summary) {
    if (!s.available) {
      console.log(s.model.padEnd(30) + `UNAVAILABLE (${s.why})`);
      continue;
    }
    console.log(
      s.model.padEnd(30) +
        pct(s.fakeCatch * fakes, fakes).padEnd(8) +
        pct(s.validJson * 100, 100).padEnd(7) +
        `${(s.medianMs / 1000).toFixed(1)}s`.padEnd(10) +
        s.genuineApproved.padEnd(12) +
        s.wrongSpeciesHeld.padEnd(12) +
        (s.pass ? 'PASS' : 'FAIL'),
    );
  }
  writeFileSync(join(CACHE, 'last_result.json'), JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error('FATAL', redact(e.stack ?? e.message));
  process.exit(1);
});

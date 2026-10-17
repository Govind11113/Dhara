import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPrompt,
  decide,
  inspectPhoto,
  onUnavailable,
  parseVerdict,
  summarise,
  unfence,
} from './vision.js';
import { validate } from '../routes/feedback.js';

const genuine = {
  isPlant: true,
  isRealPhoto: true,
  isFreshlyPlanted: true,
  species: 'Neem',
  speciesMatches: true,
  confidence: 0.92,
  concerns: [],
};

// ---------------------------------------------------------------------------
// Pure judgement
// ---------------------------------------------------------------------------

test('a genuine photo is approved with no reasons', () => {
  const out = decide(parseVerdict(JSON.stringify(genuine)), {});
  assert.equal(out.action, 'approve');
  assert.deepEqual(out.reasons, []);
});

test('a confident screen photo is rejected outright', () => {
  const out = decide(parseVerdict({ ...genuine, isRealPhoto: false, confidence: 0.9 }), {});
  assert.equal(out.action, 'reject');
  assert.deepEqual(out.reasons, ['ai_screen_photo']);
});

// Uncertainty must not cost an honest user their tree: it withholds credits
// pending review rather than refusing the submission.
test('low confidence holds for review instead of rejecting', () => {
  const out = decide(parseVerdict({ ...genuine, confidence: 0.3 }), {});
  assert.equal(out.action, 'review');
  assert.ok(out.reasons.includes('ai_low_confidence'));
});

// Picking the wrong species from the list is a mistake anyone makes, and the
// tree is still real. This must never be a rejection.
test('a species mismatch is only ever a review reason', () => {
  const out = decide(parseVerdict({ ...genuine, speciesMatches: false }), {});
  assert.equal(out.action, 'review');
  assert.deepEqual(out.reasons, ['ai_species_mismatch']);
});

test('hard reject can be turned off from config', () => {
  const out = decide(parseVerdict({ ...genuine, isRealPhoto: false }), {
    'vision.ai_hard_reject': false,
  });
  assert.equal(out.action, 'review');
});

test('a confident non-plant is rejected', () => {
  const out = decide(parseVerdict({ ...genuine, isPlant: false, confidence: 1 }), {});
  assert.equal(out.action, 'reject');
  assert.deepEqual(out.reasons, ['ai_not_a_plant']);
});

test('missing fields degrade to unknown rather than throwing', () => {
  const v = parseVerdict({ confidence: 'nonsense' });
  assert.equal(v.isPlant, null);
  assert.equal(v.confidence, 0);
  assert.deepEqual(v.concerns, []);
});

test('confidence is clamped into 0..1', () => {
  assert.equal(parseVerdict({ confidence: 7 }).confidence, 1);
  assert.equal(parseVerdict({ confidence: -3 }).confidence, 0);
});

test('summary is bounded and carries the key signals', () => {
  const s = summarise(parseVerdict(JSON.stringify(genuine)));
  assert.ok(s.includes('conf=0.92'));
  assert.ok(s.length <= 1024);
});

test('markdown-fenced JSON is accepted', () => {
  const fenced = '```json\n' + JSON.stringify(genuine) + '\n```';
  assert.equal(unfence(fenced), JSON.stringify(genuine));
  assert.equal(parseVerdict(fenced).isPlant, true);
});

test('garbage and non-objects yield no verdict', () => {
  assert.equal(parseVerdict('not json at all'), null);
  assert.equal(parseVerdict('[1,2,3]'), null);
  assert.equal(parseVerdict(null), null);
});

test('the prompt names the declared species and asks for bare JSON', () => {
  const p = buildPrompt('Neem', false);
  assert.ok(p.includes('Neem'));
  assert.ok(p.includes('ONLY a JSON object'));
});

// ---------------------------------------------------------------------------
// When the model cannot answer
// ---------------------------------------------------------------------------

test('unavailable defaults to approve with no reason', () => {
  const out = onUnavailable({});
  assert.equal(out.action, 'approve');
  assert.deepEqual(out.reasons, []);
});

test('unavailable can hold for review instead', () => {
  const out = onUnavailable({ 'vision.on_unavailable': 'review' });
  assert.equal(out.action, 'review');
  assert.deepEqual(out.reasons, ['ai_unavailable']);
});

test('an unrecognised on_unavailable value fails open, not closed', () => {
  assert.equal(onUnavailable({ 'vision.on_unavailable': 'banana' }).action, 'approve');
});

// ---------------------------------------------------------------------------
// inspectPhoto against a mocked fetch
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch;
let calls;

const storage = { getFileDownload: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).buffer };
const cfg = { 'vision.retry_delay_ms': 1, 'vision.timeout_ms': 500 };

const reply = (content, status = 200) =>
  new Response(
    status === 200 ? JSON.stringify({ choices: [{ message: { content } }] }) : String(content),
    { status },
  );

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'test-key-not-real';
  calls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.OPENROUTER_API_KEY;
});

const run = (config = cfg, log = () => {}) =>
  inspectPhoto({
    storage,
    bucketId: 'tree_photos',
    fileId: 'f1',
    declaredSpecies: 'Neem',
    config,
    log,
  });

test('a good answer returns a verdict labelled with the provider and model', async () => {
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return reply(JSON.stringify(genuine));
  };

  const { verdict, meta } = await run();

  assert.equal(meta.status, 'ok');
  assert.equal(meta.provider, 'openrouter');
  assert.equal(meta.model, 'nvidia/nemotron-3.5-super-vl:free');
  assert.equal(meta.attempts, 1);
  assert.equal(verdict.isPlant, true);
});

test('the request switches reasoning off and carries the photo as a data URI', async () => {
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return reply(JSON.stringify(genuine));
  };

  await run();
  const body = JSON.parse(calls[0].init.body);

  // Without this the model burns its whole budget thinking and returns nothing.
  assert.deepEqual(body.reasoning, { enabled: false });
  assert.equal(body.model, 'nvidia/nemotron-3.5-super-vl:free');
  const image = body.messages[0].content.find((c) => c.type === 'image_url');
  assert.ok(image.image_url.url.startsWith('data:image/jpeg;base64,'));
  assert.ok(calls[0].url.startsWith('https://openrouter.ai/'));
});

test('the configured model is the one that is called', async () => {
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return reply(JSON.stringify(genuine));
  };

  const { meta } = await run({ ...cfg, 'vision.model': 'google/gemma-4-31b-it:free' });
  assert.equal(JSON.parse(calls[0].init.body).model, 'google/gemma-4-31b-it:free');
  assert.equal(meta.model, 'google/gemma-4-31b-it:free');
});

test('a 503 is retried once and the second answer is used', async () => {
  let n = 0;
  globalThis.fetch = async () => {
    n++;
    return n === 1 ? reply('overloaded', 503) : reply(JSON.stringify(genuine));
  };

  const { verdict, meta } = await run();
  assert.equal(meta.status, 'ok');
  assert.equal(meta.attempts, 2);
  assert.equal(verdict.isPlant, true);
});

test('a persistent failure reports unavailable after two attempts', async () => {
  globalThis.fetch = async () => {
    calls.push(1);
    return reply('bad gateway', 502);
  };

  const { verdict, meta } = await run();
  assert.equal(verdict, null);
  assert.equal(meta.status, 'unavailable');
  assert.equal(meta.attempts, 2);
  assert.equal(calls.length, 2);
});

// A daily cap does not clear in a second, so retrying only burns time on a
// submission the user is waiting on.
test('the daily free-model cap is not retried', async () => {
  globalThis.fetch = async () => {
    calls.push(1);
    return reply('{"error":{"message":"Rate limit exceeded: free-models-per-day"}}', 429);
  };

  const { meta } = await run();
  assert.equal(meta.status, 'unavailable');
  assert.equal(meta.attempts, 1);
  assert.equal(calls.length, 1);
  assert.match(meta.error, /daily/);
});

test('an ordinary 429 is retried', async () => {
  let n = 0;
  globalThis.fetch = async () => {
    n++;
    return n === 1 ? reply('slow down', 429) : reply(JSON.stringify(genuine));
  };
  const { meta } = await run();
  assert.equal(meta.status, 'ok');
  assert.equal(meta.attempts, 2);
});

test('a 4xx that is our fault is not retried', async () => {
  globalThis.fetch = async () => {
    calls.push(1);
    return reply('bad request', 400);
  };
  const { meta } = await run();
  assert.equal(meta.status, 'unavailable');
  assert.equal(calls.length, 1);
});

test('malformed model output is unavailable, not a rejection', async () => {
  globalThis.fetch = async () => reply('I think it is a tree!');
  const { verdict, meta } = await run();
  assert.equal(verdict, null);
  assert.equal(meta.status, 'unavailable');
  assert.equal(meta.error, 'unparseable model output');
});

// The reasoning-burn failure: a 200 whose content is empty.
test('an empty answer is unavailable', async () => {
  globalThis.fetch = async () => reply('');
  const { meta } = await run();
  assert.equal(meta.status, 'unavailable');
  assert.equal(meta.error, 'empty model output');
});

test('a hung request times out per attempt and then gives up', async () => {
  globalThis.fetch = (url, init) =>
    new Promise((_, reject) => {
      calls.push(1);
      init.signal.addEventListener('abort', () => {
        const e = new Error('aborted');
        e.name = 'AbortError';
        reject(e);
      });
    });

  const started = Date.now();
  const { meta } = await run({ ...cfg, 'vision.timeout_ms': 60 });

  assert.equal(meta.status, 'unavailable');
  assert.equal(meta.error, 'timed out');
  // Two attempts each given the full timeout, rather than one shared budget.
  assert.equal(calls.length, 2);
  assert.ok(Date.now() - started >= 110);
});

test('a missing key is unavailable and never calls out', async () => {
  delete process.env.OPENROUTER_API_KEY;
  globalThis.fetch = async () => {
    calls.push(1);
    return reply(JSON.stringify(genuine));
  };
  const { meta } = await run();
  assert.equal(meta.status, 'unavailable');
  assert.equal(calls.length, 0);
});

test('turning the check off skips it without a reason or a call', async () => {
  globalThis.fetch = async () => {
    calls.push(1);
    return reply(JSON.stringify(genuine));
  };
  const { meta } = await run({ ...cfg, 'vision.ai_enabled': false });
  assert.equal(meta.status, 'skipped');
  assert.equal(calls.length, 0);
});

test('an unreadable photo is unavailable', async () => {
  const broken = {
    getFileDownload: async () => {
      throw new Error('file not found');
    },
  };
  globalThis.fetch = async () => reply(JSON.stringify(genuine));
  const { meta } = await inspectPhoto({
    storage: broken,
    bucketId: 'tree_photos',
    fileId: 'nope',
    config: cfg,
  });
  assert.equal(meta.status, 'unavailable');
  assert.match(meta.error, /could not read photo/);
});

test('the API key never appears in logs', async () => {
  const lines = [];
  globalThis.fetch = async () => reply('nope', 502);
  await run(cfg, (m) => lines.push(m));
  assert.ok(lines.length > 0);
  assert.ok(lines.every((l) => !l.includes('test-key-not-real')));
});

// ---------------------------------------------------------------------------
// Feedback validation lives here too: it is pure and shares no fixtures.
// ---------------------------------------------------------------------------

test('feedback validation rejects a short message and a bad category', () => {
  assert.equal(validate({ category: 'bug', message: 'x'.repeat(10) }), null);
  assert.equal(validate({ category: 'nope', message: 'x'.repeat(10) }).code, 'invalid_category');
  assert.equal(validate({ category: 'bug', message: 'short' }).code, 'message_too_short');
});

/**
 * Server-side photo verification.
 *
 * Why this exists: the client already runs ML Kit and sends `plantConfidence`,
 * but that number is produced by the app and can be anything a patched APK
 * wants it to be. It is a UX hint, not evidence. This module asks a vision
 * model on the server what is actually in the photo, and that answer is the one
 * credits are decided on.
 *
 * One provider: OpenRouter, model `vision.model` (default
 * nvidia/nemotron-3.5-super-vl:free). It is OpenAI-compatible, so swapping
 * models is a config change, not a code change.
 *
 * When the model cannot answer (no key, outage, daily free-tier cap, timeout)
 * [inspectPhoto] reports `status: 'unavailable'` and the caller applies
 * `vision.on_unavailable`: `approve` falls back to the GPS + pHash + ML Kit
 * checks that existed before, `review` holds the submission for a person.
 *
 * The pure functions ([parseVerdict], [decide], [onUnavailable]) carry all the
 * judgement and are unit tested without a network.
 */

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
export const PROVIDER = 'openrouter';
export const DEFAULT_MODEL = 'nvidia/nemotron-3.5-super-vl:free';

export function buildPrompt(declaredSpecies, isVerify = false) {
  return [
    'You are verifying a photo submitted to a tree-planting rewards programme.',
    'Real credits are paid out on your answer, so be strict but fair.',
    '',
    `The user says this is a ${declaredSpecies || 'tree'}.`,
    isVerify
      ? 'This is a monthly check-in on a tree they planted earlier, so an established plant is expected.'
      : 'This is a newly planted sapling, so freshly disturbed soil is expected.',
    '',
    'Answer these:',
    '- isPlant: is there a real, living plant or tree in frame?',
    '- isRealPhoto: is this a photograph of a real scene, rather than a photo',
    '  of a screen, a printed picture, or a digitally generated image?',
    '- isFreshlyPlanted: does the ground show signs of recent planting?',
    '- species: what species does the plant appear to be?',
    '- speciesMatches: is that consistent with what the user said?',
    // Confidence is in the assessment, not in the photo being genuine. Asking
    // for genuineness instead inverts the scale: a blatant fake comes back as
    // 0, which reads as "no idea" and would hold it for review rather than
    // rejecting it. The booleans above carry the verdict; this says how much
    // to trust them.
    '- confidence: 0 to 1, how certain you are of the answers above.',
    '  Use a high value when the photo is clear and your reading is obvious,',
    '  whether that reading is good or bad for the user. Use a low value only',
    '  when the photo is genuinely ambiguous — blurry, dark, or badly framed.',
    '- concerns: short notes on anything that looks wrong. Empty if nothing.',
    '',
    'A plant that is simply different from the declared species is an honest',
    'mistake, not fraud. A photo of a screen is fraud.',
    '',
    'Reply with ONLY a JSON object with exactly these keys: isPlant,',
    'isRealPhoto, isFreshlyPlanted, species, speciesMatches, confidence,',
    'concerns. No markdown, no commentary.',
  ].join('\n');
}

/** Models like to wrap JSON in a markdown fence even when told not to. */
export function unfence(text) {
  const s = String(text ?? '');
  const m = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  return (m ? m[1] : s).trim();
}

/**
 * Turns whatever came back into a usable verdict.
 *
 * Tolerant on purpose: a missing or malformed field degrades to "unknown"
 * rather than throwing. A parse failure here would otherwise reject a
 * legitimate submission for a reason that has nothing to do with the photo.
 */
export function parseVerdict(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(unfence(raw));
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

  const bool = (v) => (typeof v === 'boolean' ? v : null);
  const n = Number(data.confidence);

  return {
    isPlant: bool(data.isPlant),
    isRealPhoto: bool(data.isRealPhoto),
    isFreshlyPlanted: bool(data.isFreshlyPlanted),
    species: typeof data.species === 'string' ? data.species.slice(0, 64) : '',
    speciesMatches: bool(data.speciesMatches),
    confidence: Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0,
    concerns: Array.isArray(data.concerns)
      ? data.concerns.filter((c) => typeof c === 'string').slice(0, 6)
      : [],
  };
}

/**
 * Maps a verdict onto what to do about it.
 *
 * `reject` is reserved for the cases the model is confident are not genuine
 * photographs. Everything else that looks off becomes `review`: the submission
 * still counts, credits are simply withheld until a person looks. Treating
 * uncertainty as rejection is how honest users get punished for a bad angle.
 *
 * @returns {{action: 'approve'|'review'|'reject', reasons: string[], confidence: number}}
 */
export function decide(verdict, config = {}) {
  if (!verdict) return { action: 'approve', reasons: [], confidence: 0 };

  const min = numOr(config['vision.ai_confidence_min'], 0.6);
  const hardReject = config['vision.ai_hard_reject'] !== false;
  const reasons = [];

  // A photo of a screen is the cheat this check exists to catch. Confidence is
  // read as confidence in the judgement.
  if (verdict.isRealPhoto === false && verdict.confidence >= min && hardReject) {
    return {
      action: 'reject',
      reasons: ['ai_screen_photo'],
      confidence: verdict.confidence,
    };
  }

  if (verdict.isPlant === false) {
    if (verdict.confidence >= min && hardReject) {
      return {
        action: 'reject',
        reasons: ['ai_not_a_plant'],
        confidence: verdict.confidence,
      };
    }
    reasons.push('ai_not_a_plant');
  }

  // Never a rejection: picking the wrong species from the list is a mistake
  // anyone makes, and the tree is still real.
  if (verdict.speciesMatches === false) reasons.push('ai_species_mismatch');

  if (verdict.isRealPhoto === false) reasons.push('ai_screen_photo');

  if (verdict.confidence < min) reasons.push('ai_low_confidence');

  return {
    action: reasons.length ? 'review' : 'approve',
    reasons: [...new Set(reasons)],
    confidence: verdict.confidence,
  };
}

/**
 * What to do when the model could not give an opinion.
 *
 * `approve` (the default) keeps honest users moving: the submission rides on
 * the GPS, pHash and ML Kit checks. The cost is that a cheater who lands in an
 * outage window is not checked. `review` closes that gap by holding everything,
 * at the price of every outage filling the admin queue. It is a config switch
 * because the right answer depends on how reliable the provider turns out to
 * be.
 */
export function onUnavailable(config = {}) {
  const hold = String(config['vision.on_unavailable'] ?? 'approve') === 'review';
  return {
    action: hold ? 'review' : 'approve',
    reasons: hold ? ['ai_unavailable'] : [],
    confidence: 0,
  };
}

/** Compact note stored on the row so a reviewer can see what the model said. */
export function summarise(verdict) {
  if (!verdict) return '';
  const parts = [
    `conf=${verdict.confidence.toFixed(2)}`,
    `plant=${verdict.isPlant ?? '?'}`,
    `real=${verdict.isRealPhoto ?? '?'}`,
  ];
  if (verdict.species) parts.push(`species=${verdict.species}`);
  if (verdict.speciesMatches !== null) parts.push(`match=${verdict.speciesMatches}`);
  if (verdict.concerns.length) parts.push(`concerns=${verdict.concerns.join('; ')}`);
  return parts.join(' ').slice(0, 1024);
}

function numOr(value, fallback) {
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mimeOf(bytes) {
  // PNG magic number; everything the app uploads is re-encoded as JPEG.
  return bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png' : 'image/jpeg';
}

/** A 429 that is the daily free-tier cap will not clear in a second. */
function isDailyCap(status, bodyText) {
  return status === 429 && /per-day|daily|free-models-per-day/i.test(bodyText);
}

/**
 * Downloads the uploaded photo and asks the model about it.
 *
 * Never throws. Result shape:
 *   { verdict, meta: { status, provider, model, latencyMs, attempts, error } }
 * where status is 'ok', 'skipped' (turned off in config) or 'unavailable'.
 */
export async function inspectPhoto({
  storage,
  bucketId,
  fileId,
  declaredSpecies = '',
  isVerify = false,
  config = {},
  log = () => {},
}) {
  const model = String(config['vision.model'] || DEFAULT_MODEL);
  const meta = {
    status: 'unavailable',
    provider: PROVIDER,
    model,
    latencyMs: 0,
    attempts: 0,
    error: '',
  };

  if (config['vision.ai_enabled'] === false) {
    meta.status = 'skipped';
    return { verdict: null, meta };
  }

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    meta.error = 'OPENROUTER_API_KEY not set';
    log(`vision: ${meta.error}`);
    return { verdict: null, meta };
  }

  const timeoutMs = numOr(config['vision.timeout_ms'], 12000);
  const retryDelayMs = numOr(config['vision.retry_delay_ms'], 1200);
  const started = Date.now();

  let payload;
  try {
    const raw = new Uint8Array(await storage.getFileDownload(bucketId, fileId));
    const b64 = Buffer.from(raw).toString('base64');
    payload = JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 1200,
      // Reasoning models spend the whole token budget thinking and return an
      // empty answer (nemotron-3.5-super-vl: 2000 reasoning tokens, no
      // content, 20 s). A photo check gains nothing from it.
      reasoning: { enabled: false },
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: buildPrompt(declaredSpecies, isVerify) },
            {
              type: 'image_url',
              image_url: { url: `data:${mimeOf(raw)};base64,${b64}` },
            },
          ],
        },
      ],
    });
  } catch (e) {
    meta.error = `could not read photo: ${e.message}`;
    log(`vision: ${meta.error}`);
    return { verdict: null, meta };
  }

  // One retry for a transient failure. The timeout is per attempt so a slow
  // first try cannot starve the second.
  for (let attempt = 1; attempt <= 2; attempt++) {
    meta.attempts = attempt;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${key}`,
          'x-title': 'Dhara',
        },
        signal: controller.signal,
        body: payload,
      });

      const text = await res.text();

      if (!res.ok) {
        meta.error = `HTTP ${res.status}`;
        log(`vision: ${model} returned ${res.status}`);
        const transient =
          [429, 500, 502, 503, 504].includes(res.status) && !isDailyCap(res.status, text);
        if (transient && attempt === 1) {
          await sleep(retryDelayMs);
          continue;
        }
        if (isDailyCap(res.status, text)) meta.error = 'daily free-model cap reached';
        break;
      }

      let content = '';
      try {
        content = JSON.parse(text)?.choices?.[0]?.message?.content ?? '';
      } catch {
        // Falls through to the empty-content handling below.
      }

      const verdict = parseVerdict(content);
      if (verdict) {
        meta.status = 'ok';
        meta.error = '';
        meta.latencyMs = Date.now() - started;
        return { verdict, meta };
      }

      meta.error = content ? 'unparseable model output' : 'empty model output';
      log(`vision: ${model} ${meta.error}`);
      if (attempt === 1) {
        await sleep(retryDelayMs);
        continue;
      }
      break;
    } catch (e) {
      meta.error = e.name === 'AbortError' ? 'timed out' : e.message;
      log(`vision: ${model} ${meta.error}`);
      if (attempt === 1) {
        await sleep(retryDelayMs);
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  meta.latencyMs = Date.now() - started;
  return { verdict: null, meta };
}

import { Rejected } from './context.js';

/**
 * The app_config keys the admin panel may change, and what values each accepts.
 *
 * A whitelist rather than "any key": config drives credit amounts, fraud
 * thresholds and which model judges photos, so a typo'd or invented key, or an
 * out-of-range number, should be refused here instead of quietly changing how
 * money is paid out. New keys are added by the seed script, not from the UI.
 */
export const CONFIG_SPEC = {
  'vision.ai_enabled': { type: 'bool', label: 'AI photo check on' },
  'vision.ai_hard_reject': { type: 'bool', label: 'AI may reject outright' },
  'vision.ai_confidence_min': { type: 'float', min: 0, max: 1, label: 'AI confidence needed' },
  'vision.model': { type: 'string', pattern: /^[A-Za-z0-9._:\/-]{3,96}$/, label: 'Vision model (OpenRouter id)' },
  'vision.on_unavailable': { type: 'enum', options: ['approve', 'review'], label: 'If the AI is down' },
  'vision.timeout_ms': { type: 'int', min: 1000, max: 60000, label: 'AI timeout (ms)' },

  'tree.verify_radius_m': { type: 'int', min: 5, max: 500, label: 'Check-in radius (m)' },
  'tree.min_spacing_m': { type: 'int', min: 0, max: 50, label: 'Minimum tree spacing (m)' },
  'tree.max_gps_accuracy_m': { type: 'int', min: 5, max: 100, label: 'Worst GPS accuracy allowed (m)' },
  'tree.plant_credits': { type: 'int', min: 0, max: 100, label: 'Credits for planting' },
  'tree.credits_per_verification': { type: 'int', min: 0, max: 100, label: 'Default credits per check-in' },
  'tree.vesting_months': { type: 'int', min: 1, max: 36, label: 'Vesting months' },
  'tree.plant_confidence_min': { type: 'float', min: 0, max: 1, label: 'On-device plant confidence needed' },
  'tree.verify_window_days': { type: 'int', min: 1, max: 30, label: 'Check-in window (days)' },
  'tree.grace_misses': { type: 'int', min: 0, max: 12, label: 'Missed check-ins before a tree is lost' },

  'fraud.phash_hamming_threshold': { type: 'int', min: 0, max: 32, label: 'Duplicate-photo sensitivity' },
  'fraud.trust_score_block_below': { type: 'int', min: 0, max: 100, label: 'Hold for review below trust score' },

  'redeem.min_credits': { type: 'int', min: 1, max: 10000, label: 'Minimum redemption' },
  'redeem.daily_credit_cap': { type: 'int', min: 1, max: 100000, label: 'Daily redemption cap' },
  'redeem.require_electricity_verified': { type: 'bool', label: 'Bill credit needs a verified account' },
};

/** What the UI is allowed to see about a key, minus the pattern internals. */
export function publicSpec(key) {
  const s = CONFIG_SPEC[key];
  if (!s) return null;
  return { type: s.type, min: s.min, max: s.max, options: s.options, label: s.label };
}

/**
 * Checks a proposed value and returns it in the string form app_config stores.
 * Throws Rejected('bad_request') for an unknown key or an unacceptable value.
 */
export function validateConfigValue(key, raw) {
  const spec = CONFIG_SPEC[key];
  if (!spec) throw new Rejected('bad_request', `"${key}" cannot be changed from the panel.`);

  const fail = (why) => {
    throw new Rejected('bad_request', `${spec.label}: ${why}`);
  };

  switch (spec.type) {
    case 'bool': {
      if (raw === true || raw === 'true') return 'true';
      if (raw === false || raw === 'false') return 'false';
      return fail('must be on or off.');
    }
    case 'int': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isInteger(n)) return fail('must be a whole number.');
      if (n < spec.min || n > spec.max) return fail(`must be between ${spec.min} and ${spec.max}.`);
      return String(n);
    }
    case 'float': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isFinite(n)) return fail('must be a number.');
      if (n < spec.min || n > spec.max) return fail(`must be between ${spec.min} and ${spec.max}.`);
      return String(n);
    }
    case 'enum': {
      const v = String(raw ?? '').trim();
      if (!spec.options.includes(v)) return fail(`must be one of ${spec.options.join(', ')}.`);
      return v;
    }
    case 'string': {
      const v = String(raw ?? '').trim();
      if (!spec.pattern.test(v)) return fail('contains characters that are not allowed.');
      return v;
    }
    default:
      return fail('has an unsupported type.');
  }
}

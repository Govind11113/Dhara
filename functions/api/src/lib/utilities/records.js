import { createHash, createHmac } from 'node:crypto';

/**
 * Normalised utility records and the rules that keep them honest.
 *
 * Only `verified` would mean the consumption came from the utility itself; this
 * build has no channel that produces it. A document read on the phone is
 * `document_review`; numbers the user typed are `unverified`. Nothing here can
 * turn either of those into `verified`.
 */
export const STATUS = Object.freeze({
  pending: 'pending',
  fetching: 'fetching',
  verified: 'verified',
  documentReview: 'document_review',
  unverified: 'unverified',
  failed: 'failed',
  unsupportedProvider: 'unsupported_provider',
  providerUnavailable: 'provider_unavailable',
  consumptionUnavailable: 'consumption_unavailable',
  duplicate: 'duplicate',
});
export const STATUSES = Object.values(STATUS);

export const METHOD = Object.freeze({
  billFetch: 'bill_fetch',
  document: 'document',
  manual: 'manual',
});
export const METHODS = Object.values(METHOD);

/** Units each utility type may be recorded in. Nothing is converted. */
export const UNITS = Object.freeze({ electricity: ['kWh'], png: ['SCM'] });

/** Upper bounds that catch a misread digit, not real-world limits. */
export const MAX_CONSUMPTION = Object.freeze({ electricity: 50000, png: 5000 });

/** The consent text version the app must show and the server records. */
export const CONSENT_VERSION = '2026-11-01';
export const CONSENT_PURPOSE =
  'Store the utility bill details and consumption I provide to calculate my carbon footprint.';

/** Last four characters only, the same rule as the existing bill screen. */
export function maskAccount(value) {
  const v = String(value ?? '');
  if (v.length <= 4) return '*'.repeat(v.length);
  return `${'*'.repeat(Math.min(v.length - 4, 8))}${v.slice(-4)}`;
}

/**
 * A keyed hash of the account identifier, so the same connection can be
 * recognised (for duplicate detection) without storing the number itself.
 * Keyed, because consumer numbers are short and a plain hash could be reversed
 * by trying every number. The key lives only in the server's environment.
 */
export function accountHash(providerId, account, pepper = process.env.UTILITY_ID_PEPPER) {
  if (!pepper || pepper.length < 16) {
    throw new Error('UTILITY_ID_PEPPER is not configured');
  }
  return createHmac('sha256', pepper).update(`${providerId}:${account}`).digest('hex');
}

/** YYYY-MM-DD, or null. Rejects impossible dates instead of rolling them over. */
export function isoDate(value) {
  const s = String(value ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
    return null;
  }
  return s;
}

/**
 * A billing period the record can stand on: both ends real dates, in order,
 * no longer than about two months, and not in the future.
 */
export function validPeriod(start, end, now = new Date()) {
  const a = isoDate(start);
  const b = isoDate(end);
  if (!a || !b) return null;
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (tb < ta) return null;
  if ((tb - ta) / 86400000 > 66) return null;
  if (tb > now.getTime() + 86400000) return null;
  return { start: a, end: b };
}

/** The month a reading counts towards: the month its period ends in. */
export function monthOfPeriod(period) {
  return period.end.slice(0, 7);
}

export function validConsumption(utilityType, value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return false;
  if (n > (MAX_CONSUMPTION[utilityType] ?? 0)) return false;
  return (UNITS[utilityType] ?? []).includes(unit);
}

/**
 * One reading per user, connection and billing period. The bill reference is
 * stored but deliberately left out of the key: a re-issued or corrected bill
 * for the same period carries a new reference, and counting it again would
 * double the month's consumption.
 */
export function dedupeKey({ userId, providerId, accountHash: hash, period }) {
  return createHash('sha256')
    .update([userId, providerId, hash, period.start, period.end].join('|'))
    .digest('hex')
    .slice(0, 64);
}

/** A client request ID: replays of the same request return the first result. */
export function validRequestId(value) {
  const s = String(value ?? '');
  return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : null;
}

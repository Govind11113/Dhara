import { Query } from 'node-appwrite';
import { COL, DB, Rejected, distanceM, geohash } from './context.js';

/**
 * How close a new tree may be planted to an existing one.
 *
 * The limit is the app_config key `tree.min_spacing_cm`, a whole number of
 * centimetres. Exactly the limit is allowed; only closer is refused. The old
 * `tree.min_spacing_m` key is ignored. The app reads the same key and mirrors
 * this file in lib/core/utils/tree_spacing.dart.
 */
export const SPACING_CONFIG_KEY = 'tree.min_spacing_cm';
export const DEFAULT_MIN_TREE_SPACING_CM = 30;
/** 50 m. Anything above this is treated as a typo, not a policy. */
export const MAX_MIN_TREE_SPACING_CM = 5000;

/**
 * The configured limit in centimetres, or 30 when the setting is missing,
 * not a whole number, negative or implausibly large.
 */
export function minTreeSpacingCm(config) {
  const raw = config?.[SPACING_CONFIG_KEY];
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return DEFAULT_MIN_TREE_SPACING_CM;
  }
  if (!Number.isInteger(n) || n < 0 || n > MAX_MIN_TREE_SPACING_CM) {
    return DEFAULT_MIN_TREE_SPACING_CM;
  }
  return n;
}

// Haversine arithmetic is not exact: a spot 30 cm away can come out as
// 29.9999999 cm. A micrometre of tolerance keeps "exactly the limit" allowed.
const TOLERANCE_CM = 1e-4;

/** Whether a tree [distanceM] metres from another is too close to register. */
export function tooCloseToPlant(distanceMetres, minCm = DEFAULT_MIN_TREE_SPACING_CM) {
  if (!Number.isFinite(distanceMetres)) return false;
  return distanceMetres * 100 < minCm - TOLERANCE_CM;
}

/** "12 cm" below one metre, "4 m" (or "1.5 m" for a limit) from one metre up. */
export function formatDistance(distanceMetres) {
  const cm = Math.round(distanceMetres * 100);
  if (cm < 100) return `${Math.max(cm, 0)} cm`;
  return `${Math.round(distanceMetres)} m`;
}

export function formatSpacing(cm) {
  if (cm < 100) return `${cm} cm`;
  const m = cm / 100;
  return `${Number.isInteger(m) ? m : m.toFixed(2).replace(/0+$/, '')} m`;
}

/**
 * Refuses a planting at (lat, lng) that sits closer than the limit to any
 * registered tree. Geohash prefix keeps this a bounded query: precision 7 is
 * roughly a 150 m cell.
 */
export async function assertSpacing(databases, { lat, lng, userId, config }) {
  const minCm = minTreeSpacingCm(config);
  if (minCm === 0) return;
  const nearby = await databases.listDocuments(DB, COL.trees, [
    Query.startsWith('geohash', geohash(lat, lng, 7)),
    Query.limit(100),
  ]);
  for (const other of nearby.documents) {
    const d = distanceM(lat, lng, other.lat, other.lng);
    if (!tooCloseToPlant(d, minCm)) continue;
    const mine = other.ownerId === userId;
    throw new Rejected(
      'too_close',
      mine
        ? `You already registered "${other.nickname || other.speciesName}" about ${formatDistance(d)} away. ` +
            `Trees must be at least ${formatSpacing(minCm)} apart.`
        : `Another member already registered a tree about ${formatDistance(d)} from here. ` +
            `Trees must be at least ${formatSpacing(minCm)} apart.`,
      { distanceM: Math.round(d * 100) / 100, minSpacingCm: minCm },
    );
  }
}

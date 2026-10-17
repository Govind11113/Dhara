import { Client, Databases, Users, Account, Query, Storage } from 'node-appwrite';

export const DB = process.env.APPWRITE_DATABASE_ID || 'dhara';

export const COL = {
  profiles: 'profiles',
  trees: 'trees',
  treeVerifications: 'tree_verifications',
  species: 'species',
  items: 'items',
  custodyEvents: 'custody_events',
  transferTokens: 'transfer_tokens',
  creditLedger: 'credit_ledger',
  rewards: 'rewards',
  redemptions: 'redemptions',
  electricityAccounts: 'electricity_accounts',
  leaderboard: 'leaderboard',
  badges: 'badges',
  userBadges: 'user_badges',
  notifications: 'notifications',
  photoHashes: 'photo_hashes',
  fraudFlags: 'fraud_flags',
  appConfig: 'app_config',
  partnerRoles: 'partner_roles',
  feedback: 'feedback',
  aiInspections: 'ai_inspections',
  adminActions: 'admin_actions',
  footprints: 'footprints',
};

export const BUCKET = {
  treePhotos: 'tree_photos',
  billDocs: 'bill_docs',
  avatars: 'avatars',
  feedbackMedia: 'feedback_media',
};

/**
 * Business rule violation, surfaced to the client as a stable error code.
 * Anything that is not a Rejected is treated as an internal fault and logged
 * without leaking details.
 */
export class Rejected extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const endpoint = () =>
  process.env.APPWRITE_FUNCTION_API_ENDPOINT ||
  process.env.APPWRITE_ENDPOINT ||
  'https://sgp.cloud.appwrite.io/v1';

const projectId = () =>
  process.env.APPWRITE_FUNCTION_PROJECT_ID || process.env.APPWRITE_PROJECT_ID;

/** Full-privilege client. Never handed to the caller. */
export function adminClient(req) {
  // The explicit variable is preferred over Appwrite's injected dynamic key:
  // the dynamic key only carries the scopes configured on the function, and a
  // silent scope gap here would surface as confusing 401s deep in a route.
  const key = process.env.APPWRITE_API_KEY || req?.headers?.['x-appwrite-key'];
  if (!key) throw new Rejected('server_misconfigured', 'Server key missing.');
  return new Client().setEndpoint(endpoint()).setProject(projectId()).setKey(key);
}

/**
 * Resolves the caller from their JWT.
 *
 * The crux of the security model: the client never states who it is. A forged
 * or expired token fails here, so no downstream handler has to trust
 * caller-supplied identity.
 */
export async function requireUser(req) {
  // Appwrite injects x-appwrite-user-jwt for an authenticated caller, so that
  // is the primary source. x-dhara-jwt is the client's explicit fallback: a
  // caller cannot send anything starting with "x-appwrite" — Appwrite rejects
  // the whole execution with a 500 before this function runs.
  const jwt =
    req.headers['x-appwrite-user-jwt'] ||
    req.headers['x-dhara-jwt'] ||
    req.headers['X-Dhara-JWT'];

  if (!jwt) throw new Rejected('unauthenticated', 'Please sign in again.');

  const scoped = new Client()
    .setEndpoint(endpoint())
    .setProject(projectId())
    .setJWT(jwt);

  let user;
  try {
    user = await new Account(scoped).get();
  } catch {
    throw new Rejected('unauthenticated', 'Session expired. Sign in again.');
  }
  if (!user?.$id) {
    throw new Rejected('unauthenticated', 'Session expired. Sign in again.');
  }
  return user;
}

export function services(req) {
  const client = adminClient(req);
  return {
    client,
    databases: new Databases(client),
    users: new Users(client),
    // Needed to read an uploaded photo back for server-side verification. The
    // buckets are private, so this requires the admin client.
    storage: new Storage(client),
  };
}

/** node-appwrite 17 takes positional arguments, not an options object. */
export async function loadConfig(databases) {
  const out = {};
  let cursor = null;
  for (let page = 0; page < 5; page++) {
    const queries = [Query.limit(100)];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const res = await databases.listDocuments(DB, COL.appConfig, queries);
    for (const doc of res.documents) out[doc.key] = coerce(doc.value, doc.valueType);
    if (res.documents.length < 100) break;
    cursor = res.documents[res.documents.length - 1].$id;
  }
  return out;
}

function coerce(value, type) {
  switch (type) {
    case 'int':
      return parseInt(value, 10);
    case 'float':
      return parseFloat(value);
    case 'bool':
      return value === 'true' || value === '1';
    case 'json':
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    default:
      return value;
  }
}

export const nowIso = () => new Date().toISOString();

export function monthKey(date = new Date()) {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function num(value, fallback = 0) {
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

export function str(value, max = 0) {
  if (value === null || value === undefined) return '';
  const s = String(value).trim();
  return max > 0 ? s.slice(0, max) : s;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Great-circle metres. Used for the 30 m proof-of-presence check. */
export function distanceM(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function geohash(lat, lng, precision = 9) {
  let latMin = -90, latMax = 90, lngMin = -180, lngMax = 180;
  let hash = '', isLng = true, bit = 0, ch = 0;
  while (hash.length < precision) {
    if (isLng) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) { ch = (ch << 1) | 1; lngMin = mid; } else { ch <<= 1; lngMax = mid; }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) { ch = (ch << 1) | 1; latMin = mid; } else { ch <<= 1; latMax = mid; }
    }
    isLng = !isLng;
    if (++bit === 5) { hash += BASE32[ch]; bit = 0; ch = 0; }
  }
  return hash;
}

/** Hamming distance between two hex pHash strings. 64 means "unrelated". */
export function hamming(a, b) {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

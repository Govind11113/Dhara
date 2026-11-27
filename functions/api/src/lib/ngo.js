import { Rejected } from './context.js';
import { isAdmin } from './admin.js';

/**
 * NGO access.
 *
 * The partner NGO's staff carry the Appwrite user label `ngo`. Like `admin`, it
 * can only be set with a server key (scripts/make_ngo.mjs), so nobody can grant
 * it to themselves.
 *
 * The label opens `/ngo/` and nothing else. In particular it does not satisfy
 * `isAdmin`, so an NGO account cannot reach `/admin/`. Admins may use `/ngo/`
 * so they can see and help with what the NGO sees.
 *
 * As with admin, the gate is applied once in main.js to the whole prefix.
 */

export const NGO_LABEL = 'ngo';

export const isNgoPath = (path) => String(path).startsWith('/ngo/');

export function hasNgoLabel(user) {
  return Array.isArray(user?.labels) && user.labels.includes(NGO_LABEL);
}

/** Who may use /ngo/: NGO staff and administrators. */
export function canUseNgoArea(user) {
  return hasNgoLabel(user) || isAdmin(user);
}

export function requireNgo(user) {
  if (!canUseNgoArea(user)) {
    // Same message for every refusal, so it says nothing about who has access.
    throw new Rejected('forbidden', 'This area is for our partner NGO only.');
  }
  return user;
}

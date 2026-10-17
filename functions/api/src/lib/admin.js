import { ID } from 'node-appwrite';
import { COL, DB, Rejected, nowIso } from './context.js';

/**
 * Admin access.
 *
 * Admin status is the Appwrite user label `admin`. Labels can only be set by a
 * server-side key (scripts/make_admin.mjs); a signed-in user cannot add one to
 * themselves, which is what makes this safe to rely on.
 *
 * The gate is applied once, in main.js, to everything under `/admin/`, rather
 * than inside each handler. A handler that forgets to check is the failure mode
 * this layout removes.
 */

export const ADMIN_LABEL = 'admin';

export const isAdminPath = (path) => String(path).startsWith('/admin/');

export function isAdmin(user) {
  return Array.isArray(user?.labels) && user.labels.includes(ADMIN_LABEL);
}

export function requireAdmin(user) {
  if (!isAdmin(user)) {
    // Same message whether the account is a normal user or something odd, so
    // the response says nothing about which accounts are admins.
    throw new Rejected('forbidden', 'This area is for administrators only.');
  }
  return user;
}

/**
 * Records an admin write. Awaited by the caller, and it throws on failure:
 * unlike telemetry, an action with no audit row should not look like it
 * succeeded silently. Handlers call this after the change lands.
 */
export async function logAction(
  databases,
  admin,
  { action, targetType = '', targetId = '', detail = '' },
) {
  const cut = (v, n) => String(v ?? '').slice(0, n);
  return databases.createDocument(DB, COL.adminActions, ID.unique(), {
    adminId: cut(admin.$id, 64),
    adminEmail: cut(admin.email, 128),
    action: cut(action, 48),
    targetType: cut(targetType, 32),
    targetId: cut(targetId, 64),
    detail: cut(typeof detail === 'string' ? detail : JSON.stringify(detail), 1024),
    createdAt: nowIso(),
  });
}

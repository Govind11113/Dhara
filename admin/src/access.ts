/**
 * Who sees what in the dashboard.
 *
 * This only decides what to show. The server is the authority: every /admin/
 * and /ngo/ route checks the caller's label itself, so a doctored client that
 * ignores this file still cannot read or change anything it should not.
 */

export type Role = 'admin' | 'ngo';

export interface NavItem {
  to: string;
  label: string;
}

const PLANTING: NavItem = { to: '/planting', label: 'Planting requests' };

const ADMIN_NAV: readonly NavItem[] = [
  { to: '/queue', label: 'Review queue' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/report', label: 'Impact report' },
  { to: '/users', label: 'Members' },
  { to: '/trees', label: 'Trees' },
  PLANTING,
  { to: '/feedback', label: 'Feedback' },
  { to: '/flags', label: 'Fraud flags' },
  { to: '/redemptions', label: 'Redemptions' },
  { to: '/ai', label: 'AI & settings' },
  { to: '/audit', label: 'Audit log' },
];

const NGO_NAV: readonly NavItem[] = [PLANTING];

/**
 * The role an account's labels grant, or null for none.
 * An account with both labels is an admin, who can already see everything.
 */
export function roleFromLabels(labels: readonly string[] | undefined | null): Role | null {
  if (!Array.isArray(labels)) return null;
  if (labels.includes('admin')) return 'admin';
  if (labels.includes('ngo')) return 'ngo';
  return null;
}

export function navFor(role: Role): readonly NavItem[] {
  return role === 'admin' ? ADMIN_NAV : NGO_NAV;
}

/** Where a role lands after signing in, and where unknown paths send it. */
export function homeFor(role: Role): string {
  return role === 'admin' ? '/queue' : PLANTING.to;
}

/** Whether a role may open a path. Anything not in its menu is closed to it. */
export function canOpen(role: Role, path: string): boolean {
  return navFor(role).some((n) => n.to === path);
}

/** The route used to confirm, on the server, that the account really has the role. */
export function whoamiPath(role: Role): string {
  return role === 'admin' ? '/admin/whoami' : '/ngo/whoami';
}

import { describe, expect, it } from 'vitest';

import { canOpen, homeFor, navFor, roleFromLabels, whoamiPath } from './access';

describe('roleFromLabels', () => {
  it('maps the labels to a role', () => {
    expect(roleFromLabels(['admin'])).toBe('admin');
    expect(roleFromLabels(['ngo'])).toBe('ngo');
    expect(roleFromLabels(['beta', 'ngo'])).toBe('ngo');
  });

  it('prefers admin when an account has both', () => {
    expect(roleFromLabels(['ngo', 'admin'])).toBe('admin');
  });

  it('gives no role for anything else', () => {
    expect(roleFromLabels([])).toBeNull();
    expect(roleFromLabels(['Admin', 'NGO', 'ngo '])).toBeNull();
    expect(roleFromLabels(undefined)).toBeNull();
    expect(roleFromLabels(null)).toBeNull();
  });
});

describe('navigation by role', () => {
  it('shows an NGO account only the planting requests', () => {
    expect(navFor('ngo').map((n) => n.to)).toEqual(['/planting']);
  });

  it('shows an admin every page, planting requests included', () => {
    const paths = navFor('admin').map((n) => n.to);
    expect(paths).toContain('/planting');
    expect(paths).toContain('/users');
    expect(paths).toContain('/redemptions');
    expect(paths).toContain('/audit');
  });

  it('keeps every admin-only page closed to an NGO account', () => {
    for (const n of navFor('admin')) {
      expect(canOpen('ngo', n.to)).toBe(n.to === '/planting');
    }
    expect(canOpen('ngo', '/users')).toBe(false);
    expect(canOpen('ngo', '/nonsense')).toBe(false);
  });

  it('lets an admin open every page in the menu', () => {
    for (const n of navFor('admin')) expect(canOpen('admin', n.to)).toBe(true);
  });

  it('sends each role to a page it can open', () => {
    for (const role of ['admin', 'ngo'] as const) {
      expect(canOpen(role, homeFor(role))).toBe(true);
    }
    expect(homeFor('ngo')).toBe('/planting');
  });

  it('checks each role against its own route on the server', () => {
    expect(whoamiPath('admin')).toBe('/admin/whoami');
    expect(whoamiPath('ngo')).toBe('/ngo/whoami');
  });
});

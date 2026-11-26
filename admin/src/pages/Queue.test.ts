import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The page module imports the Appwrite client; nothing here may reach it.
vi.mock('../lib/appwrite', () => ({ api: { call: vi.fn() } }));

import type { QueueItem } from '../lib/types';
import { Warnings } from './Queue';
import { AiCell } from './Trees';

const base: QueueItem = {
  kind: 'verification',
  id: 'v1',
  createdAt: '2026-11-02T10:00:00.000Z',
  userId: 'u1',
  userName: 'Asha',
  userEmail: 'a@example.com',
  trustScore: 90,
  isBanned: false,
  title: 'Check-in 2026-11',
};

const render = (item: QueueItem, threshold?: number) =>
  renderToStaticMarkup(createElement(Warnings, { item, threshold }));

describe('Warnings', () => {
  it('shows nothing when there are no flags and no near-duplicate', () => {
    expect(render({ ...base, flags: [], phashDistanceToNearest: 40 })).toBe('');
    expect(render({ ...base, flags: [], phashDistanceToNearest: null })).toBe('');
  });

  it('shows a duplicate and a near-duplicate with their severity', () => {
    const dup = render({ ...base, flags: [], phashDistanceToNearest: 4 }, 8);
    expect(dup).toContain('Duplicate photo: 4 bits from an earlier photo (limit 8)');
    expect(dup).toContain('pill-bad');
    expect(dup).toContain('1 unresolved');

    const near = render({ ...base, flags: [], phashDistanceToNearest: 12 }, 8);
    expect(near).toContain('Possible near-duplicate: 12 bits');
    expect(near).toContain('pill-warn');
  });

  it('lists fraud flags with labels, detail and an unresolved count', () => {
    const html = render({
      ...base,
      flags: [
        { kind: 'not_a_plant', severity: 'medium', detail: 'client confidence 0.40', resolved: false },
        { kind: 'duplicate_photo', severity: 'critical', detail: 'hamming 2 vs x', resolved: false },
        { kind: 'out_of_radius', severity: 'medium', detail: '80 m from tree', resolved: true },
      ],
    });
    expect(html).toContain('Plant not clearly seen');
    expect(html).toContain('client confidence 0.40');
    expect(html).toContain('Duplicate photo');
    expect(html).toContain('Too far from the tree');
    expect(html).toContain('(resolved)');
    expect(html).toContain('2 unresolved');
  });

  it('says so when flags could not be loaded', () => {
    expect(render({ ...base, flags: null })).toContain('could not be loaded');
  });

  it('copes with an older server that sends neither field', () => {
    expect(render(base)).toBe('');
  });
});

describe('AiCell', () => {
  const cell = (verdict?: string, confidence?: number) =>
    renderToStaticMarkup(createElement(AiCell, { verdict, confidence }));

  it('shows confidence and the verdict in plain words', () => {
    const html = cell('conf=0.85 plant=true real=true species=Neem match=false', 0.85);
    expect(html).toContain('85%');
    expect(html).toContain('Looks like: Neem');
    expect(html).toContain('Does not match the species chosen');
  });

  it('shows a dash when the AI did not run', () => {
    expect(cell(undefined, undefined)).toBe('—');
  });
});

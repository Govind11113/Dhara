import { describe, expect, it } from 'vitest';

import { barLayout, integerTop, monthLabel, niceMax } from './chart';

describe('niceMax', () => {
  it('rounds up to 1, 2, 5 or 10 times a power of ten', () => {
    expect(niceMax(1)).toBe(1);
    expect(niceMax(1.4)).toBe(2);
    expect(niceMax(3)).toBe(5);
    expect(niceMax(5)).toBe(5);
    expect(niceMax(6)).toBe(10);
    expect(niceMax(43)).toBe(50);
    expect(niceMax(101)).toBe(200);
    expect(niceMax(0.3)).toBe(0.5);
  });

  it('never returns less than the value', () => {
    for (const v of [0.07, 1, 1.01, 2.5, 7, 9.99, 10, 123, 4999, 5001]) expect(niceMax(v)).toBeGreaterThanOrEqual(v);
  });

  it('falls back to 1 for nothing, zero or junk', () => {
    for (const v of [0, -4, Number.NaN, Number.POSITIVE_INFINITY]) expect(niceMax(v)).toBe(1);
  });
});

describe('barLayout', () => {
  it('draws the tallest value up to the top of the plot', () => {
    const bars = barLayout([0, 5, 10], 300, 100, 10);
    expect(bars.map((b) => b.height)).toEqual([0, 50, 100]);
    expect(bars.map((b) => b.y)).toEqual([100, 50, 0]);
  });

  it('keeps every bar inside the plot, side by side without overlap', () => {
    const bars = barLayout([3, 1, 4, 1, 5, 9, 2, 6], 400, 120);
    for (const b of bars) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(400);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.y + b.height).toBeLessThanOrEqual(120 + 1e-9);
    }
    for (let i = 1; i < bars.length; i++) expect(bars[i].x).toBeGreaterThanOrEqual(bars[i - 1].x + bars[i - 1].width);
  });

  it('an empty series is no bars, and all zeros are flat bars, never NaN', () => {
    expect(barLayout([], 300, 100)).toEqual([]);
    const flat = barLayout([0, 0, 0], 300, 100);
    expect(flat.every((b) => b.height === 0 && Number.isFinite(b.x) && Number.isFinite(b.y))).toBe(true);
  });

  it('draws a negative or non-finite value as zero but remembers what it was', () => {
    const bars = barLayout([-3, Number.NaN, 4], 300, 100, 4);
    expect(bars.map((b) => b.height)).toEqual([0, 0, 100]);
    expect(bars[0].value).toBe(-3);
  });

  it('chooses a tidy axis top by itself', () => {
    const bars = barLayout([3, 7], 200, 100);
    expect(bars[1].height).toBe(70); // 7 on a 0..10 axis
  });
});

describe('monthLabel', () => {
  it('shortens a month key', () => {
    expect(monthLabel('2026-10')).toBe('Oct');
    expect(monthLabel('2026-01')).toBe('Jan');
  });

  it('returns anything else untouched', () => {
    expect(monthLabel('soon')).toBe('soon');
    expect(monthLabel('2026-13')).toBe('2026-13');
  });
});

describe('integerTop', () => {
  it('is even and at least 2, so the middle gridline is a whole number', () => {
    expect(integerTop(0)).toBe(2);
    expect(integerTop(1)).toBe(2);
    expect(integerTop(2)).toBe(2);
    expect(integerTop(3)).toBe(6); // niceMax(3) is 5, which is odd
    expect(integerTop(5)).toBe(6);
    expect(integerTop(7)).toBe(10);
    expect(integerTop(43)).toBe(50);
  });

  it('never goes below the value and always halves cleanly', () => {
    for (const v of [0, 1, 2, 3, 4, 5, 6, 9, 11, 37, 99, 101, 640]) {
      const top = integerTop(v);
      expect(top).toBeGreaterThanOrEqual(v);
      expect(Number.isInteger(top / 2)).toBe(true);
    }
  });

  it('copes with junk', () => {
    expect(integerTop(Number.NaN)).toBe(2);
    expect(integerTop(-5)).toBe(2);
    expect(integerTop(Number.POSITIVE_INFINITY)).toBe(2);
  });
});

/**
 * Geometry for the small bar charts, kept out of the components so it can be
 * tested without a browser.
 */

/** Rounds up to 1, 2, 5 or 10 times a power of ten, for a tidy axis top. */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  const f = value / base;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * base;
}

/**
 * An axis top for counts. Always even and at least 2, so the middle gridline
 * lands on a whole number: a count axis labelled 2.5 would be nonsense.
 */
export function integerTop(value: number): number {
  const nice = niceMax(Number.isFinite(value) ? Math.ceil(value) : 0);
  return Math.max(2, 2 * Math.ceil(nice / 2));
}

export interface Bar {
  x: number;
  y: number;
  width: number;
  height: number;
  value: number;
}

/**
 * Lays out one bar per value inside a [width] x [height] plot. Bars rise from
 * the bottom; an empty series or a series of zeros gives zero-height bars rather
 * than NaN, and a negative value is drawn as zero (these are counts).
 */
export function barLayout(values: number[], width: number, height: number, top?: number): Bar[] {
  const n = values.length;
  if (n === 0) return [];
  const max = top ?? niceMax(Math.max(0, ...values));
  const slot = width / n;
  const barWidth = Math.max(2, slot * 0.62);

  return values.map((raw, i) => {
    const value = Number.isFinite(raw) && raw > 0 ? raw : 0;
    const h = max > 0 ? (value / max) * height : 0;
    return {
      x: i * slot + (slot - barWidth) / 2,
      y: height - h,
      width: barWidth,
      height: h,
      value: raw,
    };
  });
}

/** "2026-10" -> "Oct". Anything else is returned as it came. */
export function monthLabel(key: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return key;
  const index = Number(m[2]) - 1;
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return names[index] ?? key;
}

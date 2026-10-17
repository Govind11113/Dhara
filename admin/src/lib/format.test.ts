import { describe, expect, it } from 'vitest';

import { biggest, compactNumber, explainReasons, formatMass, explainVerdict, formatDate, humanise, mapsUrl, ms, percent, plural, share, shortId, timeAgo } from './format';

const now = new Date('2026-10-17T12:00:00.000Z');

describe('timeAgo', () => {
  it('reads recent times naturally', () => {
    expect(timeAgo('2026-10-17T11:59:50.000Z', now)).toBe('just now');
    expect(timeAgo('2026-10-17T11:30:00.000Z', now)).toBe('30 min ago');
    expect(timeAgo('2026-10-17T09:00:00.000Z', now)).toBe('3 h ago');
    expect(timeAgo('2026-10-15T12:00:00.000Z', now)).toBe('2 days ago');
    expect(timeAgo('2026-10-16T13:00:00.000Z', now)).toBe('23 h ago');
    expect(timeAgo('2026-10-16T12:00:00.000Z', now)).toBe('1 day ago');
  });

  it('treats the future as just now rather than negative', () => {
    expect(timeAgo('2026-10-17T13:00:00.000Z', now)).toBe('just now');
  });

  it('survives missing and invalid input', () => {
    expect(timeAgo(undefined, now)).toBe('—');
    expect(timeAgo('not a date', now)).toBe('—');
  });
});

describe('formatDate', () => {
  it('shows a dash for missing or invalid dates', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('nope')).toBe('—');
  });

  it('omits the year only within the current year', () => {
    expect(formatDate('2026-03-05T10:00:00.000Z', now)).not.toMatch(/2026/);
    expect(formatDate('2024-03-05T10:00:00.000Z', now)).toMatch(/2024/);
  });
});

describe('numbers', () => {
  it('formats percentages and guards non-numbers', () => {
    expect(percent(0.923)).toBe('92%');
    expect(percent(0.9234, 1)).toBe('92.3%');
    expect(percent(undefined)).toBe('—');
    expect(percent(Number.NaN)).toBe('—');
  });

  it('computes a share without dividing by zero', () => {
    expect(share(1, 4)).toBe('25%');
    expect(share(0, 0)).toBe('—');
  });

  it('formats latency', () => {
    expect(ms(912)).toBe('912 ms');
    expect(ms(2534)).toBe('2.5 s');
    expect(ms(0)).toBe('—');
    expect(ms(undefined)).toBe('—');
  });

  it('formats counts with Indian grouping', () => {
    expect(compactNumber(1234567)).toBe('12,34,567');
    expect(compactNumber(undefined)).toBe('—');
  });
});

describe('text', () => {
  it('turns codes into readable labels', () => {
    expect(humanise('pending_review')).toBe('Pending review');
    expect(humanise('ai_screen_photo')).toBe('Ai screen photo');
    expect(humanise('')).toBe('—');
    expect(humanise(undefined)).toBe('—');
  });

  it('shortens long ids only', () => {
    expect(shortId('abcdef0123456789')).toBe('abcdef01…');
    expect(shortId('short')).toBe('short');
    expect(shortId(undefined)).toBe('');
  });
});

describe('explainVerdict', () => {
  it('reads a full verdict, including values that contain spaces', () => {
    expect(
      explainVerdict('conf=0.90 plant=true real=true species=Neem (Azadirachta indica) match=true concerns=blurry edge; low light'),
    ).toEqual([
      'A plant is visible',
      'Looks like a real photo',
      'Looks like: Neem (Azadirachta indica)',
      'Matches the species chosen',
      'Concerns: blurry edge; low light',
    ]);
  });

  it('explains a rejected graphic in plain words', () => {
    expect(explainVerdict('conf=1.00 plant=false real=false')).toEqual([
      'No plant visible',
      'Not a real photo (screen, print or graphic)',
    ]);
  });

  it('copes with unknowns, empties and unfamiliar keys', () => {
    expect(explainVerdict('conf=0.40 plant=? real=? future=thing')).toEqual(['Plant: unclear', 'Photo: unclear']);
    expect(explainVerdict('')).toEqual([]);
    expect(explainVerdict(undefined)).toEqual([]);
    expect(explainVerdict('free text with no pairs')).toEqual([]);
  });
});

describe('mapsUrl', () => {
  it('builds a link from real coordinates', () => {
    expect(mapsUrl(12.97, 77.59)).toContain('mlat=12.97');
  });

  it('returns null rather than a broken link', () => {
    expect(mapsUrl(undefined, 77)).toBeNull();
    expect(mapsUrl(Number.NaN, 77)).toBeNull();
  });
});

describe('explainReasons', () => {
  it('turns reason codes into readable text, in order', () => {
    expect(explainReasons('ai_species_mismatch ai_low_confidence')).toEqual([
      'The plant does not look like the species chosen',
      'The AI was not confident about the photo',
    ]);
  });

  it('falls back to a readable form for a code it does not know', () => {
    expect(explainReasons('brand_new_code')).toEqual(['Brand new code']);
  });

  it('leaves an older sentence exactly as written', () => {
    expect(explainReasons('We could not clearly see a plant in that photo.')).toEqual([
      'We could not clearly see a plant in that photo.',
    ]);
  });

  it('returns nothing for an empty reason', () => {
    expect(explainReasons('')).toEqual([]);
    expect(explainReasons(undefined)).toEqual([]);
  });
});

describe('formatMass', () => {
  it('picks the unit that reads best', () => {
    expect(formatMass(0)).toBe('0 g');
    expect(formatMass(820)).toBe('820 g');
    expect(formatMass(999.4)).toBe('999 g');
    expect(formatMass(1000)).toBe('1 kg');
    expect(formatMass(4500)).toBe('4.5 kg');
    expect(formatMass(37000)).toBe('37 kg');
    expect(formatMass(999000)).toBe('999 kg');
    expect(formatMass(1_200_000)).toBe('1.2 t');
    expect(formatMass(25_000_000)).toBe('25 t');
  });

  it('drops a pointless .0', () => {
    expect(formatMass(2000)).toBe('2 kg');
    expect(formatMass(3_000_000)).toBe('3 t');
  });

  it('shows a dash for anything that is not a real amount', () => {
    expect(formatMass(undefined)).toBe('—');
    expect(formatMass(null)).toBe('—');
    expect(formatMass(Number.NaN)).toBe('—');
    expect(formatMass(-5)).toBe('—');
  });
});

describe('plural', () => {
  it('agrees with the count', () => {
    expect(plural(1, 'tree')).toBe('1 tree');
    expect(plural(0, 'tree')).toBe('0 trees');
    expect(plural(2, 'check-in')).toBe('2 check-ins');
    expect(plural(3, 'person', 'people')).toBe('3 people');
  });
});

describe('biggest', () => {
  it('names the largest group and its share', () => {
    expect(biggest({ electricity: 36, cooking: 10, transport: 34, air: 76 })).toBe('Flying · 49%');
  });

  it('copes with ties, unknown groups and nothing at all', () => {
    expect(biggest({ electricity: 50, cooking: 50 })).toMatch(/50%/);
    expect(biggest({ mystery: 10 })).toBe('mystery · 100%');
    expect(biggest({ electricity: 0, air: 0 })).toBe('—');
    expect(biggest({})).toBe('—');
  });
});

import { describe, expect, it } from 'vitest';

import { csvCell, csvFilename, reportTables, toCsv } from './csv';
import type { Report } from './types';

describe('csvCell', () => {
  it('leaves plain text and numbers alone', () => {
    expect(csvCell('Mumbai')).toBe('Mumbai');
    expect(csvCell(42)).toBe('42');
    expect(csvCell(-5)).toBe('-5'); // a real negative number is not text
    expect(csvCell(0)).toBe('0');
    expect(csvCell(3.14)).toBe('3.14');
  });

  it('quotes anything containing a comma, a quote or a line break', () => {
    expect(csvCell('Pune, Maharashtra')).toBe('"Pune, Maharashtra"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell('cr\rhere')).toBe('"cr\rhere"'); // quoted, not defused
  });

  it('turns missing and unusable values into an empty cell', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(Number.NaN)).toBe('');
    expect(csvCell(Number.POSITIVE_INFINITY)).toBe('');
  });

  it('writes booleans as words', () => {
    expect(csvCell(true)).toBe('true');
    expect(csvCell(false)).toBe('false');
  });

  // Place names come from members' addresses and species names from what they
  // typed. A spreadsheet would run any of these as a formula.
  describe('formula injection', () => {
    it.each([
      ['=SUM(A1:A9)', "'=SUM(A1:A9)"],
      ['+1+1', "'+1+1"],
      ['-2+3', "'-2+3"],
      ['@SUM(1)', "'@SUM(1)"],
      ['\tcmd', "'\tcmd"],
    ])('defuses %j', (input, expected) => {
      expect(csvCell(input)).toBe(expected);
    });

    it('defuses first, then quotes, when the text also needs quoting', () => {
      expect(csvCell('=HYPERLINK("http://evil","x"),y')).toBe('"\'=HYPERLINK(""http://evil"",""x""),y"');
    });

    it('does not touch text that merely contains those characters later on', () => {
      expect(csvCell('a=b')).toBe('a=b');
      expect(csvCell('x-y')).toBe('x-y');
      expect(csvCell('mail@home')).toBe('mail@home');
    });

    it('does defuse numeric-looking text, which is text', () => {
      expect(csvCell('-5')).toBe("'-5");
    });
  });
});

describe('toCsv', () => {
  it('writes a header and rows with CRLF endings and a final newline', () => {
    expect(toCsv(['A', 'B'], [[1, 'x'], [2, 'y']])).toBe('A,B\r\n1,x\r\n2,y\r\n');
  });

  it('writes just the header for an empty table', () => {
    expect(toCsv(['A', 'B'], [])).toBe('A,B\r\n');
  });

  it('keeps columns aligned when a cell is missing', () => {
    expect(toCsv(['A', 'B', 'C'], [[1, null, 3]])).toBe('A,B,C\r\n1,,3\r\n');
  });

  it('survives hostile cells in a whole row', () => {
    const line = toCsv(['Place', 'Trees'], [['=cmd|\' /C calc\'!A0', 3]]).split('\r\n')[1];
    expect(line.startsWith("'=cmd")).toBe(true);
    expect(line.endsWith(',3')).toBe(true);
  });
});

const report: Report = {
  generatedAt: '2026-10-18T00:00:00.000Z',
  months: ['2026-09', '2026-10'],
  capped: { trees: false, verifications: false, profiles: false, footprints: false },
  totals: { members: 6, trees: 2, livingTrees: 2, acceptedTrees: 2, survivalRate: 1, approvedCheckins: 3, co2CreditedGrams: 4250, creditsIssued: 40, creditsSpent: 0 },
  byStatus: { alive: 2 },
  series: [
    { month: '2026-09', treesPlanted: 0, checkins: 1, newMembers: 2, co2CreditedGrams: 1750 },
    { month: '2026-10', treesPlanted: 2, checkins: 2, newMembers: 1, co2CreditedGrams: 2500 },
  ],
  bySpecies: [{ code: 'neem', name: 'Neem', trees: 2, alive: 2 }, { code: 'x', name: '=EVIL()', trees: 1, alive: 0 }],
  byCity: [{ city: 'Mumbai', trees: 1 }, { city: '+Nowhere', trees: 1 }],
  footprint: { available: false, minMembers: 5 },
};

describe('reportTables', () => {
  const tables = reportTables(report);

  it('offers three tables with the headers a reader expects', () => {
    expect(tables.map((t) => t.key)).toEqual(['monthly', 'species', 'cities']);
    expect(tables[0].headers).toEqual(['Month', 'Trees planted', 'Check-ins approved', 'New members', 'CO2 credited (kg)']);
  });

  it('converts grams to kilograms for the CO2 column', () => {
    expect(tables[0].rows).toEqual([['2026-09', 0, 1, 2, 1.8], ['2026-10', 2, 2, 1, 2.5]]);
  });

  it('every row has as many cells as there are headers', () => {
    for (const t of tables) for (const row of t.rows) expect(row).toHaveLength(t.headers.length);
  });

  it('member-supplied text in the real tables is defused when written', () => {
    const csv = toCsv(tables[1].headers, tables[1].rows);
    expect(csv).toContain("'=EVIL()");
    expect(toCsv(tables[2].headers, tables[2].rows)).toContain("'+Nowhere");
  });

  it('contains no footprint data at all', () => {
    const everything = JSON.stringify(tables);
    expect(everything.toLowerCase()).not.toContain('footprint');
  });
});

describe('csvFilename', () => {
  it('names the file by table and day', () => {
    expect(csvFilename('monthly', new Date('2026-10-18T10:00:00Z'))).toBe('dhara-impact-monthly-2026-10-18.csv');
  });
});

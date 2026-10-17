import type { Report } from './types';

/**
 * CSV for spreadsheets.
 *
 * Two things matter beyond quoting. A cell that starts with = + - or @ is run
 * as a formula by Excel and Sheets, and some report text comes from members
 * (a place name, a species they typed), so such text is defused with a leading
 * apostrophe. And numbers are left alone: a genuine -5 is a number, not text.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';

  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180: comma separated, CRLF line endings. */
export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export interface CsvTable {
  key: 'monthly' | 'species' | 'cities';
  label: string;
  headers: string[];
  rows: unknown[][];
}

const kg = (grams: number) => Math.round((grams / 1000) * 10) / 10;

/** The tables the report can be downloaded as. */
export function reportTables(r: Report): CsvTable[] {
  return [
    {
      key: 'monthly',
      label: 'Monthly activity',
      headers: ['Month', 'Trees planted', 'Check-ins approved', 'New members', 'CO2 credited (kg)'],
      rows: r.series.map((s) => [s.month, s.treesPlanted, s.checkins, s.newMembers, kg(s.co2CreditedGrams)]),
    },
    {
      key: 'species',
      label: 'By species',
      headers: ['Species', 'Trees', 'Still alive'],
      rows: r.bySpecies.map((s) => [s.name, s.trees, s.alive]),
    },
    {
      key: 'cities',
      label: 'By place',
      headers: ['Place', 'Trees'],
      rows: r.byCity.map((c) => [c.city, c.trees]),
    },
  ];
}

/** Named by the reader's own date: at 2 a.m. in India, UTC would say yesterday. */
export function csvFilename(key: string, now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `dhara-impact-${key}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.csv`;
}

/** Saves text as a file. The BOM makes Excel read non-ASCII text as UTF-8. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Reads candidate figures out of a bill's OCR text.
 *
 * Output is a set of *suggestions*. The user confirms or corrects each one, and
 * whatever results is stored as `document_review`, never `verified`: text read
 * off a photo cannot prove which account or meter it came from.
 *
 * The patterns look for labels that commonly sit next to the figure ("Units
 * consumed", "Previous reading", "SCM") and accept a number only when the
 * label is on the same line. Anything ambiguous is left out rather than guessed.
 */

const NUM = '([0-9][0-9,]*(?:\\.[0-9]+)?)';

const ELECTRICITY_CONSUMPTION = [
  new RegExp(`(?:units?\\s*consumed|total\\s*units|consumption|units\\s*billed|net\\s*units)[^0-9\\n]{0,24}${NUM}\\s*(?:kwh|units?)?`, 'i'),
  new RegExp(`${NUM}\\s*kwh\\b`, 'i'),
];
const GAS_CONSUMPTION = [
  new RegExp(`(?:consumption|gas\\s*consumed|units?\\s*consumed|volume)[^0-9\\n]{0,24}${NUM}\\s*(?:scm|sm3)?`, 'i'),
  new RegExp(`${NUM}\\s*(?:scm|sm3)\\b`, 'i'),
];
const PREVIOUS = new RegExp(`(?:previous|prev\\.?|last)\\s*(?:meter\\s*)?reading[^0-9\\n]{0,24}${NUM}`, 'i');
const CURRENT = new RegExp(`(?:current|present)\\s*(?:meter\\s*)?reading[^0-9\\n]{0,24}${NUM}`, 'i');

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function toNumber(s) {
  const n = Number(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function firstMatch(text, patterns) {
  for (const p of patterns) {
    const m = p.exec(text);
    if (m) return toNumber(m[1]);
  }
  return null;
}

/** dd-mm-yyyy, dd/mm/yyyy, dd.mm.yyyy or dd-Mon-yyyy, as written on Indian bills. */
export function parseDate(s) {
  const t = String(s).trim();
  let m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t);
  if (m) return iso(+m[3], +m[2], +m[1]);
  m = /^(\d{1,2})[-\s/]?([A-Za-z]{3})[A-Za-z]*[-\s/,]*(\d{4})$/.exec(t);
  if (m && MONTHS[m[2].toLowerCase()]) return iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  return null;
}

function iso(y, mo, d) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const DATE = '(\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{4}|\\d{1,2}[-\\s]?[A-Za-z]{3,9}[-\\s,]*\\d{4})';
const PERIOD = new RegExp(`(?:billing\\s*period|bill\\s*period|period|from)[^0-9\\n]{0,16}${DATE}\\s*(?:to|-|–)\\s*${DATE}`, 'i');

export function extractFromText(utilityType, rawText) {
  const text = String(rawText ?? '').slice(0, 8000);
  const found = {
    consumptionValue: null,
    consumptionUnit: utilityType === 'png' ? 'SCM' : 'kWh',
    previousReading: null,
    currentReading: null,
    periodStart: null,
    periodEnd: null,
  };
  if (!text.trim()) return found;

  found.consumptionValue = firstMatch(text, utilityType === 'png' ? GAS_CONSUMPTION : ELECTRICITY_CONSUMPTION);
  found.previousReading = firstMatch(text, [PREVIOUS]);
  found.currentReading = firstMatch(text, [CURRENT]);

  // A consumption the meter readings contradict is not trustworthy; the
  // difference of the readings is, when both were read.
  if (found.previousReading != null && found.currentReading != null) {
    const diff = found.currentReading - found.previousReading;
    if (diff >= 0 && (found.consumptionValue == null || Math.abs(diff - found.consumptionValue) > 0.5)) {
      found.consumptionValue = found.consumptionValue == null ? round(diff) : null;
    }
  }

  const p = PERIOD.exec(text);
  if (p) {
    found.periodStart = parseDate(p[1]);
    found.periodEnd = parseDate(p[2]);
  }
  return found;
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}

/**
 * Whether what the user submitted agrees with what was read from the photo.
 * Used only to flag a document for closer review; agreement never verifies it.
 */
export function agreesWithDocument(extracted, submitted) {
  if (extracted.consumptionValue == null) return false;
  return Math.abs(Number(submitted.consumptionValue) - extracted.consumptionValue) <= 0.5;
}

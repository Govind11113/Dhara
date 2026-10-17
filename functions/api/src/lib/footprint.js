import { Rejected } from './context.js';
import {
  BENCHMARKS,
  FACTORS,
  FACTORS_VERSION,
  LPG_CYLINDER_KG,
} from './footprint_factors.js';

/**
 * Carbon footprint maths.
 *
 * Pure on purpose: no database, no network, no clock. The app only collects
 * inputs and displays what this returns, so there is exactly one implementation
 * of the calculation and the tests here are the specification.
 *
 * Everything is per person per month. Electricity and cooking gas are bought
 * by the household, so their share is divided by the household size.
 */

/** Travel modes, in the order they are shown. Keys match FACTORS. */
export const TRAVEL_MODES = [
  'car_petrol',
  'car_diesel',
  'motorbike',
  'taxi',
  'bus',
  'rail',
  'flight_domestic',
  'flight_international',
];

/** Largest believable monthly figure for each input. Beyond it is a typo. */
export const LIMITS = {
  householdSize: { min: 1, max: 20, integer: true },
  carOccupants: { min: 1, max: 8, integer: true },
  electricityKwh: { min: 0, max: 50000 },
  lpgCylinders: { min: 0, max: 20 },
  travel: {
    car_petrol: { min: 0, max: 20000 },
    car_diesel: { min: 0, max: 20000 },
    motorbike: { min: 0, max: 15000 },
    taxi: { min: 0, max: 15000 },
    bus: { min: 0, max: 15000 },
    rail: { min: 0, max: 30000 },
    flight_domestic: { min: 0, max: 30000 },
    flight_international: { min: 0, max: 60000 },
  },
};

const round = (n, places) => {
  const f = 10 ** places;
  return Math.round((n + Number.EPSILON) * f) / f;
};

/** Reads a number field, applying its limits. Absent means the default. */
function field(value, limit, label, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  // Only numbers and text are accepted. Anything else would be coerced:
  // String([1]) is "1", which would let an array through as the number 1.
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new Rejected('invalid_input', `${label} must be a number.`);
  }
  const n = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isFinite(n)) {
    throw new Rejected('invalid_input', `${label} must be a number.`);
  }
  if (limit.integer && !Number.isInteger(n)) {
    throw new Rejected('invalid_input', `${label} must be a whole number.`);
  }
  if (n < limit.min) {
    throw new Rejected('invalid_input', `${label} cannot be below ${limit.min}.`);
  }
  if (n > limit.max) {
    throw new Rejected(
      'invalid_input',
      `${label} looks too high (the most we accept is ${limit.max}). Check the number.`,
    );
  }
  return round(n, 2);
}

const LABELS = {
  householdSize: 'People in your household',
  carOccupants: 'People in the car',
  electricityKwh: 'Electricity',
  lpgCylinders: 'Gas cylinders',
};

/**
 * Validates and normalises raw input. Missing fields become 0 (or 1 for the two
 * counts). Unknown travel modes are refused rather than ignored, so a typo in a
 * key cannot silently drop someone's flights from their total.
 */
export function normalizeInputs(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Rejected('invalid_input', 'Send your numbers as an object.');
  }

  const travelRaw = raw.travel ?? {};
  if (typeof travelRaw !== 'object' || Array.isArray(travelRaw)) {
    throw new Rejected('invalid_input', 'Travel must be an object of distances.');
  }
  for (const key of Object.keys(travelRaw)) {
    if (!TRAVEL_MODES.includes(key)) {
      throw new Rejected('invalid_input', `"${key}" is not a travel type we recognise.`);
    }
  }

  const travel = {};
  for (const mode of TRAVEL_MODES) {
    travel[mode] = field(travelRaw[mode], LIMITS.travel[mode], `${FACTORS[mode].label} distance`, 0);
  }

  return {
    householdSize: field(raw.householdSize, LIMITS.householdSize, LABELS.householdSize, 1),
    carOccupants: field(raw.carOccupants, LIMITS.carOccupants, LABELS.carOccupants, 1),
    electricityKwh: field(raw.electricityKwh, LIMITS.electricityKwh, LABELS.electricityKwh, 0),
    lpgCylinders: field(raw.lpgCylinders, LIMITS.lpgCylinders, LABELS.lpgCylinders, 0),
    travel,
  };
}

/** True when at least one activity was entered, i.e. there is something to save. */
export function hasActivity(inputs) {
  return (
    inputs.electricityKwh > 0 ||
    inputs.lpgCylinders > 0 ||
    TRAVEL_MODES.some((m) => inputs.travel[m] > 0)
  );
}

/**
 * Turns normalised inputs into a footprint.
 *
 * @returns monthly personal kg CO2e in total and by group, one line per
 *          activity (with its factor's confidence), and the comparison with
 *          national averages.
 */
export function computeFootprint(inputs) {
  const size = inputs.householdSize;
  const lines = [];

  const add = (key, group, quantity, unit, kg) => {
    if (quantity <= 0) return;
    lines.push({
      key,
      group,
      label: FACTORS[key].label,
      quantity,
      unit,
      kg: kg,
      confidence: FACTORS[key].confidence,
      region: FACTORS[key].region,
    });
  };

  add('electricity', 'home', inputs.electricityKwh, 'kWh (household)', (inputs.electricityKwh * FACTORS.electricity.value) / size);
  add(
    'lpg',
    'home',
    inputs.lpgCylinders,
    `cylinders (${LPG_CYLINDER_KG} kg, household)`,
    (inputs.lpgCylinders * LPG_CYLINDER_KG * FACTORS.lpg.value) / size,
  );

  // Cars are measured per vehicle-km, so a shared car splits the total.
  add('car_petrol', 'road', inputs.travel.car_petrol, 'km', (inputs.travel.car_petrol * FACTORS.car_petrol.value) / inputs.carOccupants);
  add('car_diesel', 'road', inputs.travel.car_diesel, 'km', (inputs.travel.car_diesel * FACTORS.car_diesel.value) / inputs.carOccupants);
  add('motorbike', 'road', inputs.travel.motorbike, 'km', inputs.travel.motorbike * FACTORS.motorbike.value);
  add('taxi', 'road', inputs.travel.taxi, 'km', inputs.travel.taxi * FACTORS.taxi.value);
  add('bus', 'road', inputs.travel.bus, 'km', inputs.travel.bus * FACTORS.bus.value);
  add('rail', 'rail', inputs.travel.rail, 'km', inputs.travel.rail * FACTORS.rail.value);
  add('flight_domestic', 'air', inputs.travel.flight_domestic, 'km', inputs.travel.flight_domestic * FACTORS.flight_domestic.value);
  add('flight_international', 'air', inputs.travel.flight_international, 'km', inputs.travel.flight_international * FACTORS.flight_international.value);

  const sum = (groups) => lines.filter((l) => groups.includes(l.group)).reduce((s, l) => s + l.kg, 0);

  const monthKg = lines.reduce((s, l) => s + l.kg, 0);
  const breakdown = {
    homeKg: sum(['home']),
    roadKg: sum(['road']),
    railKg: sum(['rail']),
    airKg: sum(['air']),
  };
  // The two groups the app shows as "transport" and "flying".
  const groupedKg = {
    electricity: lines.find((l) => l.key === 'electricity')?.kg ?? 0,
    cooking: lines.find((l) => l.key === 'lpg')?.kg ?? 0,
    transport: breakdown.roadKg + breakdown.railKg,
    air: breakdown.airKg,
  };

  const yearKg = monthKg * 12;

  return {
    factorsVersion: FACTORS_VERSION,
    monthKg: round(monthKg, 1),
    // An annualised figure, i.e. "if every month looked like this one". Flights
    // are lumpy, so this is a projection, not a measurement.
    yearKg: round(yearKg, 0),
    groups: {
      electricity: round(groupedKg.electricity, 1),
      cooking: round(groupedKg.cooking, 1),
      transport: round(groupedKg.transport, 1),
      air: round(groupedKg.air, 1),
    },
    lines: lines
      .map((l) => ({ ...l, kg: round(l.kg, 1), share: monthKg > 0 ? round(l.kg / monthKg, 3) : 0 }))
      .sort((a, b) => b.kg - a.kg),
    comparison: {
      indiaKgYear: BENCHMARKS.india.kgPerYear,
      worldKgYear: BENCHMARKS.world.kgPerYear,
      indiaYear: BENCHMARKS.india.year,
      worldYear: BENCHMARKS.world.year,
      ofIndia: round(yearKg / BENCHMARKS.india.kgPerYear, 2),
      ofWorld: round(yearKg / BENCHMARKS.world.kgPerYear, 2),
    },
  };
}

/** "2026-10" in UTC. */
export function monthKeyOf(date) {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * A month a footprint may be filed under: well formed, not in the future, and
 * not more than two years back. The window lets someone backfill recent months
 * for a useful history without allowing nonsense dates.
 */
export function validMonthKey(key, now = new Date()) {
  if (typeof key !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) return false;
  const current = monthKeyOf(now);
  if (key > current) return false;

  const earliest = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 24, 1));
  return key >= monthKeyOf(earliest);
}

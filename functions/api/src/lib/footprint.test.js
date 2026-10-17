import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

import { SAMPLE_INPUTS } from './footprint_fixture_inputs.js';
import {
  TRAVEL_MODES,
  computeFootprint,
  hasActivity,
  monthKeyOf,
  normalizeInputs,
  validMonthKey,
} from './footprint.js';
import {
  BENCHMARKS,
  FACTORS,
  FACTORS_VERSION,
  LPG_CYLINDER_KG,
  methodology,
} from './footprint_factors.js';

const near = (actual, expected, tolerance, msg) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${msg ?? ''} expected ${expected} ±${tolerance}, got ${actual}`);

const rejects = (fn, code) =>
  assert.throws(fn, (e) => e.code === code && typeof e.message === 'string' && e.message.length > 0);

// ---------------------------------------------------------------------------
// The factors themselves
// ---------------------------------------------------------------------------

// These are scientific constants copied from named sources. If one changes, the
// version must change with it, so this test is deliberately a change detector:
// to alter a factor, edit the factor, bump FACTORS_VERSION, and update this
// snapshot in the same reviewed commit.
test('factors match the pinned snapshot for this version', () => {
  const snapshot = {
    version: '2026.1',
    values: {
      electricity: 0.727,
      lpg: 2.9394,
      car_petrol: 0.16152,
      car_diesel: 0.17265,
      motorbike: 0.11367,
      taxi: 0.14861,
      bus: 0.10151,
      rail: 0.03092,
      flight_domestic: 0.07559,
      flight_international: 0.0842,
    },
    benchmarks: { india: 2201, world: 4729 },
    cylinderKg: 14.2,
  };

  assert.equal(FACTORS_VERSION, snapshot.version, 'factors changed: bump the version and this snapshot together');
  assert.deepEqual(
    Object.fromEntries(Object.entries(FACTORS).map(([k, f]) => [k, f.value])),
    snapshot.values,
  );
  assert.equal(BENCHMARKS.india.kgPerYear, snapshot.benchmarks.india);
  assert.equal(BENCHMARKS.world.kgPerYear, snapshot.benchmarks.world);
  assert.equal(LPG_CYLINDER_KG, snapshot.cylinderKg);
});

test('every factor names its source, unit, region and confidence', () => {
  for (const [key, f] of Object.entries(FACTORS)) {
    assert.ok(f.value > 0 && Number.isFinite(f.value), `${key} value`);
    assert.ok(f.source.length > 40, `${key} source`);
    assert.ok(f.unit.includes('CO2'), `${key} unit`);
    assert.ok(['India', 'UK', 'International'].includes(f.region), `${key} region`);
    assert.ok(['high', 'medium', 'low'].includes(f.confidence), `${key} confidence`);
    assert.ok(f.label && f.note, `${key} label/note`);
  }
});

test('every travel mode has a factor, and every non-home factor is a travel mode', () => {
  for (const mode of TRAVEL_MODES) assert.ok(FACTORS[mode], mode);
  const nonTravel = Object.keys(FACTORS).filter((k) => !TRAVEL_MODES.includes(k));
  assert.deepEqual(nonTravel.sort(), ['electricity', 'lpg']);
});

// The one factor resting on a very different system is flagged, not hidden.
test('train and metro is marked low confidence; grid electricity is high', () => {
  assert.equal(FACTORS.rail.confidence, 'low');
  assert.equal(FACTORS.electricity.confidence, 'high');
  assert.equal(FACTORS.electricity.region, 'India');
});

test('methodology lists everything the maths uses, plus its limits', () => {
  const m = methodology();
  assert.equal(m.version, FACTORS_VERSION);
  assert.equal(m.factors.length, Object.keys(FACTORS).length);
  assert.ok(m.exclusions.some((e) => /food/i.test(e)));
  assert.ok(m.caveats.some((c) => /never affects your credits/i.test(c)));
  assert.ok(m.benchmarks.india.source.includes('Our World in Data'));
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test('an empty object is valid and means "nothing entered"', () => {
  const n = normalizeInputs({});
  assert.equal(n.householdSize, 1);
  assert.equal(n.carOccupants, 1);
  assert.equal(n.electricityKwh, 0);
  assert.equal(n.lpgCylinders, 0);
  for (const m of TRAVEL_MODES) assert.equal(n.travel[m], 0, m);
  assert.equal(hasActivity(n), false);
});

test('numbers sent as text are accepted', () => {
  const n = normalizeInputs({ electricityKwh: ' 150.5 ', travel: { bus: '40' } });
  assert.equal(n.electricityKwh, 150.5);
  assert.equal(n.travel.bus, 40);
});

test('input that is not an object is refused', () => {
  for (const bad of [null, undefined, 'x', 5, [], true]) {
    rejects(() => normalizeInputs(bad), 'invalid_input');
  }
});

test('non-numbers, NaN and Infinity are refused with the field named', () => {
  for (const bad of ['abc', Number.NaN, Number.POSITIVE_INFINITY, {}, [1], true]) {
    assert.throws(
      () => normalizeInputs({ electricityKwh: bad }),
      (e) => e.code === 'invalid_input' && /Electricity/.test(e.message),
      String(bad),
    );
  }
});

test('negative amounts are refused', () => {
  rejects(() => normalizeInputs({ electricityKwh: -1 }), 'invalid_input');
  rejects(() => normalizeInputs({ travel: { bus: -5 } }), 'invalid_input');
  rejects(() => normalizeInputs({ lpgCylinders: -0.5 }), 'invalid_input');
});

test('implausibly large amounts are refused as probable typos', () => {
  rejects(() => normalizeInputs({ electricityKwh: 50001 }), 'invalid_input');
  rejects(() => normalizeInputs({ lpgCylinders: 21 }), 'invalid_input');
  rejects(() => normalizeInputs({ travel: { car_petrol: 20001 } }), 'invalid_input');
  assert.doesNotThrow(() => normalizeInputs({ electricityKwh: 50000, travel: { car_petrol: 20000 } }));
});

test('household size and car occupants must be sensible whole numbers', () => {
  rejects(() => normalizeInputs({ householdSize: 0 }), 'invalid_input');
  rejects(() => normalizeInputs({ householdSize: 2.5 }), 'invalid_input');
  rejects(() => normalizeInputs({ householdSize: 21 }), 'invalid_input');
  rejects(() => normalizeInputs({ carOccupants: 0 }), 'invalid_input');
  rejects(() => normalizeInputs({ carOccupants: 9 }), 'invalid_input');
  assert.equal(normalizeInputs({ householdSize: 20 }).householdSize, 20);
});

// A mistyped key must not silently drop someone's flights from their total.
test('an unknown travel type is refused rather than ignored', () => {
  rejects(() => normalizeInputs({ travel: { flights: 500 } }), 'invalid_input');
  rejects(() => normalizeInputs({ travel: { rocket: 1 } }), 'invalid_input');
  rejects(() => normalizeInputs({ travel: [] }), 'invalid_input');
});

test('amounts are rounded to two decimals', () => {
  assert.equal(normalizeInputs({ electricityKwh: 10.12345 }).electricityKwh, 10.12);
});

// ---------------------------------------------------------------------------
// The maths, against numbers worked out by hand
// ---------------------------------------------------------------------------

test('100 kWh for one person: 100 x 0.727 = 72.7 kg', () => {
  const r = computeFootprint(normalizeInputs({ electricityKwh: 100 }));
  assert.equal(r.monthKg, 72.7);
  assert.equal(r.groups.electricity, 72.7);
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].key, 'electricity');
});

test('one cylinder for one person: 14.2 x 2.9394 = 41.7 kg', () => {
  const r = computeFootprint(normalizeInputs({ lpgCylinders: 1 }));
  assert.equal(r.monthKg, 41.7);
  assert.equal(r.groups.cooking, 41.7);
});

test('household electricity and gas are shared between its members', () => {
  const one = computeFootprint(normalizeInputs({ electricityKwh: 200, lpgCylinders: 1 }));
  const four = computeFootprint(normalizeInputs({ electricityKwh: 200, lpgCylinders: 1, householdSize: 4 }));
  near(four.monthKg, one.monthKg / 4, 0.06);
  near(four.groups.electricity, (200 * 0.727) / 4, 0.06);
  near(four.groups.cooking, (14.2 * 2.9394) / 4, 0.06);
});

test('a shared car splits per person; a bus, bike and taxi do not', () => {
  const car = computeFootprint(normalizeInputs({ travel: { car_petrol: 100 }, carOccupants: 1 }));
  const shared = computeFootprint(normalizeInputs({ travel: { car_petrol: 100 }, carOccupants: 4 }));
  near(car.monthKg, 16.152, 0.06);
  near(shared.monthKg, 16.152 / 4, 0.06);

  const others = normalizeInputs({ travel: { bus: 100, motorbike: 100, taxi: 100 }, carOccupants: 4 });
  const a = computeFootprint(others);
  const b = computeFootprint({ ...others, carOccupants: 1 });
  assert.equal(a.monthKg, b.monthKg, 'car occupants must not change non-car modes');
  near(a.monthKg, 100 * (0.10151 + 0.11367 + 0.14861), 0.06);
});

test('a worked example end to end', () => {
  // Household of 4, 200 kWh, 1 cylinder; a petrol car 300 km with 2 aboard,
  // 100 km by bus, one 1,000 km domestic flight.
  const r = computeFootprint(
    normalizeInputs({
      householdSize: 4,
      electricityKwh: 200,
      lpgCylinders: 1,
      carOccupants: 2,
      travel: { car_petrol: 300, bus: 100, flight_domestic: 1000 },
    }),
  );
  // 36.35 + 10.435 + 24.228 + 10.151 + 75.59 = 156.754
  assert.equal(r.monthKg, 156.8);
  assert.equal(r.yearKg, 1881);
  near(r.groups.electricity, 36.35, 0.06);
  assert.equal(r.groups.cooking, 10.4);
  assert.equal(r.groups.transport, 34.4);
  assert.equal(r.groups.air, 75.6);
  assert.equal(r.comparison.ofIndia, 0.85);
  assert.equal(r.comparison.ofWorld, 0.4);
  assert.equal(r.factorsVersion, FACTORS_VERSION);
});

test('the groups add up to the total', () => {
  const r = computeFootprint(
    normalizeInputs({
      electricityKwh: 321, lpgCylinders: 1.5, householdSize: 3,
      travel: { car_diesel: 410, rail: 220, bus: 35, flight_international: 4200, motorbike: 90 },
    }),
  );
  const parts = r.groups.electricity + r.groups.cooking + r.groups.transport + r.groups.air;
  near(parts, r.monthKg, 0.15);
});

test('lines are largest first, carry confidence, and shares add to one', () => {
  const r = computeFootprint(
    normalizeInputs({ electricityKwh: 100, travel: { rail: 500, flight_domestic: 800 } }),
  );
  const kgs = r.lines.map((l) => l.kg);
  assert.deepEqual(kgs, [...kgs].sort((a, b) => b - a));
  assert.equal(r.lines.find((l) => l.key === 'rail').confidence, 'low');
  assert.equal(r.lines.find((l) => l.key === 'electricity').confidence, 'high');
  near(r.lines.reduce((s, l) => s + l.share, 0), 1, 0.01);
});

test('nothing entered gives zero, no lines, and no division by zero', () => {
  const r = computeFootprint(normalizeInputs({}));
  assert.equal(r.monthKg, 0);
  assert.equal(r.yearKg, 0);
  assert.deepEqual(r.lines, []);
  assert.equal(r.comparison.ofIndia, 0);
});

test('an activity entered as zero produces no line', () => {
  const r = computeFootprint(normalizeInputs({ electricityKwh: 50, travel: { bus: 0 } }));
  assert.deepEqual(r.lines.map((l) => l.key), ['electricity']);
});

test('the annual figure is twelve times the month', () => {
  const r = computeFootprint(normalizeInputs({ electricityKwh: 137 }));
  near(r.yearKg, 137 * 0.727 * 12, 0.6);
});

test('comparison figures come from the cited benchmarks', () => {
  const r = computeFootprint(normalizeInputs({ electricityKwh: 100 }));
  assert.equal(r.comparison.indiaKgYear, 2201);
  assert.equal(r.comparison.worldKgYear, 4729);
  assert.equal(r.comparison.indiaYear, 2024);
});

test('computing does not mutate its input', () => {
  const input = normalizeInputs({ electricityKwh: 80, travel: { bus: 10 } });
  const copy = JSON.parse(JSON.stringify(input));
  computeFootprint(input);
  assert.deepEqual(input, copy);
});

// ---------------------------------------------------------------------------
// Months
// ---------------------------------------------------------------------------

const NOW = new Date(Date.UTC(2026, 9, 18)); // 18 Oct 2026

test('monthKeyOf uses UTC', () => {
  assert.equal(monthKeyOf('2026-10-31T23:30:00Z'), '2026-10');
  assert.equal(monthKeyOf('2026-01-01T00:00:00Z'), '2026-01');
});

test('the current month and the past two years are allowed', () => {
  assert.equal(validMonthKey('2026-10', NOW), true);
  assert.equal(validMonthKey('2026-01', NOW), true);
  assert.equal(validMonthKey('2024-10', NOW), true);
});

test('the future, the distant past and malformed keys are not', () => {
  assert.equal(validMonthKey('2026-11', NOW), false);
  assert.equal(validMonthKey('2024-09', NOW), false);
  assert.equal(validMonthKey('2026-13', NOW), false);
  assert.equal(validMonthKey('2026-00', NOW), false);
  assert.equal(validMonthKey('2026-1', NOW), false);
  assert.equal(validMonthKey('October', NOW), false);
  assert.equal(validMonthKey(202610, NOW), false);
  assert.equal(validMonthKey(null, NOW), false);
});

// ---------------------------------------------------------------------------
// Contract with the Flutter app
// ---------------------------------------------------------------------------

// The Dart tests parse these fixtures. If the server's output changes and the
// fixtures are not regenerated, the app's tests would keep passing against a
// shape the server no longer sends. This test makes that impossible.
const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../../../../test/fixtures/${name}`, import.meta.url), 'utf8'));

test('the Dart contract fixtures match what the server produces today', () => {
  assert.deepEqual(
    fixture('footprint_estimate.json'),
    JSON.parse(JSON.stringify(computeFootprint(normalizeInputs(SAMPLE_INPUTS)))),
    'run: cd functions/api && node scripts_gen_fixtures.mjs',
  );
  assert.deepEqual(
    fixture('footprint_methodology.json'),
    JSON.parse(JSON.stringify(methodology())),
    'run: cd functions/api && node scripts_gen_fixtures.mjs',
  );
});

// The app lists the same travel modes in the same order (kTravelModes).
test('the travel modes are exactly the ones the app offers', () => {
  assert.deepEqual(TRAVEL_MODES, [
    'car_petrol', 'car_diesel', 'motorbike', 'taxi', 'bus', 'rail', 'flight_domestic', 'flight_international',
  ]);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_MIN_TREE_SPACING_CM,
  assertSpacing,
  formatDistance,
  formatSpacing,
  minTreeSpacingCm,
  tooCloseToPlant,
} from './tree_spacing.js';
import { distanceM, geohash } from './context.js';
import { validateConfigValue } from './config_spec.js';

// The distances the planting rule must get right. Exactly 30 cm is allowed.
const CASES = [
  [0.1, true],
  [0.29, true],
  [0.3, false],
  [0.31, false],
  [0.5, false],
  [1, false],
  [3, false],
];

test('trees closer than 30 cm are refused and 30 cm or more is allowed', () => {
  for (const [d, refused] of CASES) {
    assert.equal(tooCloseToPlant(d), refused, `${d} m`);
    assert.equal(tooCloseToPlant(d, 30), refused, `${d} m at 30 cm`);
  }
});

test('the limit falls back to 30 cm when the setting is missing or invalid', () => {
  assert.equal(DEFAULT_MIN_TREE_SPACING_CM, 30);
  for (const config of [
    undefined,
    {},
    { 'tree.min_spacing_cm': null },
    { 'tree.min_spacing_cm': '' },
    { 'tree.min_spacing_cm': 'abc' },
    { 'tree.min_spacing_cm': Number.NaN },
    { 'tree.min_spacing_cm': -5 },
    { 'tree.min_spacing_cm': 12.5 },
    { 'tree.min_spacing_cm': 999999 },
  ]) {
    assert.equal(minTreeSpacingCm(config), 30, JSON.stringify(config));
  }
  assert.equal(minTreeSpacingCm({ 'tree.min_spacing_cm': 45 }), 45);
  assert.equal(minTreeSpacingCm({ 'tree.min_spacing_cm': '45' }), 45);
  assert.equal(minTreeSpacingCm({ 'tree.min_spacing_cm': 0 }), 0);
});

test('the old 3-metre key is ignored', () => {
  assert.equal(minTreeSpacingCm({ 'tree.min_spacing_m': 3 }), 30);
  assert.equal(tooCloseToPlant(1, minTreeSpacingCm({ 'tree.min_spacing_m': 3 })), false);
});

test('distances under a metre are shown in centimetres', () => {
  assert.equal(formatDistance(0.12), '12 cm');
  assert.equal(formatDistance(0.994), '99 cm');
  assert.equal(formatDistance(0.996), '1 m');
  assert.equal(formatDistance(4.2), '4 m');
  assert.equal(formatSpacing(30), '30 cm');
  assert.equal(formatSpacing(100), '1 m');
  assert.equal(formatSpacing(150), '1.5 m');
});

test('admins can set the limit in whole centimetres only', () => {
  assert.equal(validateConfigValue('tree.min_spacing_cm', 30), '30');
  assert.throws(() => validateConfigValue('tree.min_spacing_cm', 0.3), (e) => e.code === 'bad_request');
  assert.throws(() => validateConfigValue('tree.min_spacing_cm', 5001), (e) => e.code === 'bad_request');
  assert.throws(() => validateConfigValue('tree.min_spacing_m', 3), (e) => e.code === 'bad_request');
});

// ---------------------------------------------------------------------------
// The check the planting route runs, against real coordinates.
// ---------------------------------------------------------------------------

const BASE = { lat: 18.5204, lng: 73.8567 };
const M_PER_DEG_LAT = 6371000 * (Math.PI / 180);
/** A point [metres] due north of BASE. */
const north = (metres) => ({ lat: BASE.lat + metres / M_PER_DEG_LAT, lng: BASE.lng });

function dbWith(trees) {
  return {
    async listDocuments(_db, _col, queries) {
      const prefix = JSON.parse(queries[0]).values[0];
      return { documents: trees.filter((t) => t.geohash.startsWith(prefix)) };
    },
  };
}

const existing = (point, extra = {}) => ({
  ...point,
  geohash: geohash(point.lat, point.lng, 9),
  ownerId: 'u1',
  nickname: 'Neem by the gate',
  ...extra,
});

test('planting next to an existing tree follows the same distances', async () => {
  for (const [d, refused] of CASES) {
    const spot = north(d);
    const db = dbWith([existing(BASE)]);
    const attempt = assertSpacing(db, { ...spot, userId: 'u1', config: {} });
    if (refused) {
      await assert.rejects(attempt, (e) => e.code === 'too_close', `${d} m`);
    } else {
      await assert.doesNotReject(attempt, `${d} m`);
    }
  }
  // The coordinates really are the distance the test says.
  assert.ok(Math.abs(distanceM(BASE.lat, BASE.lng, north(0.3).lat, BASE.lng) - 0.3) < 1e-6);
});

test('the refusal says how close in centimetres and what the limit is', async () => {
  const spot = north(0.12);
  await assert.rejects(
    assertSpacing(dbWith([existing(BASE)]), { ...spot, userId: 'u1', config: {} }),
    (e) =>
      e.code === 'too_close' &&
      e.message.includes('about 12 cm away') &&
      e.message.includes('at least 30 cm apart') &&
      e.details.minSpacingCm === 30 &&
      e.details.distanceM === 0.12,
  );
  await assert.rejects(
    assertSpacing(dbWith([existing(BASE, { ownerId: 'u2' })]), { ...spot, userId: 'u1', config: {} }),
    (e) => e.code === 'too_close' && e.message.startsWith('Another member') && !e.message.includes('Neem'),
  );
});

test('an admin-set limit is enforced, and 0 turns the check off', async () => {
  const spot = north(0.4);
  const db = dbWith([existing(BASE)]);
  await assert.rejects(
    assertSpacing(db, { ...spot, userId: 'u1', config: { 'tree.min_spacing_cm': 50 } }),
    (e) => e.code === 'too_close' && e.message.includes('at least 50 cm apart'),
  );
  await assert.doesNotReject(
    assertSpacing(db, { ...north(0), userId: 'u1', config: { 'tree.min_spacing_cm': 0 } }),
  );
});

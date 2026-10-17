import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MIN_MEMBERS_FOR_FOOTPRINT,
  buildReport,
  cityOf,
  footprintSection,
  monthOf,
  monthWindow,
} from './report.js';

const NOW = new Date(Date.UTC(2026, 9, 18, 12)); // 18 Oct 2026

const species = [
  { code: 'neem', name: 'Neem', co2PerYearGrams: 21000 },
  { code: 'bamboo', name: 'Bamboo', co2PerYearGrams: 30000 },
];

const tree = (over = {}) => ({
  $id: `t${Math.random()}`,
  speciesCode: 'neem',
  speciesName: 'Neem',
  status: 'alive',
  plantedAt: '2026-10-05T00:00:00.000Z',
  addressLabel: 'Andheri West, Mumbai, Maharashtra',
  ...over,
});

const report = (over = {}) => buildReport({ species, now: NOW, ...over });

// ---------------------------------------------------------------------------
// Months
// ---------------------------------------------------------------------------

test('the window is the last N months, oldest first, ending now', () => {
  assert.deepEqual(monthWindow(3, NOW), ['2026-08', '2026-09', '2026-10']);
  assert.equal(monthWindow(12, NOW).length, 12);
  assert.equal(monthWindow(12, NOW)[0], '2025-11');
});

test('the window crosses a year boundary correctly', () => {
  assert.deepEqual(monthWindow(4, new Date(Date.UTC(2026, 1, 3))), ['2025-11', '2025-12', '2026-01', '2026-02']);
});

test('monthOf reads dates in UTC and rejects junk', () => {
  assert.equal(monthOf('2026-10-31T23:59:59Z'), '2026-10');
  assert.equal(monthOf('not a date'), null);
  assert.equal(monthOf(undefined), null);
});

// ---------------------------------------------------------------------------
// Cities
// ---------------------------------------------------------------------------

test('a trailing state is dropped and the city before it is used', () => {
  assert.equal(cityOf('Andheri West, Mumbai, Maharashtra'), 'Mumbai');
  assert.equal(cityOf('Mumbai, Maharashtra'), 'Mumbai');
  assert.equal(cityOf('Koramangala, Bengaluru, Karnataka'), 'Bengaluru');
  assert.equal(cityOf('T. Nagar, Chennai, Tamil Nadu'), 'Chennai');
});

// The bug found by reading the real report: "Test Street, Bengaluru" has no
// state, so the street must not be mistaken for the city.
test('without a state the last part is the city, not the second from the end', () => {
  assert.equal(cityOf('Test Street, Bengaluru'), 'Bengaluru');
  assert.equal(cityOf('MG Road, Pune'), 'Pune');
});

test('where the city and the state are one, that is the city', () => {
  assert.equal(cityOf('Connaught Place, New Delhi, Delhi'), 'Delhi');
  assert.equal(cityOf('Karol Bagh, Delhi'), 'Delhi');
  assert.equal(cityOf('Sector 17, Chandigarh'), 'Chandigarh');
  assert.equal(cityOf('Delhi, Delhi'), 'Delhi');
});

test('state names are matched whatever their case or spelling variant', () => {
  assert.equal(cityOf('Salt Lake, Kolkata, west bengal'), 'Kolkata');
  assert.equal(cityOf('Bhubaneswar, ODISHA'), 'Bhubaneswar');
  assert.equal(cityOf('Cuttack, Orissa'), 'Cuttack');
  assert.equal(cityOf('Rohini, NCT of Delhi'), 'NCT of Delhi');
});

test('a label that is only a state is reported as that state', () => {
  assert.equal(cityOf('Karnataka'), 'Karnataka');
});

test('nothing usable is Unknown', () => {
  for (const empty of ['', '  ', ',,', undefined, null]) assert.equal(cityOf(empty), 'Unknown', String(empty));
});

test('repeated parts and stray spacing are cleaned up', () => {
  assert.equal(cityOf(' Pune ,  Pune , Maharashtra '), 'Pune');
});

test('outside India the last part is used as it stands', () => {
  assert.equal(cityOf('Shibuya, Tokyo'), 'Tokyo');
});

// ---------------------------------------------------------------------------
// Totals and survival
// ---------------------------------------------------------------------------

test('survival is living trees over accepted trees, ignoring those never accepted', () => {
  const r = report({
    trees: [
      tree({ status: 'alive' }),
      tree({ status: 'alive' }),
      tree({ status: 'at_risk' }),
      tree({ status: 'dead' }),
      tree({ status: 'pending_review' }),
      tree({ status: 'rejected' }),
    ],
  });
  assert.equal(r.totals.acceptedTrees, 4);
  assert.equal(r.totals.livingTrees, 3);
  assert.equal(r.totals.survivalRate, 0.75);
  assert.equal(r.totals.trees, 6);
});

test('survival is null, not zero, when nothing has been accepted yet', () => {
  assert.equal(report({ trees: [tree({ status: 'pending_review' })] }).totals.survivalRate, null);
  assert.equal(report().totals.survivalRate, null);
});

test('an empty system produces a complete, zeroed report', () => {
  const r = report();
  assert.equal(r.series.length, 12);
  assert.ok(r.series.every((s) => s.treesPlanted === 0 && s.checkins === 0 && s.newMembers === 0));
  assert.deepEqual(r.bySpecies, []);
  assert.deepEqual(r.byCity, []);
  assert.equal(r.totals.members, 0);
  assert.equal(r.footprint.available, false);
});

test('credit totals are summed from member profiles, tolerating bad values', () => {
  const r = report({
    profiles: [
      { creditsLifetime: 100, creditsSpent: 30 },
      { creditsLifetime: 50, creditsSpent: null },
      { creditsLifetime: 'x' },
      {},
    ],
  });
  assert.equal(r.totals.creditsIssued, 150);
  assert.equal(r.totals.creditsSpent, 30);
  assert.equal(r.totals.members, 4);
});

// ---------------------------------------------------------------------------
// Monthly series
// ---------------------------------------------------------------------------

test('trees are counted in the month they were planted, inside the window only', () => {
  const r = report({
    months: 3,
    trees: [
      tree({ plantedAt: '2026-10-02T00:00:00Z' }),
      tree({ plantedAt: '2026-10-20T00:00:00Z' }),
      tree({ plantedAt: '2026-09-15T00:00:00Z' }),
      tree({ plantedAt: '2026-01-15T00:00:00Z' }), // before the window
      tree({ plantedAt: '2026-10-02T00:00:00Z', status: 'rejected' }),
      tree({ plantedAt: '2026-10-02T00:00:00Z', status: 'pending_review' }),
    ],
  });
  assert.deepEqual(r.series.map((s) => [s.month, s.treesPlanted]), [['2026-08', 0], ['2026-09', 1], ['2026-10', 2]]);
});

test('approved check-ins are counted by their month; held and rejected are not', () => {
  const t = tree({ $id: 'a' });
  const v = (status, monthKey) => ({ treeId: 'a', status, monthKey, verifiedAt: `${monthKey}-10T00:00:00Z` });
  const r = report({
    months: 3,
    trees: [t],
    verifications: [v('approved', '2026-10'), v('approved', '2026-10'), v('approved', '2026-09'), v('manual_review', '2026-10'), v('rejected', '2026-09')],
  });
  assert.deepEqual(r.series.map((s) => s.checkins), [0, 1, 2]);
  assert.equal(r.totals.approvedCheckins, 3);
});

test('new members are counted by sign-up month', () => {
  const r = report({
    months: 2,
    profiles: [{ $createdAt: '2026-10-01T00:00:00Z' }, { $createdAt: '2026-10-09T00:00:00Z' }, { $createdAt: '2026-09-09T00:00:00Z' }, { $createdAt: '2020-01-01T00:00:00Z' }],
  });
  assert.deepEqual(r.series.map((s) => s.newMembers), [1, 2]);
});

test('CO2 credited follows the profile rule: the species yearly figure over twelve, per approved check-in', () => {
  const r = report({
    months: 2,
    trees: [tree({ $id: 'n', speciesCode: 'neem' }), tree({ $id: 'b', speciesCode: 'bamboo' })],
    verifications: [
      { treeId: 'n', status: 'approved', monthKey: '2026-10' },
      { treeId: 'b', status: 'approved', monthKey: '2026-10' },
    ],
  });
  // 21000/12 = 1750 and 30000/12 = 2500 grams.
  assert.equal(r.totals.co2CreditedGrams, 4250);
  assert.equal(r.series[1].co2CreditedGrams, 4250);
});

test('a check-in for an unknown species uses the default rate, like the credit does', () => {
  const r = report({
    trees: [tree({ $id: 'x', speciesCode: 'mystery' })],
    verifications: [{ treeId: 'x', status: 'approved', monthKey: '2026-10' }],
  });
  assert.equal(r.totals.co2CreditedGrams, 1500); // 18000 / 12
});

test('a check-in whose tree is gone is still counted, at the default rate', () => {
  const r = report({ verifications: [{ treeId: 'gone', status: 'approved', monthKey: '2026-10' }] });
  assert.equal(r.totals.approvedCheckins, 1);
  assert.equal(r.totals.co2CreditedGrams, 1500);
});

// ---------------------------------------------------------------------------
// Species and places
// ---------------------------------------------------------------------------

test('species are ranked by trees, with how many are still alive', () => {
  const r = report({
    trees: [
      tree({ speciesCode: 'bamboo' }),
      tree({ speciesCode: 'neem' }),
      tree({ speciesCode: 'neem', status: 'dead' }),
      tree({ speciesCode: 'neem' }),
    ],
  });
  assert.deepEqual(r.bySpecies.map((s) => [s.name, s.trees, s.alive]), [['Neem', 3, 2], ['Bamboo', 1, 1]]);
});

test('a species missing from the table falls back to the tree\'s own name', () => {
  const r = report({ trees: [tree({ speciesCode: 'baobab', speciesName: 'Baobab' })] });
  assert.equal(r.bySpecies[0].name, 'Baobab');
});

test('cities are ranked, and everything past ten collapses into "Other places"', () => {
  const trees = [];
  for (let i = 0; i < 13; i++) {
    for (let j = 0; j <= 13 - i; j++) trees.push(tree({ addressLabel: `Area, City${String(i).padStart(2, '0')}, Maharashtra` }));
  }
  const r = report({ trees });
  assert.equal(r.byCity.length, 11);
  assert.equal(r.byCity[0].city, 'City00');
  assert.equal(r.byCity.at(-1).city, 'Other places');
  assert.equal(r.byCity.reduce((s, c) => s + c.trees, 0), trees.length);
});

test('trees never accepted are left out of species and city breakdowns', () => {
  const r = report({ trees: [tree({ status: 'rejected' }), tree({ status: 'pending_review' })] });
  assert.deepEqual(r.bySpecies, []);
  assert.deepEqual(r.byCity, []);
});

test('the report says which lists were cut short', () => {
  const r = report({ capped: { trees: true } });
  assert.deepEqual(r.capped, { trees: true, verifications: false, profiles: false, footprints: false });
});

// ---------------------------------------------------------------------------
// Footprint privacy
// ---------------------------------------------------------------------------

const fp = (userId, monthKg, monthKey = '2026-10', over = {}) => ({
  userId, monthKey, monthKg, yearKg: monthKg * 12,
  electricityKg: monthKg * 0.4, cookingKg: monthKg * 0.1, transportKg: monthKg * 0.3, airKg: monthKg * 0.2, ...over,
});

const window = monthWindow(3, NOW);

test('the threshold is five members', () => {
  assert.equal(MIN_MEMBERS_FOR_FOOTPRINT, 5);
});

test('with fewer than five members, nothing about footprints is published', () => {
  const rows = [fp('u1', 123.4), fp('u2', 98.7), fp('u3', 250.1), fp('u4', 76.5)];
  const s = footprintSection(rows, window);
  assert.deepEqual(s, { available: false, minMembers: 5 });

  // Not the average, not the count, and nothing derived from either.
  const text = JSON.stringify(s);
  for (const leak of ['123.4', '98.7', '250.1', '76.5', '137', '"members"', '"avg']) {
    assert.ok(!text.includes(leak), `leaked ${leak}`);
  }
});

test('the threshold counts distinct members, not rows', () => {
  const rows = [fp('u1', 100), fp('u1', 110, '2026-09'), fp('u1', 120, '2026-08'), fp('u2', 90), fp('u3', 95), fp('u4', 80)];
  assert.equal(footprintSection(rows, window).available, false, 'four people, six rows');
});

test('with five members the averages appear', () => {
  const rows = [100, 200, 300, 400, 500].map((kg, i) => fp(`u${i}`, kg));
  const s = footprintSection(rows, window);
  assert.equal(s.available, true);
  assert.equal(s.members, 5);
  assert.equal(s.avgMonthKg, 300);
  assert.equal(s.medianMonthKg, 300);
  assert.equal(s.avgYearKg, 3600);
  assert.deepEqual(s.groups, { electricity: 120, cooking: 30, transport: 90, air: 60 });
});

test('headline figures use each member\'s latest month only', () => {
  const rows = [
    ...[100, 100, 100, 100, 100].map((kg, i) => fp(`u${i}`, kg, '2026-10')),
    fp('u0', 900, '2026-08'), // an old, much larger month for u0 must not count
  ];
  assert.equal(footprintSection(rows, window).avgMonthKg, 100);
});

test('the median of an even group is the midpoint', () => {
  const rows = [100, 200, 300, 400, 500, 600].map((kg, i) => fp(`u${i}`, kg));
  assert.equal(footprintSection(rows, window).medianMonthKg, 350);
});

// A month with fewer than five contributors could identify them, so its value
// is left blank even though the overall figure is published.
test('a trend month with fewer than five members is suppressed', () => {
  const rows = [
    ...[100, 100, 100, 100, 100].map((kg, i) => fp(`u${i}`, kg, '2026-10')),
    ...[50, 60].map((kg, i) => fp(`u${i}`, kg, '2026-09')),
  ];
  const trend = footprintSection(rows, window).trend;
  assert.equal(trend.find((t) => t.month === '2026-10').avgMonthKg, 100);
  assert.equal(trend.find((t) => t.month === '2026-09').avgMonthKg, null);
  assert.equal(trend.find((t) => t.month === '2026-08').avgMonthKg, null);
});

test('the published section never contains a member id', () => {
  const rows = ['alice-id', 'bob-id', 'carol-id', 'dave-id', 'erin-id'].map((id, i) => fp(id, 100 + i));
  const text = JSON.stringify(footprintSection(rows, window));
  for (const id of ['alice-id', 'bob-id', 'carol-id', 'dave-id', 'erin-id', 'userId']) {
    assert.ok(!text.includes(id), `leaked ${id}`);
  }
});

test('the whole report carries no names, emails or ids from the people behind it', () => {
  const r = report({
    profiles: [{ $id: 'secret-profile-id', userId: 'secret-user', name: 'Asha Verma', email: 'asha@example.com', $createdAt: '2026-10-01T00:00:00Z' }],
    trees: [tree({ ownerId: 'secret-user', nickname: 'Asha\'s favourite' })],
    footprints: [fp('secret-user', 123.456)],
  });
  const text = JSON.stringify(r);
  for (const leak of ['secret-profile-id', 'secret-user', 'Asha', 'asha@example.com', '123.456']) {
    assert.ok(!text.includes(leak), `report leaked ${leak}`);
  }
});

test('rows without a member or a month are ignored rather than counted', () => {
  const rows = [fp('u1', 100), { monthKg: 50 }, { userId: 'u2' }, null].filter(Boolean);
  assert.equal(footprintSection(rows, window).available, false);
});

/**
 * The impact report: totals, trends and breakdowns for the admin panel.
 *
 * Pure on purpose. It takes already-fetched rows and returns plain numbers, so
 * every rule here (what counts, what is hidden, how a city is read from an
 * address) is covered by tests without a database.
 *
 * Privacy rule for carbon footprints: they are personal data, so the report
 * never contains a single member's figures, and it publishes an average only
 * when at least MIN_MEMBERS_FOR_FOOTPRINT members contribute to it. Below that
 * an average could be traced back to one or two people, so nothing at all is
 * returned — not even the count.
 */

export const MIN_MEMBERS_FOR_FOOTPRINT = 5;

/** Grams a species is credited per approved check-in when it has no figure. */
const DEFAULT_CO2_PER_YEAR_G = 18000;

const num = (v, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const round = (n, places = 0) => {
  const f = 10 ** places;
  return Math.round((n + Number.EPSILON) * f) / f;
};
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/** "2026-10" for a date, in UTC. */
export const monthOf = (value) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? null
    : `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** The last [count] month keys ending at [now]'s month, oldest first. */
export function monthWindow(count, now = new Date()) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    out.push(monthOf(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)));
  }
  return out;
}

/**
 * Indian states and union territories as address labels spell them, lower case.
 * Used to tell "city, state" from "street, city": position alone cannot, because
 * a two-part label can be either.
 */
const STATES = new Set([
  'andhra pradesh', 'arunachal pradesh', 'assam', 'bihar', 'chhattisgarh', 'goa', 'gujarat',
  'haryana', 'himachal pradesh', 'jharkhand', 'karnataka', 'kerala', 'madhya pradesh',
  'maharashtra', 'manipur', 'meghalaya', 'mizoram', 'nagaland', 'odisha', 'orissa', 'punjab',
  'rajasthan', 'sikkim', 'tamil nadu', 'telangana', 'tripura', 'uttar pradesh',
  'uttarakhand', 'uttaranchal', 'west bengal',
  'andaman and nicobar islands', 'chandigarh', 'dadra and nagar haveli and daman and diu',
  'delhi', 'nct of delhi', 'jammu and kashmir', 'ladakh', 'lakshadweep', 'puducherry',
]);

/** Where the state and the city are the same place, the state is the city. */
const CITY_STATES = new Set(['delhi', 'nct of delhi', 'chandigarh']);

/**
 * The city part of an address label.
 *
 * Labels are built as "locality, city, state", with any part missing. A trailing
 * Indian state or territory name is dropped and the last part left is the city:
 * "Andheri West, Mumbai, Maharashtra" is Mumbai, "Test Street, Bengaluru" is
 * Bengaluru, and "Connaught Place, New Delhi, Delhi" is Delhi, where the city
 * and the state are one. A label that is only a state is reported as that
 * state, and an empty one as "Unknown". Outside India, where no state is
 * recognised, the last part is used as it stands.
 */
export function cityOf(label) {
  const parts = String(label ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p, i, all) => all.indexOf(p) === i);

  if (parts.length === 0) return 'Unknown';
  if (parts.length === 1) return parts[0];

  const last = parts[parts.length - 1];
  if (STATES.has(last.toLowerCase())) {
    if (CITY_STATES.has(last.toLowerCase())) return last;
    return parts[parts.length - 2];
  }
  return last;
}

const ACCEPTED = ['alive', 'at_risk', 'missed', 'dead'];
const LIVING = ['alive', 'at_risk'];

/**
 * @param {object} input
 * @param {object[]} input.trees
 * @param {object[]} input.verifications
 * @param {object[]} input.profiles
 * @param {object[]} input.footprints
 * @param {object[]} input.species
 * @param {number}   input.months      how many months the trend covers
 * @param {Date}     input.now
 * @param {object}   input.capped      which lists were cut short by the row cap
 */
export function buildReport({
  trees = [],
  verifications = [],
  profiles = [],
  footprints = [],
  species = [],
  months = 12,
  now = new Date(),
  capped = {},
}) {
  const window = monthWindow(months, now);
  const inWindow = new Set(window);
  const speciesByCode = new Map(species.map((s) => [s.code ?? s.$id, s]));

  const blank = () => Object.fromEntries(window.map((m) => [m, 0]));
  const planted = blank();
  const checkins = blank();
  const newMembers = blank();
  const co2Grams = blank();

  // --- Trees -----------------------------------------------------------------
  const byStatus = {};
  const bySpecies = new Map();
  const byCity = new Map();

  for (const t of trees) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;

    // A tree that was never accepted is not "planted" for reporting.
    if (t.status !== 'rejected' && t.status !== 'pending_review') {
      const m = monthOf(t.plantedAt ?? t.$createdAt);
      if (m && inWindow.has(m)) planted[m]++;

      const code = t.speciesCode ?? 'other';
      const row = bySpecies.get(code) ?? {
        code,
        name: speciesByCode.get(code)?.name || t.speciesName || code,
        trees: 0,
        alive: 0,
      };
      row.trees++;
      if (LIVING.includes(t.status)) row.alive++;
      bySpecies.set(code, row);

      const city = cityOf(t.addressLabel);
      byCity.set(city, (byCity.get(city) ?? 0) + 1);
    }
  }

  const accepted = trees.filter((t) => ACCEPTED.includes(t.status)).length;
  const living = trees.filter((t) => LIVING.includes(t.status)).length;

  // --- Check-ins -------------------------------------------------------------
  let approvedTotal = 0;
  let co2TotalGrams = 0;

  for (const v of verifications) {
    if (v.status !== 'approved') continue;
    approvedTotal++;
    // The same rule that credits a member's profile: the species' yearly figure
    // over twelve, the full mature-tree rate whatever the tree's age.
    const tree = trees.find((t) => t.$id === v.treeId);
    const sp = speciesByCode.get(tree?.speciesCode);
    const grams = Math.round(num(sp?.co2PerYearGrams, DEFAULT_CO2_PER_YEAR_G) / 12);
    co2TotalGrams += grams;

    const m = typeof v.monthKey === 'string' ? v.monthKey : monthOf(v.verifiedAt);
    if (m && inWindow.has(m)) {
      checkins[m]++;
      co2Grams[m] += grams;
    }
  }

  // --- Members ---------------------------------------------------------------
  for (const p of profiles) {
    const m = monthOf(p.$createdAt);
    if (m && inWindow.has(m)) newMembers[m]++;
  }

  const sortedSpecies = [...bySpecies.values()].sort((a, b) => b.trees - a.trees || a.name.localeCompare(b.name));

  const cityRows = [...byCity.entries()]
    .map(([city, n]) => ({ city, trees: n }))
    .sort((a, b) => b.trees - a.trees || a.city.localeCompare(b.city));
  const TOP_CITIES = 10;
  const cities = cityRows.slice(0, TOP_CITIES);
  const rest = cityRows.slice(TOP_CITIES).reduce((s, c) => s + c.trees, 0);
  if (rest > 0) cities.push({ city: 'Other places', trees: rest });

  return {
    generatedAt: now.toISOString(),
    months: window,
    capped: {
      trees: !!capped.trees,
      verifications: !!capped.verifications,
      profiles: !!capped.profiles,
      footprints: !!capped.footprints,
    },
    totals: {
      members: profiles.length,
      trees: trees.length,
      livingTrees: living,
      acceptedTrees: accepted,
      // Of trees that were accepted, the share still alive. Null with none.
      survivalRate: accepted > 0 ? round(living / accepted, 3) : null,
      approvedCheckins: approvedTotal,
      co2CreditedGrams: co2TotalGrams,
      creditsIssued: profiles.reduce((s, p) => s + num(p.creditsLifetime), 0),
      creditsSpent: profiles.reduce((s, p) => s + num(p.creditsSpent), 0),
    },
    byStatus,
    series: window.map((m) => ({
      month: m,
      treesPlanted: planted[m],
      checkins: checkins[m],
      newMembers: newMembers[m],
      co2CreditedGrams: co2Grams[m],
    })),
    bySpecies: sortedSpecies,
    byCity: cities,
    footprint: footprintSection(footprints, window),
  };
}

/**
 * Footprint averages, or an explanation that there are not enough members.
 *
 * Uses each member's latest month for the headline figures and each month's own
 * contributors for the trend. Every published number needs at least
 * MIN_MEMBERS_FOR_FOOTPRINT members behind it; trend months with fewer are left
 * null rather than dropped, so the gap is visible.
 */
export function footprintSection(footprints, window) {
  const k = MIN_MEMBERS_FOR_FOOTPRINT;

  const latest = new Map();
  for (const f of footprints) {
    if (!f.userId || !f.monthKey) continue;
    const have = latest.get(f.userId);
    if (!have || f.monthKey > have.monthKey) latest.set(f.userId, f);
  }

  if (latest.size < k) {
    return { available: false, minMembers: k };
  }

  const rows = [...latest.values()];
  const kgs = rows.map((f) => num(f.monthKg)).sort((a, b) => a - b);
  const mid = Math.floor(kgs.length / 2);
  const median = kgs.length % 2 ? kgs[mid] : (kgs[mid - 1] + kgs[mid]) / 2;

  const trend = window.map((m) => {
    const inMonth = footprints.filter((f) => f.monthKey === m);
    const people = new Set(inMonth.map((f) => f.userId));
    return {
      month: m,
      avgMonthKg: people.size >= k ? round(mean(inMonth.map((f) => num(f.monthKg))), 1) : null,
    };
  });

  return {
    available: true,
    minMembers: k,
    members: latest.size,
    avgMonthKg: round(mean(kgs), 1),
    medianMonthKg: round(median, 1),
    avgYearKg: round(mean(rows.map((f) => num(f.yearKg))), 0),
    groups: {
      electricity: round(mean(rows.map((f) => num(f.electricityKg))), 1),
      cooking: round(mean(rows.map((f) => num(f.cookingKg))), 1),
      transport: round(mean(rows.map((f) => num(f.transportKg))), 1),
      air: round(mean(rows.map((f) => num(f.airKg))), 1),
    },
    trend,
  };
}

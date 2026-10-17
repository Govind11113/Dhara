/**
 * Emission factors for the carbon footprint calculator.
 *
 * Every number here was read from the primary source named beside it, on
 * 2026-10-18. They live in code rather than in editable config on purpose:
 * these are scientific figures, and a change should be a reviewed edit with a
 * new version, not a value someone types into a form. Each saved footprint
 * records FACTORS_VERSION, so an old result can always be traced to the exact
 * factors that produced it.
 *
 * To update: change the value and its source, bump FACTORS_VERSION, deploy.
 *
 * Scope, stated plainly: direct emissions only. For fuels and vehicles that is
 * what comes out of the tailpipe or the stove; for electricity it is what the
 * power stations emit. Upstream supply chains (extracting and refining fuel,
 * building vehicles) are not included.
 */

export const FACTORS_VERSION = '2026.1';
export const FACTORS_RETRIEVED = '2026-10-18';

const CEA =
  'Central Electricity Authority (India), CO2 Baseline Database for the Indian Power Sector, ' +
  'User Guide v20.0, December 2024, Table S';
const DESNZ =
  'UK Department for Energy Security and Net Zero, Greenhouse gas reporting: conversion factors 2026 (full set)';

/** Standard domestic LPG cylinder in India. */
export const LPG_CYLINDER_KG = 14.2;

/**
 * `value` is in the unit named by `unit`. `region` says where the number comes
 * from, and `confidence` how well it fits an Indian user: 'high' for Indian
 * data, 'medium' for a UK figure whose physics transfers well (fuel burned per
 * km), 'low' where the UK number rests on a very different system.
 */
export const FACTORS = {
  electricity: {
    label: 'Grid electricity',
    unit: 'kg CO2 per kWh',
    value: 0.727,
    region: 'India',
    confidence: 'high',
    source: `${CEA}: all-India weighted average, FY 2023-24 (adjusted for cross-border transfers, including renewables)`,
    note: 'CO2 only, per unit generated. Transmission and distribution losses are not added.',
  },
  lpg: {
    label: 'Cooking gas (LPG)',
    unit: 'kg CO2e per kg',
    value: 2.9394,
    region: 'International',
    confidence: 'high',
    source: `${DESNZ}, sheet "Fuels": LPG, 2,939.4 kg CO2e per tonne`,
    note: `Counted per ${LPG_CYLINDER_KG} kg cylinder, the standard domestic size in India.`,
  },
  car_petrol: {
    label: 'Car (petrol)',
    unit: 'kg CO2e per km',
    value: 0.16152,
    region: 'UK',
    confidence: 'medium',
    source: `${DESNZ}, sheet "Passenger vehicles": average car, petrol`,
    note: 'Per vehicle-km, not divided among passengers. UK fleet average; Indian cars are typically smaller.',
  },
  car_diesel: {
    label: 'Car (diesel)',
    unit: 'kg CO2e per km',
    value: 0.17265,
    region: 'UK',
    confidence: 'medium',
    source: `${DESNZ}, sheet "Passenger vehicles": average car, diesel`,
    note: 'Per vehicle-km, not divided among passengers.',
  },
  motorbike: {
    label: 'Motorbike or scooter',
    unit: 'kg CO2e per km',
    value: 0.11367,
    region: 'UK',
    confidence: 'medium',
    source: `${DESNZ}, sheet "Passenger vehicles": motorbike, average (petrol)`,
    note: 'Per vehicle-km.',
  },
  taxi: {
    label: 'Taxi or cab',
    unit: 'kg CO2e per passenger-km',
    value: 0.14861,
    region: 'UK',
    confidence: 'medium',
    source: `${DESNZ}, sheet "Business travel- land": regular taxi`,
    note: 'Also the closest available figure for app cabs. No separate auto-rickshaw factor could be sourced.',
  },
  bus: {
    label: 'Bus',
    unit: 'kg CO2e per passenger-km',
    value: 0.10151,
    region: 'UK',
    confidence: 'medium',
    source: `${DESNZ}, sheet "Business travel- land": average local bus`,
    note: 'At UK passenger loads. Fuller Indian buses emit less per passenger, so this tends to overstate.',
  },
  rail: {
    label: 'Train or metro',
    unit: 'kg CO2e per passenger-km',
    value: 0.03092,
    region: 'UK',
    confidence: 'low',
    source: `${DESNZ}, sheet "Business travel- land": national rail`,
    note: 'Low confidence. This reflects the UK rail and grid mix, which differ a lot from India. Treat as a rough guide.',
  },
  flight_domestic: {
    label: 'Flight within India',
    unit: 'kg CO2e per passenger-km',
    value: 0.07559,
    region: 'UK',
    confidence: 'medium',
    source: `${DESNZ}, sheet "Business travel- air": short-haul, average passenger, without radiative forcing`,
    note: 'Indian domestic flights are closer in length to short-haul than to UK domestic flights. Excludes radiative forcing (contrails and high-altitude effects), which can raise aviation impact substantially.',
  },
  flight_international: {
    label: 'International flight',
    unit: 'kg CO2e per passenger-km',
    value: 0.0842,
    region: 'International',
    confidence: 'medium',
    source: `${DESNZ}, sheet "Business travel- air": international, to/from non-UK, average passenger, without radiative forcing`,
    note: 'Excludes radiative forcing.',
  },
};

/** For context only. Not like-for-like with a household energy and travel total. */
export const BENCHMARKS = {
  india: {
    label: 'India, average per person',
    kgPerYear: 2201,
    year: 2024,
    source:
      'Global Carbon Budget (2025) via Our World in Data, "CO2 emissions per capita": fossil fuels and industry, all sectors, excluding land use. Retrieved 2026-10-18.',
  },
  world: {
    label: 'World, average per person',
    kgPerYear: 4729,
    year: 2024,
    source:
      'Global Carbon Budget (2025) via Our World in Data, "CO2 emissions per capita": fossil fuels and industry, all sectors, excluding land use. Retrieved 2026-10-18.',
  },
};

export const SCOPE =
  'Home electricity, cooking gas, and travel by road, rail and air. Direct emissions only.';

export const EXCLUSIONS = [
  'Food and diet: no India-specific factors could be sourced to a standard we would stand behind.',
  'Goods, services, clothing and electronics.',
  'Water, waste and appliance refrigerants.',
  'Upstream fuel supply (extraction, refining, vehicle manufacture).',
  'Radiative forcing from flights (contrails and high-altitude effects).',
];

export const CAVEATS = [
  'This is an estimate from the figures you enter, not an audited inventory.',
  'Vehicle, bus, rail and flight factors come from UK government data. Indian fleets and loads differ, so treat those lines as approximate; each carries a confidence tag.',
  'The national averages are totals across all sectors, including industry. Your figure covers home energy and travel only, so the comparison is for scale, not a like-for-like score.',
  'Trees take years to reach the absorption rates shown. Comparing your footprint with your trees is a reality check, not an offset.',
  'Your footprint never affects your credits or rewards.',
];

/** What the app and the admin report show on their "how we calculate" views. */
export function methodology() {
  return {
    version: FACTORS_VERSION,
    retrieved: FACTORS_RETRIEVED,
    scope: SCOPE,
    lpgCylinderKg: LPG_CYLINDER_KG,
    factors: Object.entries(FACTORS).map(([key, f]) => ({ key, ...f })),
    benchmarks: BENCHMARKS,
    exclusions: EXCLUSIONS,
    caveats: CAVEATS,
  };
}

import { FACTORS, FACTORS_VERSION } from '../footprint_factors.js';

/**
 * Carbon for one utility reading, using the footprint calculator's own factors
 * so there is one set of numbers in the system.
 *
 * Only a factor whose unit matches the reading's unit is used. Piped natural
 * gas has none yet: the factors file has no sourced figure per standard cubic
 * metre, and converting SCM needs the supplier's calorific value and the
 * reference conditions behind "standard", neither of which is on file. Until a
 * reviewed factor is added there, gas readings keep their consumption and
 * report the carbon as pending rather than borrowing a factor for another fuel
 * or unit.
 */
const MAPPING = {
  'electricity:kWh': 'electricity',
};

export const PENDING_REASONS = {
  'png:SCM':
    'No verified emission factor for piped natural gas per SCM is on file yet. ' +
    'Consumption is saved; the carbon figure will be added once a sourced factor is reviewed.',
};

export function carbonFor(utilityType, value, unit) {
  const key = `${utilityType}:${unit}`;
  const factorKey = MAPPING[key];
  const factor = factorKey ? FACTORS[factorKey] : null;

  if (!factor) {
    return {
      status: 'pending_factor',
      kg: null,
      factorKey: null,
      factorsVersion: FACTORS_VERSION,
      reason: PENDING_REASONS[key] ?? 'No emission factor is on file for this unit.',
    };
  }

  return {
    status: 'calculated',
    kg: Math.round(Number(value) * factor.value * 1000) / 1000,
    factorKey,
    factorUnit: factor.unit,
    factorValue: factor.value,
    factorsVersion: FACTORS_VERSION,
    source: factor.source,
  };
}

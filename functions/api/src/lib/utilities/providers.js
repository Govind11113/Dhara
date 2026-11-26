/**
 * Utility providers the household-consumption feature knows about.
 *
 * This is the single source of truth. The app reads it through
 * `/utilities/providers` instead of carrying its own list, so adding a state
 * or a biller is an edit here and nowhere else.
 *
 * Nothing in this file claims a provider works. This release has no automatic
 * bill fetching: users upload their bill or type their consumption, and the
 * result is labelled as pending review or unverified. Automatic fetching is
 * developed separately and is not part of this build.
 *
 * Account-number formats: `accountFormatConfirmed: false` means the pattern is
 * deliberately loose. It must be tightened from each utility's own published
 * customer-number rules rather than guessed.
 */

export const UTILITY_TYPES = ['electricity', 'png'];

/** Countries, then states, in the order the app shows them. */
export const REGIONS = [
  {
    country: 'IN',
    countryName: 'India',
    states: [{ code: 'MH', name: 'Maharashtra' }],
  },
];

const LOOSE_ACCOUNT = '^[A-Z0-9-]{6,20}$';

export const PROVIDERS = [
  // --- Electricity ---------------------------------------------------------
  {
    id: 'msedcl',
    utilityType: 'electricity',
    country: 'IN',
    state: 'MH',
    name: 'MSEDCL (Mahavitaran)',
    legalName: 'Maharashtra State Electricity Distribution Company Limited',
    serviceAreas: [],
    accountLabel: 'Consumer number',
    accountHelp: 'The 12-digit consumer number printed near the top of your bill.',
    accountPattern: '^[0-9]{12}$',
    accountFormatConfirmed: false,
    consumptionUnit: 'kWh',
    enabled: true,
  },
  {
    id: 'adani_mumbai',
    utilityType: 'electricity',
    country: 'IN',
    state: 'MH',
    name: 'Adani Electricity Mumbai',
    legalName: 'Adani Electricity Mumbai Limited',
    serviceAreas: ['Mumbai'],
    accountLabel: 'Account number',
    accountHelp: 'The account number printed on your Adani Electricity bill.',
    accountPattern: LOOSE_ACCOUNT,
    accountFormatConfirmed: false,
    consumptionUnit: 'kWh',
    enabled: true,
  },
  {
    id: 'tata_power_mumbai',
    utilityType: 'electricity',
    country: 'IN',
    state: 'MH',
    name: 'Tata Power Mumbai',
    legalName: 'The Tata Power Company Limited (Mumbai distribution)',
    serviceAreas: ['Mumbai'],
    accountLabel: 'CA number',
    accountHelp: 'The consumer account (CA) number printed on your Tata Power bill.',
    accountPattern: LOOSE_ACCOUNT,
    accountFormatConfirmed: false,
    consumptionUnit: 'kWh',
    enabled: true,
  },
  {
    id: 'best_mumbai',
    utilityType: 'electricity',
    country: 'IN',
    state: 'MH',
    name: 'BEST Mumbai',
    legalName: 'Brihanmumbai Electric Supply and Transport Undertaking',
    serviceAreas: ['Mumbai'],
    accountLabel: 'Consumer number',
    accountHelp: 'The consumer number printed on your BEST electricity bill.',
    accountPattern: LOOSE_ACCOUNT,
    accountFormatConfirmed: false,
    consumptionUnit: 'kWh',
    enabled: true,
  },

  // --- Piped natural gas ---------------------------------------------------
  {
    id: 'mgl',
    utilityType: 'png',
    country: 'IN',
    state: 'MH',
    name: 'Mahanagar Gas (MGL)',
    legalName: 'Mahanagar Gas Limited',
    serviceAreas: ['Mumbai', 'Thane', 'Navi Mumbai', 'Raigad'],
    accountLabel: 'BP number',
    accountHelp: 'The business partner (BP) number printed on your MGL gas bill.',
    accountPattern: LOOSE_ACCOUNT,
    accountFormatConfirmed: false,
    consumptionUnit: 'SCM',
    enabled: true,
  },
  {
    id: 'mngl',
    utilityType: 'png',
    country: 'IN',
    state: 'MH',
    name: 'Maharashtra Natural Gas (MNGL)',
    legalName: 'Maharashtra Natural Gas Limited',
    serviceAreas: ['Pune'],
    accountLabel: 'BP number',
    accountHelp: 'The customer or BP number printed on your MNGL gas bill.',
    accountPattern: LOOSE_ACCOUNT,
    accountFormatConfirmed: false,
    consumptionUnit: 'SCM',
    enabled: true,
  },
  {
    // Hidden: household PNG coverage in Maharashtra has not been confirmed.
    // Listing it would show users a supplier that may not serve them.
    id: 'adani_total_gas_mh',
    utilityType: 'png',
    country: 'IN',
    state: 'MH',
    name: 'Adani Total Gas',
    legalName: 'Adani Total Gas Limited',
    serviceAreas: [],
    accountLabel: 'Customer ID',
    accountHelp: 'The customer ID printed on your gas bill.',
    accountPattern: LOOSE_ACCOUNT,
    accountFormatConfirmed: false,
    consumptionUnit: 'SCM',
    enabled: false,
    disabledReason: 'Maharashtra household coverage not confirmed.',
  },
];

export function findProvider(id) {
  return PROVIDERS.find((p) => p.id === id) ?? null;
}

/** The account identifier as the server compares it. */
export function normalizeAccount(raw) {
  return String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

export function accountValid(provider, raw) {
  const value = normalizeAccount(raw);
  return value.length > 0 && new RegExp(provider.accountPattern).test(value);
}

/**
 * What the app is allowed to see. Internal fields (legal name, whether the
 * account format is confirmed) stay on the server.
 */
export function publicProvider(provider) {
  return {
    id: provider.id,
    utilityType: provider.utilityType,
    country: provider.country,
    state: provider.state,
    name: provider.name,
    serviceAreas: provider.serviceAreas,
    accountLabel: provider.accountLabel,
    accountHelp: provider.accountHelp,
    accountPattern: provider.accountPattern,
    consumptionUnit: provider.consumptionUnit,
  };
}

export function listProviders({ utilityType, country = 'IN', state } = {}) {
  return PROVIDERS.filter(
    (p) =>
      p.enabled &&
      p.country === country &&
      (!state || p.state === state) &&
      (!utilityType || p.utilityType === utilityType),
  ).map(publicProvider);
}

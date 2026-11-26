# Household electricity and gas consumption

Status: **manual entry and bill upload only; not production-ready.** This build
has no automatic bill fetching from any provider. Users upload their bill or
type their consumption, and those readings are never marked verified.

**Still pending:**

- **Backend deployment.** The `/utilities/*` routes, the `UTILITY_ID_PEPPER`
  function variable and the new collections (`utility_verifications`,
  `utility_readings`, `footprints.inputSources`) are not deployed or
  provisioned. Until they are, the live app can list providers (from its
  bundled copy) but saving a bill, history and footprint auto-fill fail with
  "Dhara's server has not been updated for this feature yet".
- **Real-device testing.** The feature has passed automated tests only. It has
  not been tested on an Android phone.

This feature is separate from `/electricity/submit` (bill-credit redemption),
which is unchanged. Nothing here awards Green Credits.

## How it works

1. The app asks the server for providers (`/utilities/providers`). If the
   server cannot be reached, it uses the copy bundled in
   `assets/config/utility_providers.json`, which a backend test keeps identical
   to the server registry.
2. The user picks a provider, enters the account number, then uploads a bill
   (camera, gallery image or PDF) or types the figures.
3. Bill uploads are saved as **document_review** ("Extracted from uploaded
   bill — verification pending"). Typed figures are saved as **unverified**
   ("User-entered — not independently verified").
4. An electricity reading can fill the footprint calculator's kWh field. The
   footprint row records the source. One reading can count in one month only.

## Supported providers (Maharashtra)

All IDs and fields live in `functions/api/src/lib/utilities/providers.js`.

| Provider | Type | Listed | Unit |
|---|---|---|---|
| MSEDCL (Mahavitaran) | Electricity | Yes | kWh |
| Adani Electricity Mumbai | Electricity | Yes | kWh |
| Tata Power Mumbai | Electricity | Yes | kWh |
| BEST Mumbai | Electricity | Yes | kWh |
| Mahanagar Gas (MGL) | PNG | Yes | SCM |
| Maharashtra Natural Gas (MNGL) | PNG | Yes | SCM |
| Adani Total Gas | PNG | **Hidden** (coverage unconfirmed) | SCM |

Account formats: only MSEDCL uses a strict pattern (12 digits). The rest use a
loose `^[A-Z0-9-]{6,20}$` until each utility's published format is confirmed.

LPG is not part of this feature. It stays as cylinders in the calculator.

## Automatic bill fetching

Not included. It is developed on the `feature/utility-bill-verification`
branch and needs bill-fetch network credentials before it can work. The
schema's `method` and `status` enums keep the values that feature will use
(`bill_fetch`, `fetching`, `verified` and the provider statuses), so adding it
later needs no schema change. Nothing in this build produces them.

## Environment variables (server only)

| Variable | Purpose |
|---|---|
| `UTILITY_ID_PEPPER` | Key for the account-number hash (16+ characters, random). Required; without it the routes refuse to store anything. Never change it after launch, or duplicate detection resets. Not set by `scripts/deploy.mjs`; add it as a variable on the `api` function. |

Config: `utility.requests_per_hour` (default 10) in `app_config`.

## Database changes (additive)

Defined in `scripts/schema.mjs`; created by `scripts/provision.mjs` (idempotent,
skips what exists). **Not run against production.**

- New collection `utility_verifications`: one row per attempt. Consent (purpose,
  version, timestamp), status, masked account, keyed account hash, request ID.
- New collection `utility_readings`: one row per connection per billing period.
  Unique `dedupeKey` = user + provider + account hash + period.
- `footprints`: new optional attribute `inputSources` (JSON).
- `app_config` seed: `utility.requests_per_hour`.

Privacy: the full account number is not stored anywhere, only the last four
characters and a keyed hash. Records are readable only by their owner.
`/utilities/delete` removes all of a member's utility records.

## API (all POST, authenticated)

| Route | Purpose |
|---|---|
| `/utilities/providers` | Regions, providers, consent version |
| `/utilities/bills/extract` | Suggestions from OCR text, saves nothing |
| `/utilities/bills/upload` | Save a bill upload or manual entry |
| `/utilities/verification` | One of the caller's verifications |
| `/utilities/consumption/history` | The caller's readings |
| `/utilities/delete` | Delete all the caller's utility records |
| `/footprint/save` | Accepts optional `sources: {electricityKwh: readingId}` |

Statuses produced by this build: pending, document_review, unverified,
duplicate.

## Carbon methodology

Electricity readings use the calculator's own factor (`FACTORS.electricity`,
CEA, version `FACTORS_VERSION`), so there is one factor in the system.

**Piped gas carbon is pending.** No PNG factor per SCM is on file. A valid one
needs a documented source, the supplier's calorific value and the reference
conditions that define "standard" for the SCM on Indian bills. Until a reviewed
factor is added to `footprint_factors.js` (with a version bump), gas readings
store consumption with `carbonStatus: pending_factor`.

## Testing

- Backend: `cd functions/api && npm test` (utility tests in
  `src/routes/utilities.test.js`).
- App: `flutter test` (`test/utility_verification_test.dart`, mock service).
- No real account data is used in tests.

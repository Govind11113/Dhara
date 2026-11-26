import { ID, Permission, Query, Role } from 'node-appwrite';
import { BUCKET, COL, DB, Rejected, nowIso, num, str } from '../lib/context.js';
import {
  REGIONS,
  accountValid,
  findProvider,
  listProviders,
  normalizeAccount,
} from '../lib/utilities/providers.js';
import { carbonFor } from '../lib/utilities/carbon.js';
import { agreesWithDocument, extractFromText } from '../lib/utilities/extract.js';
import {
  CONSENT_PURPOSE,
  CONSENT_VERSION,
  METHOD,
  STATUS,
  accountHash,
  dedupeKey,
  maskAccount,
  validConsumption,
  validPeriod,
  validRequestId,
} from '../lib/utilities/records.js';

/**
 * Household electricity and piped-gas consumption from bills the user uploads
 * or types in, labelled honestly: an uploaded bill is pending review and typed
 * numbers are unverified. This build has no automatic bill fetching.
 *
 * Separate from `/electricity/submit` (bill-credit redemption), which is left
 * untouched. Nothing here moves credits: uploading a bill earns nothing, so
 * there is no reason to fake one.
 */

export function makeUtilityRoutes() {
  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async function providers({ body }) {
    const utilityType = body?.utilityType ? str(body.utilityType, 16) : undefined;
    return {
      regions: REGIONS,
      providers: listProviders({ utilityType, country: 'IN' }),
      consent: { version: CONSENT_VERSION, purpose: CONSENT_PURPOSE },
    };
  }

  async function verificationGet({ databases, user, body }) {
    const id = str(body?.id, 64);
    if (!id) throw new Rejected('bad_request', 'Which verification?');
    let doc;
    try {
      doc = await databases.getDocument(DB, COL.utilityVerifications, id);
    } catch (e) {
      if (e.code === 404) throw new Rejected('not_found', 'That verification was not found.');
      throw e;
    }
    // Someone else's record answers exactly like a missing one.
    if (doc.userId !== user.$id) throw new Rejected('not_found', 'That verification was not found.');
    const reading = doc.readingId ? await readingById(databases, doc.readingId, user.$id) : null;
    return { verification: verificationView(doc, reading) };
  }

  async function history({ databases, user, body }) {
    const queries = [Query.equal('userId', user.$id), Query.orderDesc('periodEnd'), Query.limit(48)];
    const utilityType = body?.utilityType ? str(body.utilityType, 16) : '';
    if (utilityType) queries.push(Query.equal('utilityType', utilityType));
    const res = await databases.listDocuments(DB, COL.utilityReadings, queries);
    return { readings: res.documents.map(readingView) };
  }

  // ---------------------------------------------------------------------------
  // Document upload and manual entry
  // ---------------------------------------------------------------------------

  async function upload({ databases, storage, user, body, config }) {
    const utilityType = str(body?.utilityType, 16);
    if (!['electricity', 'png'].includes(utilityType)) {
      throw new Rejected('bad_request', 'Choose electricity or gas.');
    }
    const { provider, account, requestId } = commonInput(utilityType, body);
    requireConsent(body);

    const replay = await byRequestId(databases, user.$id, requestId);
    if (replay) return { verification: verificationView(replay, await readingOf(databases, replay, user.$id)) };

    await rateLimit(databases, user.$id, config);
    const hash = hashOrUnavailable(provider.id, account);

    const billFileId = str(body?.billFileId, 64);
    if (billFileId) await requireOwnFile(storage, billFileId, user.$id);
    const method = billFileId ? METHOD.document : METHOD.manual;

    const values = body?.values ?? {};
    const unit = str(values.consumptionUnit, 8);
    const value = num(values.consumptionValue, NaN);
    if (!validConsumption(utilityType, value, unit)) {
      throw new Rejected(
        'invalid_consumption',
        utilityType === 'png'
          ? 'Enter the gas consumption in SCM as printed on your bill.'
          : 'Enter the electricity consumption in kWh (units) as printed on your bill.',
      );
    }
    const period = validPeriod(values.periodStart, values.periodEnd);
    if (!period) {
      throw new Rejected('invalid_period', 'Enter the billing period dates shown on your bill.');
    }

    const extracted = extractFromText(utilityType, body?.ocrText);
    const matched = billFileId ? agreesWithDocument(extracted, { consumptionValue: value }) : false;

    const verification = await databases.createDocument(
      DB,
      COL.utilityVerifications,
      ID.unique(),
      {
        userId: user.$id,
        requestId,
        utilityType,
        country: provider.country,
        state: provider.state,
        providerId: provider.id,
        accountMasked: maskAccount(account),
        accountHash: hash,
        method,
        status: STATUS.pending,
        statusReason: '',
        billFileId,
        consentPurpose: CONSENT_PURPOSE,
        consentVersion: CONSENT_VERSION,
        consentAt: nowIso(),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      },
      [Permission.read(Role.user(user.$id))],
    );

    // A document is held for review; typed numbers are unverified. Neither is
    // ever recorded as verified from here.
    const target = method === METHOD.document ? STATUS.documentReview : STATUS.unverified;
    const saved = await insertReading(databases, user.$id, {
      provider,
      utilityType,
      account,
      hash,
      verificationId: verification.$id,
      method,
      status: target,
      period,
      value,
      unit,
      previousReading: finiteOrNull(values.previousReading),
      currentReading: finiteOrNull(values.currentReading),
      bill: {
        amountPaise: Number.isFinite(num(values.billAmount, NaN)) ? Math.round(num(values.billAmount) * 100) : null,
        billNumber: str(values.billReferenceId, 64) || null,
      },
      billFileId,
    });

    const status = saved.duplicate ? STATUS.duplicate : target;
    const updated = await databases.updateDocument(DB, COL.utilityVerifications, verification.$id, {
      status,
      statusReason: saved.duplicate ? 'period_already_imported' : matched ? 'ocr_matches_entry' : '',
      readingId: saved.reading?.$id ?? '',
      updatedAt: nowIso(),
    });
    return { verification: verificationView(updated, saved.reading), extracted };
  }

  /** Suggestions from OCR text, without saving anything. */
  async function extract({ body }) {
    const utilityType = str(body?.utilityType, 16);
    if (!['electricity', 'png'].includes(utilityType)) {
      throw new Rejected('bad_request', 'Choose electricity or gas.');
    }
    return { extracted: extractFromText(utilityType, body?.ocrText) };
  }

  /** Deletes every utility record the caller owns. */
  async function deleteMine({ databases, user }) {
    let removed = 0;
    for (const col of [COL.utilityReadings, COL.utilityVerifications]) {
      for (let page = 0; page < 20; page++) {
        const res = await databases.listDocuments(DB, col, [Query.equal('userId', user.$id), Query.limit(100)]);
        if (!res.documents.length) break;
        for (const d of res.documents) {
          await databases.deleteDocument(DB, col, d.$id);
          removed++;
        }
      }
    }
    return { removed };
  }

  return {
    '/utilities/providers': providers,
    '/utilities/bills/upload': upload,
    '/utilities/bills/extract': extract,
    '/utilities/verification': verificationGet,
    '/utilities/consumption/history': history,
    '/utilities/delete': deleteMine,
  };
}

export const UTILITY_ROUTES = makeUtilityRoutes();

// -----------------------------------------------------------------------------
// Shared
// -----------------------------------------------------------------------------

function commonInput(utilityType, body) {
  const provider = findProvider(str(body?.providerId, 48));
  if (!provider || !provider.enabled || provider.utilityType !== utilityType) {
    throw new Rejected('unsupported_provider', 'That provider is not available in your region yet.');
  }
  const account = normalizeAccount(str(body?.account, 40));
  if (!accountValid(provider, account)) {
    throw new Rejected('invalid_account', `That does not look like a valid ${provider.accountLabel.toLowerCase()}. ${provider.accountHelp}`);
  }
  const requestId = validRequestId(body?.requestId);
  if (!requestId) throw new Rejected('bad_request', 'Missing request ID. Update the app and try again.');
  return { provider, account, requestId };
}

function requireConsent(body) {
  if (body?.consent !== true || body?.consentVersion !== CONSENT_VERSION) {
    throw new Rejected(
      'consent_required',
      'Please read and accept how Dhara uses your utility account before continuing.',
    );
  }
}

function hashOrUnavailable(providerId, account) {
  try {
    return accountHash(providerId, account);
  } catch {
    // Missing server secret. Refuse rather than store an unkeyed hash.
    throw new Rejected('service_unavailable', 'Utility verification is not available yet. Please try again later.');
  }
}

async function rateLimit(databases, userId, config) {
  const limit = num(config?.['utility.requests_per_hour'], 10);
  const since = new Date(Date.now() - 3600_000).toISOString();
  const res = await databases.listDocuments(DB, COL.utilityVerifications, [
    Query.equal('userId', userId),
    Query.greaterThan('createdAt', since),
    Query.limit(1),
  ]);
  if ((res.total ?? 0) >= limit) {
    throw new Rejected('rate_limited', 'Too many verification attempts. Please try again in an hour.');
  }
}

async function byRequestId(databases, userId, requestId) {
  const res = await databases.listDocuments(DB, COL.utilityVerifications, [
    Query.equal('userId', userId),
    Query.equal('requestId', requestId),
    Query.limit(1),
  ]);
  return res.documents[0] ?? null;
}

async function requireOwnFile(storage, fileId, userId) {
  let file;
  try {
    file = await storage.getFile(BUCKET.billDocs, fileId);
  } catch (e) {
    if (e.code === 404) throw new Rejected('bill_not_found', 'That bill upload was not found. Upload it again.');
    throw e;
  }
  const perms = Array.isArray(file.$permissions) ? file.$permissions : [];
  if (!perms.includes(`read("user:${userId}")`)) {
    throw new Rejected('bill_not_found', 'That bill upload was not found. Upload it again.');
  }
}

async function insertReading(databases, userId, r) {
  const key = dedupeKey({ userId, providerId: r.provider.id, accountHash: r.hash, period: r.period });
  const existing = await databases.listDocuments(DB, COL.utilityReadings, [
    Query.equal('dedupeKey', key),
    Query.limit(1),
  ]);
  if (existing.documents[0]) return { reading: existing.documents[0], duplicate: true };

  const carbon = carbonFor(r.utilityType, r.value, r.unit);
  const data = {
    userId,
    verificationId: r.verificationId,
    utilityType: r.utilityType,
    country: r.provider.country,
    state: r.provider.state,
    providerId: r.provider.id,
    providerName: r.provider.name,
    accountMasked: maskAccount(r.account),
    accountHash: r.hash,
    method: r.method,
    status: r.status,
    periodStart: r.period.start,
    periodEnd: r.period.end,
    consumptionValue: r.value,
    consumptionUnit: r.unit,
    previousReading: r.previousReading ?? null,
    currentReading: r.currentReading ?? null,
    billAmountPaise: r.bill?.amountPaise ?? null,
    currency: 'INR',
    billReferenceId: r.bill?.billNumber ? String(r.bill.billNumber).slice(0, 64) : '',
    providerReferenceId: r.providerRef ? String(r.providerRef).slice(0, 64) : '',
    billFileId: r.billFileId ?? '',
    carbonKg: carbon.kg,
    carbonStatus: carbon.status,
    factorKey: carbon.factorKey ?? '',
    factorsVersion: carbon.factorsVersion,
    appliedMonthKey: '',
    dedupeKey: key,
    fetchedAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  try {
    const doc = await databases.createDocument(DB, COL.utilityReadings, ID.unique(), data, [
      Permission.read(Role.user(userId)),
    ]);
    return { reading: doc, duplicate: false };
  } catch (e) {
    // Two imports of the same bill raced; the unique index kept one.
    if (e.code === 409) {
      const winner = await databases.listDocuments(DB, COL.utilityReadings, [
        Query.equal('dedupeKey', key),
        Query.limit(1),
      ]);
      if (winner.documents[0]) return { reading: winner.documents[0], duplicate: true };
    }
    throw e;
  }
}

async function readingById(databases, id, userId) {
  try {
    const doc = await databases.getDocument(DB, COL.utilityReadings, id);
    return doc.userId === userId ? doc : null;
  } catch {
    return null;
  }
}

function readingOf(databases, verification, userId) {
  return verification.readingId ? readingById(databases, verification.readingId, userId) : null;
}

function finiteOrNull(v) {
  const n = num(v, NaN);
  return Number.isFinite(n) ? n : null;
}

// -----------------------------------------------------------------------------
// What the app sees
// -----------------------------------------------------------------------------

export function readingView(doc) {
  return {
    id: doc.$id,
    utilityType: doc.utilityType,
    providerId: doc.providerId,
    providerName: doc.providerName,
    accountMasked: doc.accountMasked,
    method: doc.method,
    status: doc.status,
    periodStart: doc.periodStart,
    periodEnd: doc.periodEnd,
    consumptionValue: doc.consumptionValue,
    consumptionUnit: doc.consumptionUnit,
    previousReading: doc.previousReading ?? null,
    currentReading: doc.currentReading ?? null,
    billAmount: Number.isInteger(doc.billAmountPaise) ? doc.billAmountPaise / 100 : null,
    currency: doc.currency || 'INR',
    billReferenceId: doc.billReferenceId || null,
    carbonKg: doc.carbonKg ?? null,
    carbonStatus: doc.carbonStatus,
    factorsVersion: doc.factorsVersion,
    appliedMonthKey: doc.appliedMonthKey || null,
    fetchedAt: doc.fetchedAt ?? null,
    createdAt: doc.createdAt,
  };
}

export function verificationView(doc, reading = null) {
  const provider = findProvider(doc.providerId);
  return {
    id: doc.$id,
    utilityType: doc.utilityType,
    providerId: doc.providerId,
    providerName: provider?.name ?? doc.providerId,
    accountMasked: doc.accountMasked,
    method: doc.method,
    status: doc.status,
    reason: doc.statusReason || null,
    message: null,
    createdAt: doc.createdAt,
    reading: reading ? readingView(reading) : null,
  };
}

import { ID, Permission, Query, Role } from 'node-appwrite';
import { COL, DB, Rejected, nowIso, str } from '../lib/context.js';
import {
  computeFootprint,
  hasActivity,
  monthKeyOf,
  normalizeInputs,
  validMonthKey,
} from '../lib/footprint.js';
import { methodology } from '../lib/footprint_factors.js';

/**
 * Carbon footprint routes.
 *
 * A footprint is personal data, so it is written only here, readable only by
 * its owner, and shown to admins as totals across many members (see
 * admin_read.js) and never row by row. It has no connection to credits: a
 * self-reported figure cannot be verified, so it must never earn anything.
 */

function parse(body) {
  const inputs = normalizeInputs(body?.inputs);
  if (!hasActivity(inputs)) {
    throw new Rejected(
      'nothing_entered',
      'Enter at least one thing — electricity, cooking gas or a trip — to work out a footprint.',
    );
  }
  return inputs;
}

/** Works out a footprint without saving anything. */
export async function estimate({ body }) {
  const inputs = parse(body);
  return { footprint: computeFootprint(inputs), inputs };
}

/** The sources, factors and limits behind every number. */
export async function methodologyRoute() {
  return methodology();
}

/** Compact columns, so the history chart needs no maths of its own. */
export function rowFor(userId, monthKey, inputs, footprint, now = nowIso()) {
  return {
    userId,
    monthKey,
    householdSize: Math.round(inputs.householdSize),
    inputs: JSON.stringify(inputs).slice(0, 2000),
    monthKg: footprint.monthKg,
    yearKg: footprint.yearKg,
    electricityKg: footprint.groups.electricity,
    cookingKg: footprint.groups.cooking,
    transportKg: footprint.groups.transport,
    airKg: footprint.groups.air,
    factorsVersion: footprint.factorsVersion,
    updatedAt: now,
  };
}

/**
 * Works out and saves a footprint for a month. One row per member per month:
 * saving again replaces it.
 */
export async function save({ databases, user, body }) {
  const monthKey = str(body?.monthKey, 7) || monthKeyOf(new Date());
  if (!validMonthKey(monthKey)) {
    throw new Rejected('invalid_month', 'Pick this month or one from the last two years.');
  }

  const inputs = parse(body);
  const footprint = computeFootprint(inputs);
  const sources = await resolveSources(databases, user.$id, monthKey, inputs, body?.sources);
  const row = { ...rowFor(user.$id, monthKey, inputs, footprint), inputSources: JSON.stringify(sources.labels) };

  const existing = await findExisting(databases, user.$id, monthKey);
  if (existing) {
    const doc = await databases.updateDocument(DB, COL.footprints, existing.$id, row);
    await sources.commit();
    await releaseReplaced(databases, user.$id, existing, sources.labels);
    return { footprint, sources: sources.labels, saved: { id: doc.$id, monthKey, replaced: true } };
  }

  try {
    const doc = await databases.createDocument(
      DB,
      COL.footprints,
      ID.unique(),
      { ...row, createdAt: row.updatedAt },
      [Permission.read(Role.user(user.$id))],
    );
    await sources.commit();
    return { footprint, sources: sources.labels, saved: { id: doc.$id, monthKey, replaced: false } };
  } catch (e) {
    // Two saves for the same month raced and the unique index let one win. The
    // loser becomes an update of the winner's row.
    if (e.code === 409) {
      const winner = await findExisting(databases, user.$id, monthKey);
      if (winner) {
        const doc = await databases.updateDocument(DB, COL.footprints, winner.$id, row);
        await sources.commit();
        await releaseReplaced(databases, user.$id, winner, sources.labels);
        return { footprint, sources: sources.labels, saved: { id: doc.$id, monthKey, replaced: true } };
      }
    }
    throw e;
  }
}

/**
 * When a month is re-saved without the bill it used to count, or deleted, that
 * bill is free again for the month it belongs to. Best effort: a reading that
 * no longer exists needs nothing released.
 */
async function releaseReplaced(databases, userId, previousRow, newLabels = {}) {
  let old = null;
  try {
    old = JSON.parse(previousRow?.inputSources || '{}')?.electricityKwh?.readingId ?? null;
  } catch {
    old = null;
  }
  if (!old || old === newLabels?.electricityKwh?.readingId) return;
  try {
    const reading = await databases.getDocument(DB, COL.utilityReadings, old);
    if (reading.userId === userId && reading.appliedMonthKey === previousRow.monthKey) {
      await databases.updateDocument(DB, COL.utilityReadings, old, { appliedMonthKey: '', updatedAt: nowIso() });
    }
  } catch {
    // Gone already.
  }
}

/**
 * Where the electricity figure came from.
 *
 * A figure counts as imported only when it is exactly the consumption of one
 * of the caller's own readings. Edited after import, it is what the user typed.
 * A reading can be counted in one month only; offering it to a second month is
 * refused, which is what stops one bill being added to the footprint twice.
 */
async function resolveSources(databases, userId, monthKey, inputs, requested) {
  const labels = {};
  let commit = async () => {};
  if (inputs.electricityKwh > 0) labels.electricityKwh = { source: 'user_entered' };

  const readingId = str(requested?.electricityKwh, 64);
  if (!readingId || !(inputs.electricityKwh > 0)) return { labels, commit };

  let reading = null;
  try {
    reading = await databases.getDocument(DB, COL.utilityReadings, readingId);
  } catch (e) {
    if (e.code !== 404) throw e;
  }
  if (!reading || reading.userId !== userId) {
    throw new Rejected('reading_not_found', 'That imported bill was not found. Import it again.');
  }
  if (reading.utilityType !== 'electricity' || reading.consumptionUnit !== 'kWh') {
    throw new Rejected('reading_mismatch', 'That bill is not an electricity bill in kWh.');
  }
  if (reading.appliedMonthKey && reading.appliedMonthKey !== monthKey) {
    throw new Rejected(
      'reading_already_used',
      `That bill is already counted in your footprint for ${reading.appliedMonthKey}.`,
    );
  }
  if (Math.abs(Number(reading.consumptionValue) - inputs.electricityKwh) > 0.001) {
    return { labels, commit };
  }

  labels.electricityKwh = {
    source: reading.status,
    readingId: reading.$id,
    periodStart: reading.periodStart,
    periodEnd: reading.periodEnd,
  };
  commit = async () => {
    if (reading.appliedMonthKey === monthKey) return;
    await databases.updateDocument(DB, COL.utilityReadings, reading.$id, {
      appliedMonthKey: monthKey,
      updatedAt: nowIso(),
    });
  };
  return { labels, commit };
}

async function findExisting(databases, userId, monthKey) {
  const res = await databases.listDocuments(DB, COL.footprints, [
    Query.equal('userId', userId),
    Query.equal('monthKey', monthKey),
    Query.limit(1),
  ]);
  return res.documents[0] ?? null;
}

/** Deletes one of the caller's own months. */
export async function remove({ databases, user, body }) {
  const monthKey = str(body?.monthKey, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) {
    throw new Rejected('invalid_month', 'Which month should be removed?');
  }
  const existing = await findExisting(databases, user.$id, monthKey);
  if (!existing) throw new Rejected('not_found', 'You have no footprint saved for that month.');

  await databases.deleteDocument(DB, COL.footprints, existing.$id);
  await releaseReplaced(databases, user.$id, existing);
  return { monthKey, removed: true };
}

import { ID, Query, Permission, Role } from 'node-appwrite';
import {
  BUCKET,
  COL,
  DB,
  Rejected,
  clamp,
  distanceM,
  geohash,
  monthKey,
  nowIso,
  num,
  str,
} from '../lib/context.js';
import { award, bumpStats, checkAndStorePhash, flag, notify } from '../lib/ledger.js';
import { decide, inspectPhoto, onUnavailable, summarise } from '../lib/vision.js';
import { recordInspection } from '../lib/inspections.js';

const MARKER_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function markerCode() {
  let out = 'DT-';
  for (let i = 0; i < 8; i++) {
    out += MARKER_ALPHABET[Math.floor(Math.random() * MARKER_ALPHABET.length)];
  }
  return out;
}

/**
 * The rest of the GPS reading, made safe to write.
 *
 * Values are clamped into the ranges the schema declares rather than validated
 * and rejected. A device that reports a nonsense altitude or a negative speed
 * (geolocator uses -1 for "unknown" on some platforms) should not cost a user a
 * legitimately planted tree — but a float outside an attribute's min/max fails
 * the whole document write, so it cannot be passed through untouched either.
 */
function gpsDetail(body) {
  const detail = {
    altitudeM: clamp(num(body.altitudeM, 0), -1000, 10000),
    altitudeAccuracyM: clamp(num(body.altitudeAccuracyM, 0), 0, 10000),
    headingDeg: clamp(num(body.headingDeg, 0), 0, 360),
    speedMps: clamp(num(body.speedMps, 0), 0, 1000),
  };

  // The device's own clock, so a claim rather than a fact. Deliberately stored
  // as given and never reconciled against server time: the two disagreeing is
  // itself worth having, and overwriting it with `now` would erase the only
  // evidence of a tampered clock. Dropped entirely if it is not a real date,
  // because an unwritable value would fail the plant.
  const capturedAt = new Date(str(body.fixCapturedAt));
  const ms = capturedAt.getTime();
  const plausible =
    Number.isFinite(ms) &&
    ms > Date.UTC(2000, 0, 1) &&
    ms < Date.UTC(2100, 0, 1);
  if (plausible) detail.fixCapturedAt = capturedAt.toISOString();

  return detail;
}

/**
 * Shared gate for both planting and monthly verification.
 *
 * Every one of these checks runs server-side. The client performs the same
 * checks first purely so it can show a helpful message before uploading.
 */
async function screenSubmission({
  databases,
  storage,
  user,
  config,
  lat,
  lng,
  accuracyM,
  mocked,
  plantConfidence,
  phash,
  refType,
  refId,
  photoFileId,
  declaredSpecies = '',
  isVerify = false,
  log = () => {},
}) {
  const reasons = [];
  const maxAccuracy = num(config['tree.max_gps_accuracy_m'], 20);
  const minConfidence = num(config['tree.plant_confidence_min'], 0.55);
  const phashThreshold = num(config['fraud.phash_hamming_threshold'], 8);

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
    throw new Rejected('no_location', 'We could not read your location. Try again outdoors.');
  }

  // A mocked fix is disqualifying on its own: it means a spoofing app is
  // active, so no other signal from this device can be trusted.
  if (mocked) {
    await flag(databases, {
      userId: user.$id,
      kind: 'mock_location',
      severity: 'critical',
      detail: 'Mock location provider active',
      refType,
      refId,
      trustScoreDelta: -25,
    });
    throw new Rejected(
      'mock_location',
      'Your device is reporting a fake location. Turn off any GPS spoofing app and try again.',
    );
  }

  if (accuracyM > maxAccuracy) {
    throw new Rejected('poor_gps_accuracy', `Waiting for a better GPS signal (need ${maxAccuracy} m or better, currently ${Math.round(accuracyM)} m). Step into the open.`);
  }

  // Perceptual hash: catches re-uploads and internet photos. Runs before the
  // model because it is a local database lookup — no point paying for an
  // inference on a photo that is already disqualified.
  const dup = await checkAndStorePhash(databases, {
    phash,
    userId: user.$id,
    refType,
    refId,
    fileId: photoFileId,
    threshold: phashThreshold,
  });

  if (dup.duplicate) {
    await flag(databases, {
      userId: user.$id,
      kind: 'duplicate_photo',
      severity: dup.sameUser ? 'high' : 'critical',
      detail: `hamming ${dup.nearest} vs ${dup.matchRef}`,
      refType,
      refId,
      trustScoreDelta: dup.sameUser ? -15 : -30,
    });
    throw new Rejected(
      'duplicate_photo',
      'That photo has already been used. Take a fresh one of the tree as it looks today.',
      { nearest: dup.nearest },
    );
  }

  // Ask the server-side model what is actually in the photo. This is the
  // authority: the client's own plantConfidence arrives from code the user
  // controls, so it cannot be the thing that decides whether credits are paid.
  //
  // When the model has no opinion (no key, outage, daily free-tier cap,
  // timeout) `vision.on_unavailable` decides: `approve` rides on the GPS +
  // pHash + ML Kit checks above, `review` holds the submission for a person.
  // Turning the check off in config is a deliberate choice and adds no reason.
  const { verdict, meta } = await inspectPhoto({
    storage,
    bucketId: BUCKET.treePhotos,
    fileId: photoFileId,
    declaredSpecies,
    isVerify,
    config,
    log,
  });

  const ai =
    meta.status === 'ok'
      ? decide(verdict, config)
      : meta.status === 'skipped'
        ? { action: 'approve', reasons: [], confidence: 0 }
        : onUnavailable(config);

  // Logged before any rejection is thrown, so refused photos are recorded too.
  // A skipped check (turned off in config) made no call and is not logged.
  if (meta.status !== 'skipped') {
    await recordInspection(
      databases,
      { userId: user.$id, refType, refId, fileId: photoFileId, meta, verdict, ai },
      log,
    );
  }

  if (ai.action === 'reject') {
    const screenPhoto = ai.reasons.includes('ai_screen_photo');
    await flag(databases, {
      userId: user.$id,
      // Reusing the existing enum values deliberately: Appwrite cannot widen an
      // enum attribute in place, so a new `kind` here would fail to write on
      // any project provisioned before this change.
      kind: screenPhoto ? 'manual_report' : 'not_a_plant',
      severity: 'high',
      detail: `ai rejected: ${summarise(verdict)}`,
      refType,
      refId,
      trustScoreDelta: -20,
    });
    throw new Rejected(
      screenPhoto ? 'ai_screen_photo' : 'ai_not_a_plant',
      screenPhoto
        ? 'That looks like a photo of a screen rather than a real tree. Take a fresh photo of the plant itself.'
        : 'We could not find a real plant in that photo. Get the whole sapling in frame with the ground visible.',
      { confidence: ai.confidence },
    );
  }

  reasons.push(...ai.reasons);

  // ML Kit label check: is there a plant in frame at all? Only a review signal
  // now — the server's own verdict above is what carries weight.
  if (plantConfidence > 0 && plantConfidence < minConfidence) {
    await flag(databases, {
      userId: user.$id,
      kind: 'not_a_plant',
      severity: 'medium',
      detail: `client confidence ${plantConfidence.toFixed(2)}`,
      refType,
      refId,
    });
    if (!verdict) reasons.push('We could not clearly see a plant in that photo.');
  }

  return {
    reasons,
    phashNearest: dup.nearest,
    aiVerdict: summarise(verdict),
    aiConfidence: ai.confidence,
    aiModel: meta.status === 'ok' ? meta.model : '',
  };
}

export async function plant({ databases, storage, user, body, config, log }) {
  const lat = num(body.lat, NaN);
  const lng = num(body.lng, NaN);
  const accuracyM = num(body.accuracyM, 999);
  const mocked = body.mocked === true;
  const photoFileId = str(body.photoFileId, 64);
  const phash = str(body.phash, 32);
  const speciesCode = str(body.speciesCode, 48) || 'other';
  const plantConfidence = clamp(num(body.plantConfidence, 0), 0, 1);

  if (!photoFileId) {
    throw new Rejected('missing_photo', 'A photo of the planted sapling is required.');
  }

  const profile = await databases.getDocument(DB, COL.profiles, user.$id);
  if (profile.isBanned) {
    throw new Rejected('account_suspended', 'This account is suspended.');
  }

  const screen = await screenSubmission({
    databases,
    storage,
    user,
    config,
    lat,
    lng,
    accuracyM,
    mocked,
    plantConfidence,
    phash,
    refType: 'tree_plant',
    // Every upload gets a distinct fileId, which keeps all earlier plant photos
    // inside the duplicate comparison while still letting a retry of this exact
    // upload through. A constant here would disable duplicate detection.
    refId: photoFileId,
    photoFileId,
    declaredSpecies: speciesCode,
    isVerify: false,
    log,
  });

  // Two trees cannot occupy the same spot. Geohash prefix keeps this a bounded
  // query: precision 7 is roughly a 150 m cell.
  const minSpacing = num(config['tree.min_spacing_m'], 3);
  const cell = geohash(lat, lng, 7);
  const nearby = await databases.listDocuments(DB, COL.trees, [
    Query.startsWith('geohash', cell),
    Query.limit(100),
  ]);

  for (const other of nearby.documents) {
    const d = distanceM(lat, lng, other.lat, other.lng);
    if (d < minSpacing) {
      const mine = other.ownerId === user.$id;
      throw new Rejected(
        'too_close',
        mine
          ? `You already registered "${other.nickname || other.speciesName}" ${Math.round(d)} m away. Trees must be at least ${minSpacing} m apart.`
          : `Another member already registered a tree ${Math.round(d)} m from here.`,
        { distanceM: Math.round(d) },
      );
    }
  }

  const species = await loadSpecies(databases, speciesCode);
  const vestingMonths = num(config['tree.vesting_months'], 12);
  const now = new Date();

  // The first check-in opens next month, so credits vest over time rather than
  // paying out up front.
  const nextVerifyAfter = new Date(now);
  nextVerifyAfter.setUTCMonth(nextVerifyAfter.getUTCMonth() + 1);
  const windowDays = num(config['tree.verify_window_days'], 7);
  const verifyWindowEnd = new Date(nextVerifyAfter);
  verifyWindowEnd.setUTCDate(verifyWindowEnd.getUTCDate() + windowDays);

  const needsReview =
    screen.reasons.length > 0 ||
    (profile.trustScore ?? 100) < num(config['fraud.trust_score_block_below'], 40);

  const tree = await databases.createDocument(
    DB,
    COL.trees,
    ID.unique(),
    {
      ownerId: user.$id,
      speciesCode,
      speciesName: species?.name || 'Tree',
      nickname: str(body.nickname, 64),
      lat,
      lng,
      geohash: geohash(lat, lng, 9),
      accuracyM,
      addressLabel: str(body.addressLabel, 256),
      ...gpsDetail(body),
      plantPhotoFileId: photoFileId,
      plantPhash: phash,
      plantedAt: nowIso(),
      status: needsReview ? 'pending_review' : 'alive',
      rejectReason: needsReview ? screen.reasons.join(' ') : '',
      verificationCount: 0,
      consecutiveMisses: 0,
      heightCm: Math.max(0, Math.round(num(body.heightCm, 0))),
      creditsVested: 0,
      creditsPending: 0,
      vestingMonths,
      nextVerifyAfter: nextVerifyAfter.toISOString(),
      verifyWindowEnd: verifyWindowEnd.toISOString(),
      mockLocationDetected: false,
      deviceIntegrityOk: true,
      markerCode: markerCode(),
      aiVerdict: screen.aiVerdict,
      aiConfidence: screen.aiConfidence,
      aiModel: screen.aiModel,
    },
    [Permission.read(Role.user(user.$id))],
  );

  const plantCredits = num(config['tree.plant_credits'], 5);
  let result = { applied: false, balance: profile.creditsAvailable ?? 0 };

  if (!needsReview && plantCredits > 0) {
    result = await award(databases, {
      userId: user.$id,
      delta: plantCredits,
      source: 'tree_plant',
      refId: tree.$id,
      idempotencyKey: `tree_plant:${tree.$id}`,
      note: `Planted ${species?.name || 'a tree'}`,
      stats: { treesPlanted: 1, treesAlive: 1 },
      config,
    });
  } else {
    await bumpStats(databases, user.$id, { treesPlanted: 1 });
  }

  await notify(databases, {
    userId: user.$id,
    title: needsReview ? 'Tree submitted for review' : 'Tree registered',
    body: needsReview
      ? 'Our team will take a look shortly. You will hear back within 48 hours.'
      : `Come back after ${nextVerifyAfter.toDateString()} for your first check-in.`,
    type: 'verify_result',
    refId: tree.$id,
  });

  return {
    tree,
    creditsAwarded: result.applied ? plantCredits : 0,
    balance: result.balance,
    needsReview,
    reasons: screen.reasons,
  };
}

export async function verify({ databases, storage, user, body, config, log }) {
  const treeId = str(body.treeId, 64);
  const lat = num(body.lat, NaN);
  const lng = num(body.lng, NaN);
  const accuracyM = num(body.accuracyM, 999);
  const mocked = body.mocked === true;
  const photoFileId = str(body.photoFileId, 64);
  const phash = str(body.phash, 32);
  const plantConfidence = clamp(num(body.plantConfidence, 0), 0, 1);
  const heightCm = Math.max(0, Math.round(num(body.heightCm, 0)));

  if (!treeId) throw new Rejected('missing_tree', 'Which tree is this for?');
  if (!photoFileId) throw new Rejected('missing_photo', 'A fresh photo is required.');

  let tree;
  try {
    tree = await databases.getDocument(DB, COL.trees, treeId);
  } catch (e) {
    if (e.code === 404) throw new Rejected('tree_not_found', 'That tree no longer exists.');
    throw e;
  }

  // Ownership is checked against the JWT-resolved user, never a body field.
  if (tree.ownerId !== user.$id) {
    await flag(databases, {
      userId: user.$id,
      kind: 'manual_report',
      severity: 'high',
      detail: `attempted verify of foreign tree ${treeId}`,
      refType: 'tree',
      refId: treeId,
      trustScoreDelta: -20,
    });
    throw new Rejected('not_your_tree', 'That tree belongs to someone else.');
  }

  if (['dead', 'rejected'].includes(tree.status)) {
    throw new Rejected('tree_closed', 'This tree is no longer being tracked.');
  }
  if (tree.status === 'pending_review') {
    throw new Rejected('tree_in_review', 'This tree is still being reviewed.');
  }

  const key = monthKey();

  // The unique index on (treeId, monthKey) is the real guard; this read just
  // produces a friendlier message.
  //
  // Only a submission that actually counted blocks a retry. A hard rejection
  // must never consume the month, or one bad GPS fix would cost the user a
  // check-in and push the tree toward being marked dead.
  const already = await databases.listDocuments(DB, COL.treeVerifications, [
    Query.equal('treeId', treeId),
    Query.equal('monthKey', key),
    Query.equal('status', ['approved', 'manual_review']),
    Query.limit(1),
  ]);
  if (already.documents.length) {
    throw new Rejected(
      'already_verified',
      'You have already checked in on this tree this month. Come back next month.',
    );
  }

  const opensAt = tree.nextVerifyAfter ? new Date(tree.nextVerifyAfter) : null;
  if (opensAt && Date.now() < opensAt.getTime()) {
    throw new Rejected(
      'window_not_open',
      `Check-in opens ${opensAt.toDateString()}.`,
      { opensAt: opensAt.toISOString() },
    );
  }

  const screen = await screenSubmission({
    databases,
    storage,
    user,
    config,
    lat,
    lng,
    accuracyM,
    mocked,
    plantConfidence,
    phash,
    refType: 'tree_verify',
    // Scoped to the month, so last month's photo of this same tree is still
    // compared against (reuse is the cheat this check exists to catch) while a
    // retry inside the current month is exempt.
    refId: `${treeId}:${key}`,
    photoFileId,
    declaredSpecies: tree.speciesName || tree.speciesCode,
    isVerify: true,
    log,
  });

  // Proof of presence: the user must physically be at the tree.
  const radius = num(config['tree.verify_radius_m'], 30);
  const distance = distanceM(lat, lng, tree.lat, tree.lng);

  if (distance > radius) {
    await flag(databases, {
      userId: user.$id,
      kind: 'out_of_radius',
      severity: 'medium',
      detail: `${Math.round(distance)} m from tree`,
      refType: 'tree',
      refId: treeId,
    });

    // Deliberately no tree_verifications row: the unique index on
    // (treeId, monthKey) would then reject the user's corrected retry. The
    // fraud_flags entry above is the durable record of this attempt.
    throw new Rejected(
      'out_of_radius',
      `You are ${Math.round(distance)} m away. Stand within ${radius} m of the tree to check in.`,
      { distanceM: Math.round(distance), radiusM: radius },
    );
  }

  const species = await loadSpecies(databases, tree.speciesCode);
  const perVerification = num(
    species?.creditsPerVerification,
    num(config['tree.credits_per_verification'], 10),
  );

  const needsReview =
    screen.reasons.length > 0 ||
    (await isLowTrust(databases, user.$id, config));

  const status = needsReview ? 'manual_review' : 'approved';
  const creditsAwarded = needsReview ? 0 : perVerification;

  let record;
  try {
    record = await databases.createDocument(
      DB,
      COL.treeVerifications,
      ID.unique(),
      {
        treeId,
        userId: user.$id,
        monthKey: key,
        photoFileId,
        phash,
        lat,
        lng,
        accuracyM,
        distanceM: distance,
        labels: JSON.stringify(body.labels ?? []).slice(0, 1024),
        plantConfidence,
        heightCm,
        status,
        rejectReason: screen.reasons.join(' '),
        creditsAwarded,
        mockLocationDetected: false,
        deviceIntegrityOk: true,
        phashDistanceToNearest: screen.phashNearest,
        aiVerdict: screen.aiVerdict,
        aiConfidence: screen.aiConfidence,
        aiModel: screen.aiModel,
        verifiedAt: nowIso(),
      },
      [Permission.read(Role.user(user.$id))],
    );
  } catch (e) {
    // Lost a concurrent double-submit race.
    if (e.code === 409) {
      throw new Rejected(
        'already_verified',
        'That check-in was already recorded this month.',
      );
    }
    throw e;
  }

  // Advance the schedule to next month.
  const nextOpen = new Date();
  nextOpen.setUTCMonth(nextOpen.getUTCMonth() + 1);
  const windowDays = num(config['tree.verify_window_days'], 7);
  const nextClose = new Date(nextOpen);
  nextClose.setUTCDate(nextClose.getUTCDate() + windowDays);

  const verificationCount = (tree.verificationCount ?? 0) + (needsReview ? 0 : 1);

  await databases.updateDocument(DB, COL.trees, treeId, {
    status: needsReview ? tree.status : 'alive',
    verificationCount,
    consecutiveMisses: 0,
    heightCm: heightCm > 0 ? heightCm : tree.heightCm ?? 0,
    creditsVested: (tree.creditsVested ?? 0) + creditsAwarded,
    lastVerifiedAt: nowIso(),
    nextVerifyAfter: nextOpen.toISOString(),
    verifyWindowEnd: nextClose.toISOString(),
  });

  let balance = null;
  let streak = 0;
  let bonus = 0;

  if (!needsReview) {
    const profile = await databases.getDocument(DB, COL.profiles, user.$id);
    streak = computeStreak(profile.lastVerifyAt, profile.streakCount ?? 0);

    const co2 = Math.round(num(species?.co2PerYearGrams, 18000) / 12);

    const result = await award(databases, {
      userId: user.$id,
      delta: perVerification,
      source: 'tree_verify',
      refId: record.$id,
      // Month key makes this exactly-once per tree per month.
      idempotencyKey: `tree_verify:${treeId}:${key}`,
      note: `Check-in for ${tree.nickname || tree.speciesName}`,
      stats: { co2OffsetGrams: co2 },
      config,
    });
    balance = result.balance;

    await databases.updateDocument(DB, COL.profiles, user.$id, {
      streakCount: streak,
      longestStreak: Math.max(streak, profile.longestStreak ?? 0),
      lastVerifyAt: nowIso(),
    });

    // Streak bonus at 3, 6, 12 months.
    if ([3, 6, 12].includes(streak)) {
      bonus = streak * 10;
      const bonusResult = await award(databases, {
        userId: user.$id,
        delta: bonus,
        source: 'streak_bonus',
        refId: record.$id,
        idempotencyKey: `streak:${user.$id}:${streak}`,
        note: `${streak} month streak`,
        config,
      });
      if (bonusResult.applied) balance = bonusResult.balance;
      else bonus = 0;
    }
  }

  await notify(databases, {
    userId: user.$id,
    title: needsReview ? 'Check-in under review' : `+${creditsAwarded} credits`,
    body: needsReview
      ? 'We will confirm this check-in within 48 hours.'
      : `${tree.nickname || tree.speciesName} is looking good. Next check-in ${nextOpen.toDateString()}.`,
    type: 'verify_result',
    refId: treeId,
  });

  return {
    verification: record,
    creditsAwarded,
    streakBonus: bonus,
    streak,
    balance,
    needsReview,
    reasons: screen.reasons,
    distanceM: Math.round(distance),
    vestedCount: verificationCount,
    vestingMonths: tree.vestingMonths ?? 12,
  };
}

/** Consecutive calendar months, tolerating a same-month repeat. */
export function computeStreak(lastVerifyAt, current, now = new Date()) {
  if (!lastVerifyAt) return 1;
  const last = new Date(lastVerifyAt);
  const months =
    (now.getUTCFullYear() - last.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - last.getUTCMonth());
  if (months <= 0) return Math.max(1, current);
  if (months === 1) return current + 1;
  return 1;
}

async function isLowTrust(databases, userId, config) {
  try {
    const profile = await databases.getDocument(DB, COL.profiles, userId);
    return (profile.trustScore ?? 100) < num(config['fraud.trust_score_block_below'], 40);
  } catch {
    return false;
  }
}

async function loadSpecies(databases, code) {
  try {
    return await databases.getDocument(DB, COL.species, code);
  } catch {
    return null;
  }
}

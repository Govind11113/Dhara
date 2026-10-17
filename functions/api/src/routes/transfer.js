import { ID, Query, Permission, Role } from 'node-appwrite';
import {
  COL,
  DB,
  Rejected,
  distanceM,
  nowIso,
  num,
  str,
} from '../lib/context.js';
import { award, bumpStats, flag, notify } from '../lib/ledger.js';

/**
 * Chain of custody for serialized packaging.
 *
 * Retail barcodes (EAN/UPC) are identical across every unit of a product, so
 * they cannot identify an individual bottle. Each item therefore carries its own
 * serialized code minted at the factory.
 *
 * Security rests on four things:
 *   1. A strict state machine — exactly one state may follow any given state.
 *   2. A two-party handshake — the sender issues a short-lived token and the
 *      receiver must claim it, so nobody can push items onto a stranger or pull
 *      items off someone else.
 *   3. Role checks — only the role that legitimately holds an item can pass it
 *      on, and only the next role in the chain can receive it.
 *   4. Credit on the return leg only, once per cycle, so buying without
 *      returning earns nothing.
 */

const TRANSITIONS = {
  at_factory: 'with_wholesaler',
  with_wholesaler: 'with_retailer',
  with_retailer: 'with_consumer',
  with_consumer: 'returned_to_retailer',
  returned_to_retailer: 'returned_to_wholesaler',
  returned_to_wholesaler: 'returned_to_factory',
  returned_to_factory: 'recycled',
};

const STATE_HOLDER = {
  at_factory: 'factory',
  with_wholesaler: 'wholesaler',
  with_retailer: 'retailer',
  with_consumer: 'consumer',
  returned_to_retailer: 'retailer',
  returned_to_wholesaler: 'wholesaler',
  returned_to_factory: 'factory',
  recycled: 'factory',
};

const FORWARD_STATES = new Set(['at_factory', 'with_wholesaler', 'with_retailer']);

function directionFor(state) {
  if (state === 'returned_to_factory') return 'recycle';
  return FORWARD_STATES.has(state) ? 'forward' : 'return';
}

const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newToken() {
  let out = '';
  for (let i = 0; i < 24; i++) {
    out += TOKEN_ALPHABET[Math.floor(Math.random() * TOKEN_ALPHABET.length)];
  }
  return out;
}

/**
 * Resolves what the caller is allowed to act as.
 *
 * Everyone is a consumer by default. Business roles must be approved in
 * `partner_roles`, so a consumer cannot claim to be a factory.
 */
async function resolveRole(databases, userId) {
  try {
    const res = await databases.listDocuments(DB, COL.partnerRoles, [
      Query.equal('userId', userId),
      Query.equal('status', 'approved'),
      Query.limit(5),
    ]);
    if (res.documents.length) {
      return {
        role: res.documents[0].role,
        orgName: res.documents[0].orgName,
        partnerId: res.documents[0].$id,
      };
    }
  } catch (e) {
    console.error('role lookup failed', e.message);
  }
  return { role: 'consumer', orgName: '', partnerId: null };
}

/** Sender step: locks a batch of items behind a short-lived handshake token. */
export async function issue({ databases, user, body, config }) {
  const codes = Array.isArray(body.codes)
    ? [...new Set(body.codes.map((c) => str(c, 64)).filter(Boolean))]
    : [];

  if (!codes.length) {
    throw new Rejected('no_items', 'Scan at least one item first.');
  }

  // transfer_tokens.itemIds is a 4096-char field; 100 IDs fits with headroom.
  const maxBatch = Math.min(num(config['bottle.max_batch_size'], 250), 100);
  if (codes.length > maxBatch) {
    throw new Rejected(
      'batch_too_large',
      `Up to ${maxBatch} items per handover. You scanned ${codes.length}.`,
    );
  }

  const actor = await resolveRole(databases, user.$id);
  const lat = Number.isFinite(num(body.lat, NaN)) ? num(body.lat) : null;
  const lng = Number.isFinite(num(body.lng, NaN)) ? num(body.lng) : null;

  const accepted = [];
  const rejected = [];

  for (const code of codes) {
    let item;
    try {
      const found = await databases.listDocuments(DB, COL.items, [
        Query.equal('code', code),
        Query.limit(1),
      ]);
      item = found.documents[0];
    } catch (e) {
      console.error('item lookup failed', code, e.message);
    }

    if (!item) {
      rejected.push({ code, reason: 'Not a registered Dhara item.' });
      continue;
    }
    if (item.isVoid) {
      rejected.push({ code, reason: 'This item has been retired.' });
      continue;
    }

    const nextState = TRANSITIONS[item.state];
    if (!nextState) {
      rejected.push({ code, reason: 'This item has completed its journey.' });
      continue;
    }

    // Only the current holder may pass an item on.
    if (item.holderId !== user.$id) {
      rejected.push({ code, reason: 'You are not holding this item.' });
      continue;
    }

    const requiredRole = STATE_HOLDER[item.state];
    if (requiredRole !== actor.role) {
      rejected.push({
        code,
        reason: `Only a ${requiredRole} can pass this on.`,
      });
      continue;
    }

    accepted.push(item);
  }

  if (!accepted.length) {
    throw new Rejected(
      'no_transferable_items',
      rejected[0]?.reason || 'None of those items can be handed over right now.',
      { rejected },
    );
  }

  // Every item in one handover must be at the same stage, so the receiving role
  // is unambiguous.
  const fromState = accepted[0].state;
  const mixed = accepted.filter((i) => i.state !== fromState);
  for (const item of mixed) {
    rejected.push({
      code: item.code,
      reason: 'Mixed stages in one handover. Scan these separately.',
    });
  }
  const batch = accepted.filter((i) => i.state === fromState);

  const ttl = num(config['bottle.transfer_token_ttl_s'], 90);
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  const token = newToken();
  const intent = directionFor(fromState);

  const doc = await databases.createDocument(
    DB,
    COL.transferTokens,
    ID.unique(),
    {
      token,
      issuerId: user.$id,
      issuerRole: actor.role,
      itemIds: JSON.stringify(batch.map((i) => i.$id)).slice(0, 4096),
      itemCount: batch.length,
      intent,
      lat,
      lng,
      expiresAt,
      consumed: false,
    },
    [Permission.read(Role.user(user.$id))],
  );

  return {
    token,
    tokenId: doc.$id,
    expiresAt,
    ttlSeconds: ttl,
    intent,
    fromState,
    toState: TRANSITIONS[fromState],
    receiverRole: STATE_HOLDER[TRANSITIONS[fromState]],
    itemCount: batch.length,
    items: batch.map((i) => ({
      code: i.code,
      title: i.productName || i.productType,
      productType: i.productType,
    })),
    rejected,
  };
}

/** Receiver step: consumes the token and advances each item one legal state. */
export async function claim({ databases, user, body, config }) {
  const token = str(body.token, 64).toUpperCase();
  if (!token) throw new Rejected('missing_token', 'Scan the sender\u2019s code.');

  const found = await databases.listDocuments(DB, COL.transferTokens, [
    Query.equal('token', token),
    Query.limit(1),
  ]);
  const record = found.documents[0];

  if (!record) {
    throw new Rejected('invalid_token', 'That code is not valid.');
  }
  if (record.consumed) {
    throw new Rejected(
      'token_used',
      'That code has already been used. Ask for a fresh one.',
    );
  }
  if (new Date(record.expiresAt).getTime() < Date.now()) {
    await flag(databases, {
      userId: user.$id,
      kind: 'token_expired',
      severity: 'low',
      detail: `token ${token}`,
      refType: 'transfer_token',
      refId: record.$id,
    });
    throw new Rejected(
      'token_expired',
      'That code expired. Ask the sender to generate a new one.',
    );
  }

  // Handing an item to yourself would let one account walk items through the
  // whole chain and mint credits.
  if (record.issuerId === user.$id) {
    await flag(databases, {
      userId: user.$id,
      kind: 'self_transfer',
      severity: 'high',
      detail: 'issuer and claimer match',
      refType: 'transfer_token',
      refId: record.$id,
      trustScoreDelta: -20,
    });
    throw new Rejected(
      'self_transfer',
      'You cannot hand items to yourself. The other party must scan.',
    );
  }

  const actor = await resolveRole(databases, user.$id);

  let itemIds = [];
  try {
    const parsed = JSON.parse(record.itemIds);
    if (Array.isArray(parsed)) itemIds = parsed;
  } catch {
    throw new Rejected('corrupt_token', 'That handover could not be read.');
  }
  if (!itemIds.length) {
    throw new Rejected('empty_token', 'That handover has no items.');
  }

  const lat = Number.isFinite(num(body.lat, NaN)) ? num(body.lat) : null;
  const lng = Number.isFinite(num(body.lng, NaN)) ? num(body.lng) : null;

  // Both parties should be in the same place. Skipped when either side has no
  // location rather than blocking the handover outright.
  let separation = 0;
  if (lat !== null && lng !== null && record.lat !== null && record.lng !== null) {
    separation = distanceM(lat, lng, record.lat, record.lng);
    const maxDistance = num(config['bottle.max_transfer_distance_m'], 150);
    if (separation > maxDistance) {
      await flag(databases, {
        userId: user.$id,
        kind: 'velocity_abuse',
        severity: 'medium',
        detail: `parties ${Math.round(separation)} m apart`,
        refType: 'transfer_token',
        refId: record.$id,
      });
      throw new Rejected(
        'too_far_apart',
        `You appear to be ${Math.round(separation)} m from the sender. Hand over in person.`,
        { distanceM: Math.round(separation) },
      );
    }
  }

  // Burn the token before moving anything, so a double-scan cannot double-pay.
  try {
    await databases.updateDocument(DB, COL.transferTokens, record.$id, {
      consumed: true,
      consumedBy: user.$id,
      consumedAt: nowIso(),
    });
  } catch (e) {
    console.error('token burn failed', e.message);
    throw new Rejected('token_race', 'That code was just used. Ask for a new one.');
  }

  const moved = [];
  const skipped = [];
  let creditsToIssuer = 0;
  let itemsReturned = 0;

  for (const itemId of itemIds) {
    let item;
    try {
      item = await databases.getDocument(DB, COL.items, itemId);
    } catch {
      skipped.push({ itemId, reason: 'Item not found.' });
      continue;
    }

    const fromState = item.state;
    const toState = TRANSITIONS[fromState];

    // Re-validate against live state: the item may have moved since the token
    // was issued.
    if (!toState) {
      skipped.push({ code: item.code, reason: 'Already completed its journey.' });
      continue;
    }
    if (item.holderId !== record.issuerId) {
      skipped.push({ code: item.code, reason: 'Sender no longer holds this item.' });
      continue;
    }
    if (STATE_HOLDER[toState] !== actor.role) {
      skipped.push({
        code: item.code,
        reason: `This item must go to a ${STATE_HOLDER[toState]}, not a ${actor.role}.`,
      });
      continue;
    }

    const direction = directionFor(fromState);
    const closesCycle = toState === 'recycled';
    const cycleCount = closesCycle ? (item.cycleCount ?? 0) + 1 : item.cycleCount ?? 0;

    // The consumer earns when they actually hand the item back, once per cycle.
    const earnsCredit =
      fromState === 'with_consumer' && !item.rewardClaimedThisCycle;
    const itemCredits = earnsCredit
      ? num(item.creditValue, 0) ||
        num(config[`bottle.credits_${item.productType}`], 2)
      : 0;

    try {
      await databases.updateDocument(DB, COL.items, itemId, {
        state: toState,
        holderId: user.$id,
        holderRole: actor.role,
        transferCount: (item.transferCount ?? 0) + 1,
        lastTransferAt: nowIso(),
        cycleCount,
        // Reset once the bottle is recycled so a refilled unit can earn again.
        rewardClaimedThisCycle: closesCycle
          ? false
          : item.rewardClaimedThisCycle || earnsCredit,
      });
    } catch (e) {
      skipped.push({ code: item.code, reason: 'Could not update this item.' });
      console.error('item move failed', itemId, e.message);
      continue;
    }

    try {
      await databases.createDocument(
        DB,
        COL.custodyEvents,
        ID.unique(),
        {
          itemId,
          code: item.code,
          fromId: record.issuerId,
          toId: user.$id,
          fromRole: record.issuerRole,
          toRole: actor.role,
          fromState,
          toState,
          direction,
          lat,
          lng,
          distanceM: separation,
          transferToken: token,
          creditsAwarded: itemCredits,
          cycleCount,
          occurredAt: nowIso(),
        },
        [
          Permission.read(Role.user(user.$id)),
          Permission.read(Role.user(record.issuerId)),
        ],
      );
    } catch (e) {
      console.error('custody event failed', itemId, e.message);
    }

    if (itemCredits > 0) {
      creditsToIssuer += itemCredits;
      itemsReturned += 1;
    }
    moved.push({ code: item.code, fromState, toState, credits: itemCredits });
  }

  if (!moved.length) {
    throw new Rejected(
      'nothing_moved',
      skipped[0]?.reason || 'None of those items could be transferred.',
      { skipped },
    );
  }

  // Credits go to the person who returned the packaging, not the receiver.
  let issuerBalance = null;
  if (creditsToIssuer > 0) {
    const result = await award(databases, {
      userId: record.issuerId,
      delta: creditsToIssuer,
      source: 'bottle_return',
      refId: record.$id,
      // One payout per handover token.
      idempotencyKey: `bottle_return:${record.$id}`,
      note: `Returned ${itemsReturned} item${itemsReturned === 1 ? '' : 's'}`,
      stats: { bottlesReturned: itemsReturned },
      config,
    });
    issuerBalance = result.balance;

    await notify(databases, {
      userId: record.issuerId,
      title: `+${creditsToIssuer} credits`,
      body: `${itemsReturned} item${itemsReturned === 1 ? '' : 's'} returned for recycling. Thank you.`,
      type: 'credits',
      refId: record.$id,
    });
  }

  if (actor.role !== 'consumer') {
    await bumpStats(databases, user.$id, {});
  }

  return {
    moved,
    skipped,
    movedCount: moved.length,
    creditsAwardedToSender: creditsToIssuer,
    senderBalance: issuerBalance,
    receiverRole: actor.role,
  };
}

/** Read-only lookup so a user can see where an item is in its journey. */
export async function lookup({ databases, user, body }) {
  const code = str(body.code, 64);
  if (!code) throw new Rejected('missing_code', 'Scan a code first.');

  const found = await databases.listDocuments(DB, COL.items, [
    Query.equal('code', code),
    Query.limit(1),
  ]);
  const item = found.documents[0];
  if (!item) {
    throw new Rejected(
      'unknown_item',
      'That code is not a registered Dhara item.',
    );
  }

  let history = [];
  try {
    const events = await databases.listDocuments(DB, COL.custodyEvents, [
      Query.equal('itemId', item.$id),
      Query.orderDesc('occurredAt'),
      Query.limit(25),
    ]);
    history = events.documents.map((e) => ({
      fromState: e.fromState,
      toState: e.toState,
      direction: e.direction,
      occurredAt: e.occurredAt,
      creditsAwarded: e.creditsAwarded,
      // Party IDs stay server-side; only roles are exposed.
      fromRole: e.fromRole,
      toRole: e.toRole,
    }));
  } catch (e) {
    console.error('history failed', e.message);
  }

  const actor = await resolveRole(databases, user.$id);
  const nextState = TRANSITIONS[item.state] ?? null;

  return {
    item: {
      code: item.code,
      productType: item.productType,
      productName: item.productName,
      brandName: item.brandName,
      sizeMl: item.sizeMl,
      state: item.state,
      cycleCount: item.cycleCount,
      creditValue: item.creditValue,
      transferCount: item.transferCount,
    },
    isYours: item.holderId === user.$id,
    yourRole: actor.role,
    nextState,
    canTransfer:
      item.holderId === user.$id &&
      !!nextState &&
      STATE_HOLDER[item.state] === actor.role,
    history,
  };
}

/**
 * Mints serialized items.
 *
 * Restricted to approved factory accounts. Without this gate anyone could
 * fabricate items and walk them through the chain for credits.
 */
export async function mint({ databases, user, body, config }) {
  const actor = await resolveRole(databases, user.$id);
  if (actor.role !== 'factory') {
    throw new Rejected(
      'not_a_factory',
      'Only approved factory accounts can register new items.',
    );
  }

  const productType = str(body.productType, 32) || 'pet_bottle';
  const count = Math.max(1, Math.min(200, Math.round(num(body.count, 1))));
  const sizeMl = Math.max(0, Math.round(num(body.sizeMl, 0)));
  const batchId = ID.unique();

  const creditValue = num(config[`bottle.credits_${productType}`], 2);
  const created = [];

  for (let i = 0; i < count; i++) {
    const code = `DH${Date.now().toString(36).toUpperCase()}${newToken().slice(0, 8)}`;
    try {
      const doc = await databases.createDocument(
        DB,
        COL.items,
        ID.unique(),
        {
          code,
          productType,
          productName: str(body.productName, 96),
          sizeMl,
          brandName: str(body.brandName, 96),
          factoryId: user.$id,
          batchId,
          state: 'at_factory',
          holderId: user.$id,
          holderRole: 'factory',
          cycleCount: 0,
          creditValue,
          transferCount: 0,
          rewardClaimedThisCycle: false,
          isVoid: false,
        },
        [Permission.read(Role.users())],
      );
      created.push({ code: doc.code, id: doc.$id });
    } catch (e) {
      console.error('mint failed', e.message);
    }
  }

  return { batchId, created, count: created.length };
}

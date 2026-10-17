import { Query } from 'node-appwrite';
import { COL, DB, Rejected, nowIso, num, str } from '../lib/context.js';
import { ADMIN_LABEL, logAction } from '../lib/admin.js';
import { award, notify, refund } from '../lib/ledger.js';
import { CONFIG_SPEC, publicSpec, validateConfigValue } from '../lib/config_spec.js';
import { computeStreak } from './tree.js';

/**
 * Admin write side. Every handler here runs behind the /admin/ gate in main.js
 * and records an `admin_actions` row once the change has landed.
 *
 * Two rules keep credits safe:
 *
 *  1. Money moves through the same idempotency keys the normal paths use
 *     (`tree_plant:<id>`, `tree_verify:<treeId>:<month>`), so an approval can
 *     never pay twice, even if the button is double-clicked or the admin and
 *     the user's own retry race.
 *  2. Side effects (counters, streaks) ride on the award's `applied` flag. Only
 *     the call that actually paid applies them. If a later step fails the
 *     counters lag, which is the safe direction — a user is never credited
 *     twice for one decision.
 */

async function getOr404(databases, col, id, what) {
  try {
    return await databases.getDocument(DB, col, id);
  } catch (e) {
    if (e.code === 404) throw new Rejected('not_found', `That ${what} no longer exists.`);
    throw e;
  }
}

function requireReason(body, min = 3) {
  const reason = str(body.reason, 200);
  if (reason.length < min) {
    throw new Rejected('reason_required', 'Give the person a short reason they can read.');
  }
  return reason;
}

async function loadSpecies(databases, code) {
  try {
    return await databases.getDocument(DB, COL.species, code);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Review queue
// ---------------------------------------------------------------------------

async function approveTree({ databases, admin, tree, config }) {
  const credits = num(config['tree.plant_credits'], 5);
  let paid = 0;

  if (credits > 0) {
    const result = await award(databases, {
      userId: tree.ownerId,
      delta: credits,
      source: 'tree_plant',
      refId: tree.$id,
      // The key the normal planting path uses: if this tree was somehow paid
      // already, this is a no-op rather than a second payout.
      idempotencyKey: `tree_plant:${tree.$id}`,
      note: `Planted ${tree.speciesName || 'a tree'} (approved)`,
      // treesPlanted was counted when the tree was submitted; only the alive
      // count is new.
      stats: { treesAlive: 1 },
      config,
    });
    if (result.applied) paid = credits;
  }

  // The commit point. Everything above is idempotent, so a failure before this
  // line is safe to retry.
  await databases.updateDocument(DB, COL.trees, tree.$id, { status: 'alive', rejectReason: '' });

  await notify(databases, {
    userId: tree.ownerId,
    title: paid ? `Tree approved · +${paid} credits` : 'Tree approved',
    body: `${tree.nickname || tree.speciesName || 'Your tree'} passed review. Check back next month for your first check-in.`,
    type: 'verify_result',
    refId: tree.$id,
  });

  return { credits: paid };
}

async function approveVerification({ databases, ver, config }) {
  const tree = await getOr404(databases, COL.trees, ver.treeId, 'tree');
  const profile = await getOr404(databases, COL.profiles, ver.userId, 'profile');
  const species = await loadSpecies(databases, tree.speciesCode);

  const perVerification = num(species?.creditsPerVerification, num(config['tree.credits_per_verification'], 10));
  const co2 = Math.round(num(species?.co2PerYearGrams, 18000) / 12);

  const result = await award(databases, {
    userId: ver.userId,
    delta: perVerification,
    source: 'tree_verify',
    refId: ver.$id,
    // Same key verify() uses, so one tree earns once per month however it got
    // approved.
    idempotencyKey: `tree_verify:${ver.treeId}:${ver.monthKey}`,
    note: `Check-in for ${tree.nickname || tree.speciesName} (approved)`,
    stats: { co2OffsetGrams: co2 },
    config,
  });

  await databases.updateDocument(DB, COL.treeVerifications, ver.$id, {
    status: 'approved',
    creditsAwarded: result.applied ? perVerification : ver.creditsAwarded ?? 0,
    rejectReason: '',
  });

  let streak = profile.streakCount ?? 0;
  let bonus = 0;

  if (result.applied) {
    // A held check-in never counted toward the tree's progress. It does now.
    await databases.updateDocument(DB, COL.trees, tree.$id, {
      verificationCount: (tree.verificationCount ?? 0) + 1,
      creditsVested: (tree.creditsVested ?? 0) + perVerification,
      lastVerifiedAt: ver.verifiedAt ?? nowIso(),
      consecutiveMisses: 0,
      status: ['at_risk', 'missed'].includes(tree.status) ? 'alive' : tree.status,
    });

    // Streak is measured from when the check-in was made, not when it was
    // approved: a month-end submission approved a week later must not be read
    // as a skipped month.
    const when = new Date(ver.verifiedAt ?? Date.now());
    streak = computeStreak(profile.lastVerifyAt, profile.streakCount ?? 0, when);
    const lastIso =
      !profile.lastVerifyAt || new Date(profile.lastVerifyAt) < when
        ? when.toISOString()
        : profile.lastVerifyAt;

    await databases.updateDocument(DB, COL.profiles, ver.userId, {
      streakCount: streak,
      longestStreak: Math.max(streak, profile.longestStreak ?? 0),
      lastVerifyAt: lastIso,
    });

    if ([3, 6, 12].includes(streak)) {
      const b = await award(databases, {
        userId: ver.userId,
        delta: streak * 10,
        source: 'streak_bonus',
        refId: ver.$id,
        idempotencyKey: `streak:${ver.userId}:${streak}`,
        note: `${streak} month streak`,
        config,
      });
      if (b.applied) bonus = streak * 10;
    }
  }

  await notify(databases, {
    userId: ver.userId,
    title: result.applied ? `Check-in approved · +${perVerification + bonus} credits` : 'Check-in approved',
    body: `${tree.nickname || tree.speciesName || 'Your tree'} passed review.`,
    type: 'verify_result',
    refId: ver.treeId,
  });

  return { credits: result.applied ? perVerification + bonus : 0, streak };
}

async function decide({ databases, user, body, config }) {
  const kind = str(body.kind, 16);
  const id = str(body.id, 64);
  const decision = str(body.decision, 16);

  if (!['tree', 'verification'].includes(kind)) throw new Rejected('bad_request', 'kind must be tree or verification.');
  if (!['approve', 'reject'].includes(decision)) throw new Rejected('bad_request', 'decision must be approve or reject.');
  if (!id) throw new Rejected('bad_request', 'id is required.');

  const isTree = kind === 'tree';
  const col = isTree ? COL.trees : COL.treeVerifications;
  const waiting = isTree ? 'pending_review' : 'manual_review';
  const doc = await getOr404(databases, col, id, kind);

  // Deciding twice is refused rather than repeated. The ledger keys would stop
  // a second payout anyway, but a clear message beats a silent no-op.
  if (doc.status !== waiting) {
    throw new Rejected('already_decided', `This ${kind} is already ${String(doc.status).replace('_', ' ')}.`);
  }

  const ownerId = isTree ? doc.ownerId : doc.userId;
  let outcome;

  if (decision === 'approve') {
    outcome = isTree
      ? await approveTree({ databases, admin: user, tree: doc, config })
      : await approveVerification({ databases, ver: doc, config });
  } else {
    const reason = requireReason(body);
    await databases.updateDocument(DB, col, id, {
      status: 'rejected',
      rejectReason: reason,
      ...(isTree ? {} : { creditsAwarded: 0 }),
    });
    await notify(databases, {
      userId: ownerId,
      title: isTree ? 'Tree not approved' : 'Check-in not approved',
      body: `${reason} You can send feedback from the You tab if you think this is wrong.`,
      type: 'verify_result',
      refId: isTree ? id : doc.treeId,
    });
    outcome = { credits: 0 };
  }

  await logAction(databases, user, {
    action: `review.${decision}`,
    targetType: kind,
    targetId: id,
    detail: { user: ownerId, credits: outcome.credits, reason: str(body.reason, 200) },
  });

  return { id, kind, decision, ...outcome };
}

// ---------------------------------------------------------------------------
// Users, flags, feedback
// ---------------------------------------------------------------------------

async function setBan({ databases, users, user, body }) {
  const userId = str(body.userId, 64);
  const banned = body.banned === true;
  if (!userId) throw new Rejected('bad_request', 'userId is required.');

  // Locking out an admin by mistake could strand the panel with nobody able to
  // undo it, so admins are not bannable from here.
  try {
    const target = await users.get(userId);
    if ((target.labels ?? []).includes(ADMIN_LABEL)) {
      throw new Rejected('bad_request', 'Administrators cannot be suspended from the panel.');
    }
  } catch (e) {
    if (e instanceof Rejected) throw e;
    if (e.code !== 404) throw e;
  }

  const reason = banned ? requireReason(body) : '';
  const profile = await getOr404(databases, COL.profiles, userId, 'user');
  await databases.updateDocument(DB, COL.profiles, userId, { isBanned: banned, banReason: reason });

  await notify(databases, {
    userId,
    title: banned ? 'Account suspended' : 'Account restored',
    body: banned ? reason : 'Your account is active again.',
    type: 'system',
  });
  await logAction(databases, user, {
    action: banned ? 'user.ban' : 'user.unban',
    targetType: 'user',
    targetId: userId,
    detail: { name: profile.name, reason },
  });
  return { userId, banned };
}

async function resolveFlag({ databases, user, body }) {
  const id = str(body.id, 64);
  const resolution = requireReason({ reason: body.resolution });
  const flag = await getOr404(databases, COL.fraudFlags, id, 'flag');
  if (flag.resolved) throw new Rejected('already_decided', 'That flag is already resolved.');

  await databases.updateDocument(DB, COL.fraudFlags, id, { resolved: true, resolution });
  await logAction(databases, user, {
    action: 'flag.resolve',
    targetType: 'flag',
    targetId: id,
    detail: { kind: flag.kind, user: flag.userId, resolution },
  });
  return { id, resolved: true };
}

async function replyFeedback({ databases, user, body }) {
  const id = str(body.id, 64);
  const reply = str(body.reply, 1000);
  const status = str(body.status, 16) || (reply ? 'answered' : 'triaged');
  if (!['triaged', 'answered', 'closed'].includes(status)) {
    throw new Rejected('bad_request', 'status must be triaged, answered or closed.');
  }
  if (status === 'answered' && !reply) throw new Rejected('reason_required', 'Write the reply first.');

  const fb = await getOr404(databases, COL.feedback, id, 'feedback');
  const patch = { status };
  if (reply) patch.adminReply = reply;
  await databases.updateDocument(DB, COL.feedback, id, patch);

  if (reply && reply !== fb.adminReply) {
    await notify(databases, {
      userId: fb.userId,
      title: 'We replied to your feedback',
      body: reply.slice(0, 500),
      type: 'system',
      refId: id,
    });
  }
  await logAction(databases, user, {
    action: 'feedback.reply',
    targetType: 'feedback',
    targetId: id,
    detail: { status, replied: !!reply },
  });
  return { id, status };
}

// ---------------------------------------------------------------------------
// Redemptions
// ---------------------------------------------------------------------------

const REDEMPTION_NEXT = {
  pending: ['processing', 'fulfilled', 'failed', 'cancelled'],
  processing: ['fulfilled', 'failed', 'cancelled'],
  fulfilled: [],
  failed: [],
  cancelled: [],
};

/** Terminal states never change again, so a refund can only ever happen once. */
export function canMoveRedemption(from, to) {
  return (REDEMPTION_NEXT[from] ?? []).includes(to);
}

async function updateRedemption({ databases, user, body }) {
  const id = str(body.id, 64);
  const next = str(body.status, 16);
  const rd = await getOr404(databases, COL.redemptions, id, 'redemption');

  if (!canMoveRedemption(rd.status, next)) {
    throw new Rejected('bad_transition', `A ${rd.status} redemption cannot become ${next}.`);
  }

  const patch = { status: next };
  let refunded = 0;

  if (next === 'fulfilled') {
    patch.fulfilledAt = nowIso();
    if (rd.type !== 'electricity_bill' && rd.type !== 'tree_donation') {
      patch.voucherCode = str(body.voucherCode, 128);
    }
  }

  if (next === 'failed' || next === 'cancelled') {
    patch.failureReason = requireReason({ reason: body.failureReason ?? body.reason });
    const result = await refund(databases, {
      userId: rd.userId,
      amount: num(rd.creditsSpent, 0),
      refId: id,
      // One refund per redemption, ever.
      idempotencyKey: `redeem_refund:${id}`,
      note: `Refund: ${rd.rewardTitle}`,
    });
    if (result.applied) refunded = num(rd.creditsSpent, 0);

    // Best effort: put the unit back on the shelf. Stock is a convenience.
    try {
      const reward = await databases.getDocument(DB, COL.rewards, rd.rewardId);
      await databases.updateDocument(DB, COL.rewards, rd.rewardId, {
        stockRemaining: (reward.stockRemaining ?? 0) + 1,
      });
    } catch {
      /* the reward may have been removed */
    }
  }

  await databases.updateDocument(DB, COL.redemptions, id, patch);

  await notify(databases, {
    userId: rd.userId,
    title:
      next === 'fulfilled' ? 'Reward delivered'
      : next === 'processing' ? 'Reward in progress'
      : `Redemption ${next}`,
    body:
      next === 'fulfilled' ? `${rd.rewardTitle} is done.${patch.voucherCode ? ` Code: ${patch.voucherCode}` : ''}`
      : next === 'processing' ? `${rd.rewardTitle} is being processed.`
      : `${patch.failureReason} ${refunded ? `${refunded} credits are back in your balance.` : ''}`.trim(),
    type: 'redemption',
    refId: id,
  });
  await logAction(databases, user, {
    action: `redemption.${next}`,
    targetType: 'redemption',
    targetId: id,
    detail: { user: rd.userId, refunded },
  });
  return { id, status: next, refunded };
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

async function configList({ databases }) {
  const res = await databases.listDocuments(DB, COL.appConfig, [Query.limit(100)]);
  const items = res.documents
    .filter((d) => CONFIG_SPEC[d.key])
    .map((d) => ({ key: d.key, value: d.value, description: d.description, spec: publicSpec(d.key) }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return { items };
}

async function configSet({ databases, user, body }) {
  const key = str(body.key, 64);
  const value = validateConfigValue(key, body.value);

  const found = await databases.listDocuments(DB, COL.appConfig, [Query.equal('key', key), Query.limit(1)]);
  const doc = found.documents[0];
  if (!doc) throw new Rejected('not_found', `"${key}" is not in the config yet. Run the seed script.`);

  const before = doc.value;
  if (before === value) return { key, value, changed: false };

  await databases.updateDocument(DB, COL.appConfig, doc.$id, { value });
  await logAction(databases, user, {
    action: 'config.set',
    targetType: 'config',
    targetId: key,
    detail: { from: before, to: value },
  });
  return { key, value, changed: true };
}

export const WRITE_ROUTES = {
  '/admin/review/decide': decide,
  '/admin/user/ban': setBan,
  '/admin/flag/resolve': resolveFlag,
  '/admin/feedback/reply': replyFeedback,
  '/admin/redemption/update': updateRedemption,
  '/admin/config/list': configList,
  '/admin/config/set': configSet,
};

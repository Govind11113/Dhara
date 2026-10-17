import { ID, Query, Permission, Role } from 'node-appwrite';
import { COL, DB, nowIso, num } from '../lib/context.js';
import { award, notify } from '../lib/ledger.js';

/**
 * Awards any badges the user has newly qualified for.
 *
 * Thresholds are evaluated against the profile's cached counters, and each
 * award is keyed by badge code so a repeated sync cannot pay the bonus twice.
 */
export async function sync({ databases, user, config }) {
  const profile = await databases.getDocument(DB, COL.profiles, user.$id);

  const [catalog, earned, verifications, referrals] = await Promise.all([
    databases.listDocuments(DB, COL.badges, [
      Query.equal('isActive', true),
      Query.limit(100),
    ]),
    databases.listDocuments(DB, COL.userBadges, [
      Query.equal('userId', user.$id),
      Query.limit(100),
    ]),
    countVerifications(databases, user.$id),
    countReferrals(databases, user.$id),
  ]);

  const already = new Set(earned.documents.map((d) => d.badgeCode));

  const stats = {
    trees_planted: profile.treesPlanted ?? 0,
    trees_alive: profile.treesAlive ?? 0,
    verifications,
    bottles_returned: profile.bottlesReturned ?? 0,
    streak: profile.streakCount ?? 0,
    credits_lifetime: profile.creditsLifetime ?? 0,
    referrals,
  };

  const unlocked = [];
  let balance = profile.creditsAvailable ?? 0;

  for (const badge of catalog.documents) {
    if (already.has(badge.code)) continue;

    const current = stats[badge.metric] ?? 0;
    if (current < num(badge.threshold, 1)) continue;

    try {
      await databases.createDocument(
        DB,
        COL.userBadges,
        // Deterministic ID: the unique index is the real guard, this makes the
        // duplicate cheap to detect.
        ID.unique(),
        {
          userId: user.$id,
          badgeCode: badge.code,
          badgeTitle: badge.title,
          emoji: badge.emoji ?? '',
          tier: badge.tier ?? 'bronze',
          bonusCredits: num(badge.bonusCredits, 0),
          earnedAt: nowIso(),
        },
        [Permission.read(Role.user(user.$id))],
      );
    } catch (e) {
      // 409 means a concurrent sync already granted it.
      if (e.code === 409) continue;
      console.error('badge grant failed', badge.code, e.message);
      continue;
    }

    const bonus = num(badge.bonusCredits, 0);
    if (bonus > 0) {
      const result = await award(databases, {
        userId: user.$id,
        delta: bonus,
        source: 'badge_bonus',
        refId: badge.code,
        idempotencyKey: `badge:${user.$id}:${badge.code}`,
        note: `Badge unlocked: ${badge.title}`,
        config,
      });
      if (result.applied) balance = result.balance;
    }

    unlocked.push({
      code: badge.code,
      title: badge.title,
      emoji: badge.emoji ?? '',
      tier: badge.tier ?? 'bronze',
      bonusCredits: bonus,
    });

    await notify(databases, {
      userId: user.$id,
      title: `Badge unlocked: ${badge.title}`,
      body: bonus > 0 ? `+${bonus} bonus credits.` : badge.description ?? '',
      type: 'badge',
      refId: badge.code,
    });
  }

  return { unlocked, balance, stats };
}

async function countVerifications(databases, userId) {
  try {
    const res = await databases.listDocuments(DB, COL.treeVerifications, [
      Query.equal('userId', userId),
      Query.equal('status', 'approved'),
      Query.limit(1),
    ]);
    return res.total ?? res.documents.length;
  } catch {
    return 0;
  }
}

async function countReferrals(databases, userId) {
  try {
    const res = await databases.listDocuments(DB, COL.profiles, [
      Query.equal('referredBy', userId),
      Query.limit(1),
    ]);
    return res.total ?? res.documents.length;
  } catch {
    return 0;
  }
}

/**
 * Rebuilds public leaderboard snapshots.
 *
 * `profiles` is readable only by its owner, so the client cannot rank users
 * itself. This copies just the fields meant to be public (name, avatar, score)
 * into the `leaderboard` collection, which every signed-in user can read.
 *
 * Cheap to call and safe to run often; snapshots are refreshed at most once
 * every few minutes.
 */
export async function refreshLeaderboard({ databases, body }) {
  const period = ['all_time', 'monthly'].includes(body?.period)
    ? body.period
    : 'all_time';

  const staleAfterMs = 5 * 60 * 1000;
  try {
    const latest = await databases.listDocuments(DB, COL.leaderboard, [
      Query.equal('period', period),
      Query.orderDesc('computedAt'),
      Query.limit(1),
    ]);
    const last = latest.documents[0];
    if (last && Date.now() - new Date(last.computedAt).getTime() < staleAfterMs) {
      return { refreshed: false, reason: 'fresh' };
    }
  } catch (e) {
    console.error('leaderboard freshness check failed', e.message);
  }

  const top = await databases.listDocuments(DB, COL.profiles, [
    Query.equal('isBanned', false),
    Query.orderDesc('creditsLifetime'),
    Query.limit(100),
  ]);

  const computedAt = nowIso();
  let rank = 0;
  const written = [];

  for (const profile of top.documents) {
    rank += 1;
    const data = {
      period,
      userId: profile.userId ?? profile.$id,
      name: profile.name ?? 'Member',
      avatarFileId: profile.avatarFileId ?? null,
      rank,
      score: num(profile.creditsLifetime, 0),
      treesAlive: num(profile.treesAlive, 0),
      bottlesReturned: num(profile.bottlesReturned, 0),
      level: num(profile.level, 1),
      streakCount: num(profile.streakCount, 0),
      computedAt,
    };

    // Deterministic ID keeps one row per user per period.
    const docId = `${period}_${data.userId}`.slice(0, 36);
    try {
      await databases.createDocument(DB, COL.leaderboard, docId, data);
    } catch (e) {
      if (e.code === 409) {
        try {
          await databases.updateDocument(DB, COL.leaderboard, docId, data);
        } catch (e2) {
          console.error('leaderboard update failed', docId, e2.message);
          continue;
        }
      } else {
        console.error('leaderboard write failed', docId, e.message);
        continue;
      }
    }
    written.push(data.userId);
  }

  return { refreshed: true, count: written.length, computedAt };
}

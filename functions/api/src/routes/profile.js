import { ID, Query, Permission, Role } from 'node-appwrite';
import { COL, DB, Rejected, nowIso, str } from '../lib/context.js';
import { award } from '../lib/ledger.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function referralCode() {
  let out = '';
  for (let i = 0; i < 7; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

/**
 * Creates the profile row on first login.
 *
 * Idempotent: the document ID is the Appwrite user ID, so a repeat call simply
 * returns the existing row. The client cannot choose its own ID here.
 */
export async function bootstrap({ databases, user, body, config }) {
  const name = str(body.name, 128) || user.name || 'Friend';

  try {
    const existing = await databases.getDocument(DB, COL.profiles, user.$id);
    return { profile: existing, created: false };
  } catch (e) {
    if (e.code !== 404) throw e;
  }

  // Retry on the tiny chance of a referral code collision.
  let profile = null;
  for (let attempt = 0; attempt < 5 && !profile; attempt++) {
    try {
      profile = await databases.createDocument(
        DB,
        COL.profiles,
        user.$id,
        {
          userId: user.$id,
          name,
          email: user.email,
          referralCode: referralCode(),
          creditsAvailable: 0,
          creditsLifetime: 0,
          creditsPending: 0,
          creditsSpent: 0,
          xp: 0,
          level: 1,
          treesPlanted: 0,
          treesAlive: 0,
          bottlesReturned: 0,
          co2OffsetGrams: 0,
          streakCount: 0,
          longestStreak: 0,
          trustScore: 100,
          isBanned: false,
          electricityVerified: false,
          lastActiveAt: nowIso(),
        },
        [Permission.read(Role.user(user.$id))],
      );
    } catch (e) {
      // 409 on the document ID means a concurrent bootstrap won the race.
      if (e.code === 409) {
        try {
          const existing = await databases.getDocument(DB, COL.profiles, user.$id);
          return { profile: existing, created: false };
        } catch {
          // Fall through and retry with a fresh referral code.
        }
      } else {
        throw e;
      }
    }
  }

  if (!profile) {
    throw new Rejected('profile_create_failed', 'Could not set up your account.');
  }

  // Referral bonus, credited to the inviter only.
  const code = str(body.referredBy, 12).toUpperCase();
  if (code) {
    try {
      const found = await databases.listDocuments(DB, COL.profiles, [
        Query.equal('referralCode', code),
        Query.limit(1),
      ]);
      const inviter = found.documents[0];
      if (inviter && inviter.$id !== user.$id) {
        await databases.updateDocument(DB, COL.profiles, user.$id, {
          referredBy: inviter.$id,
        });
        await award(databases, {
          userId: inviter.$id,
          delta: 25,
          source: 'referral',
          refId: user.$id,
          // One bonus per invited user, forever.
          idempotencyKey: `referral:${inviter.$id}:${user.$id}`,
          note: `Referred ${name}`,
          config,
        });
      }
    } catch (e) {
      console.error('referral failed', e.message);
    }
  }

  const fresh = await databases.getDocument(DB, COL.profiles, user.$id);
  return { profile: fresh, created: true };
}

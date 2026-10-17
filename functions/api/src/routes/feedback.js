import { ID, Query, Permission, Role } from 'node-appwrite';
import { COL, DB, Rejected, nowIso, str } from '../lib/context.js';
import { notify } from '../lib/ledger.js';

/**
 * User feedback.
 *
 * Goes through the function rather than a direct client write for the same
 * reason everything else does: the collection is server-only, so a client
 * cannot forge a `userId` or set its own `status`. The caller is resolved from
 * the JWT.
 */

export const CATEGORIES = [
  'bug',
  'idea',
  'reward_request',
  'verification_dispute',
  'other',
];

const MIN_MESSAGE = 10;
const MAX_MESSAGE = 2000;
const DAILY_LIMIT = 5;

/** Pure so it can be tested without an Appwrite client. */
export function validate({ category, message }) {
  if (!CATEGORIES.includes(category)) {
    return { code: 'invalid_category', message: 'Pick what this is about.' };
  }
  const text = str(message, MAX_MESSAGE);
  if (text.length < MIN_MESSAGE) {
    return {
      code: 'message_too_short',
      message: `Tell us a little more — at least ${MIN_MESSAGE} characters.`,
    };
  }
  return null;
}

export async function submit({ databases, user, body }) {
  const category = str(body.category, 32) || 'other';
  const message = str(body.message, MAX_MESSAGE);

  const invalid = validate({ category, message });
  if (invalid) throw new Rejected(invalid.code, invalid.message);

  // Cheap abuse guard. Counted rather than rate-limited properly because the
  // volume here is tiny and a wrong count costs nothing but a retry tomorrow.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  try {
    const recent = await databases.listDocuments(DB, COL.feedback, [
      Query.equal('userId', user.$id),
      Query.greaterThan('createdAt', since),
      Query.limit(DAILY_LIMIT + 1),
    ]);
    if (recent.documents.length >= DAILY_LIMIT) {
      throw new Rejected(
        'too_many_submissions',
        `Thanks for the enthusiasm. You can send ${DAILY_LIMIT} notes a day — try again tomorrow.`,
      );
    }
  } catch (e) {
    if (e instanceof Rejected) throw e;
    // A failed count must not block a genuine report.
    console.error('feedback rate check failed', e.message);
  }

  const doc = await databases.createDocument(
    DB,
    COL.feedback,
    ID.unique(),
    {
      userId: user.$id,
      category,
      message,
      screenshotFileId: str(body.screenshotFileId, 64),
      refType: str(body.refType, 32),
      refId: str(body.refId, 64),
      appVersion: str(body.appVersion, 32),
      platform: str(body.platform, 16),
      deviceModel: str(body.deviceModel, 96),
      status: 'open',
      adminReply: '',
      createdAt: nowIso(),
    },
    // Readable by its author so the reply can be shown back in-app later.
    [Permission.read(Role.user(user.$id))],
  );

  await notify(databases, {
    userId: user.$id,
    title: 'Thanks for the feedback',
    body:
      category === 'verification_dispute'
        ? 'We will take another look at that submission and get back to you.'
        : 'We read every note that comes in. Thanks for taking the time.',
    type: 'system',
    refId: doc.$id,
  });

  return { feedback: doc };
}

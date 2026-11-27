import { Rejected, num, str } from './context.js';

/**
 * Planting requests: pure rules, no database.
 *
 * A member asks the partner NGO for a place to plant a tree. The NGO answers
 * with a site, a time and a meeting point. The member then confirms or
 * declines. Every rule lives here so it can be tested without Appwrite, and so
 * the user routes and the NGO routes cannot drift apart.
 */

export const STATUSES = ['open', 'scheduled', 'confirmed', 'declined', 'completed', 'cancelled'];

/** Statuses that count towards a member's cap on live requests. */
export const ACTIVE_STATUSES = ['open', 'scheduled', 'confirmed', 'declined'];

export const MAX_ACTIVE = 3;

const MAX_NOTE = 500;
const MAX_ADDRESS = 256;
const MIN_TEXT = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PREFERRED_SPAN_DAYS = 180;
const MAX_MEETING_AHEAD_DAYS = 365;

/** Plain failure value, so callers decide how to surface it. */
const fail = (code, message) => ({ error: { code, message } });

/** A number, or a numeric string, or null when it is absent or not a number. */
function coord(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Reads an optional lat/lng pair.
 *
 * Both or neither: a half-supplied pair is a client bug, and a pin at
 * (0, 0) from a missing value would put a planting site in the ocean.
 */
function readPin(latRaw, lngRaw) {
  const lat = coord(latRaw);
  const lng = coord(lngRaw);
  if (lat === null && lng === null) return { pin: null };
  if (lat === null || lng === null || Number.isNaN(lat) || Number.isNaN(lng)) {
    return fail('invalid_location', 'The map pin is incomplete. Pick the spot again.');
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return fail('invalid_location', 'That map pin is outside the world. Pick the spot again.');
  }
  return { pin: { lat, lng } };
}

function readDate(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? NaN : d;
}

/**
 * Validates a member's request.
 *
 * Returns `{ value }` or `{ error: { code, message } }`. A place is required,
 * either as a pin or as a typed address, because the NGO has to find the person.
 */
export function validateRequest(body = {}, now = new Date()) {
  const located = readPin(body.lat, body.lng);
  if (located.error) return located;

  const addressLabel = str(body.addressLabel, MAX_ADDRESS);
  if (!located.pin && addressLabel.length < MIN_TEXT) {
    return fail('location_required', 'Share your location or type an address so the NGO can find you.');
  }

  const note = str(body.note, MAX_NOTE);

  const from = readDate(body.preferredFrom);
  const to = readDate(body.preferredTo);
  if (Number.isNaN(from) || Number.isNaN(to)) {
    return fail('invalid_dates', 'One of the preferred dates is not a valid date.');
  }
  if (to && to.getTime() < now.getTime() - DAY_MS) {
    return fail('invalid_dates', 'The preferred dates are in the past.');
  }
  if (from && to && to.getTime() < from.getTime()) {
    return fail('invalid_dates', 'The last preferred date comes before the first.');
  }
  if (from && to && to.getTime() - from.getTime() > MAX_PREFERRED_SPAN_DAYS * DAY_MS) {
    return fail('invalid_dates', 'Pick a range of six months or less.');
  }

  return {
    value: {
      lat: located.pin?.lat ?? null,
      lng: located.pin?.lng ?? null,
      addressLabel,
      note,
      preferredFrom: from ? from.toISOString() : null,
      preferredTo: to ? to.toISOString() : null,
    },
  };
}

/**
 * Validates the NGO's reply.
 *
 * The site needs an address a person can read; the pin is optional but, if
 * given, must be a complete pair. The meeting time has to be in the future, or
 * a typo would tell a member to turn up yesterday.
 */
export function validateReply(body = {}, now = new Date()) {
  const siteAddress = str(body.siteAddress, MAX_ADDRESS);
  if (siteAddress.length < MIN_TEXT) {
    return fail('site_required', 'Give the planting site as an address people can find.');
  }

  const located = readPin(body.siteLat, body.siteLng);
  if (located.error) return located;

  const meetingAt = readDate(body.meetingAt);
  if (!meetingAt || Number.isNaN(meetingAt)) {
    return fail('invalid_time', 'Pick a date and time to meet.');
  }
  if (meetingAt.getTime() <= now.getTime()) {
    return fail('invalid_time', 'The meeting time has to be in the future.');
  }
  if (meetingAt.getTime() - now.getTime() > MAX_MEETING_AHEAD_DAYS * DAY_MS) {
    return fail('invalid_time', 'That meeting time is more than a year away.');
  }

  const meetingPoint = str(body.meetingPoint, MAX_ADDRESS);
  if (meetingPoint.length < MIN_TEXT) {
    return fail('meeting_point_required', 'Say where to meet, for example "main gate of the park".');
  }

  return {
    value: {
      siteAddress,
      siteLat: located.pin?.lat ?? null,
      siteLng: located.pin?.lng ?? null,
      meetingAt: meetingAt.toISOString(),
      meetingPoint,
      replyNotes: str(body.replyNotes, MAX_NOTE),
    },
  };
}

/**
 * Every legal move of a request, in one place.
 *
 *   open ──reply──▶ scheduled ──accept──▶ confirmed ──complete──▶ completed
 *                      │  ▲                  
 *                  decline │ reply
 *                      ▼  │
 *                    declined
 *
 * `cancel` is the member's way out while nothing is confirmed. A confirmed
 * request is not cancellable here: the NGO is expecting them, so that
 * conversation happens off-app.
 */
export const TRANSITIONS = {
  reply: { from: ['open', 'scheduled', 'declined'], to: 'scheduled' },
  accept: { from: ['scheduled'], to: 'confirmed' },
  decline: { from: ['scheduled'], to: 'declined' },
  complete: { from: ['confirmed'], to: 'completed' },
  cancel: { from: ['open', 'scheduled', 'declined'], to: 'cancelled' },
};

/** Returns the next status, or throws Rejected when the move is not allowed. */
export function transition(status, action) {
  const rule = TRANSITIONS[action];
  if (!rule) throw new Rejected('bad_request', 'Unknown action.');
  if (!rule.from.includes(status)) {
    throw new Rejected(
      'invalid_state',
      `This request is ${status}, so that is not possible right now.`,
    );
  }
  return rule.to;
}

const PUBLIC_FIELDS = [
  'status',
  'userName',
  'lat',
  'lng',
  'addressLabel',
  'note',
  'preferredFrom',
  'preferredTo',
  'siteLat',
  'siteLng',
  'siteAddress',
  'meetingAt',
  'meetingPoint',
  'replyNotes',
  'repliedAt',
  'userResponse',
  'respondedAt',
  'createdAt',
  'updatedAt',
];

/**
 * What leaves the server about a request.
 *
 * An allow-list, so a field added to the collection later stays private until
 * someone decides otherwise. `userId` and `repliedBy` are left out on purpose:
 * neither the member nor the NGO needs the other side's account id.
 */
export function view(doc) {
  const out = { id: doc.$id };
  for (const key of PUBLIC_FIELDS) {
    if (doc[key] !== undefined) out[key] = doc[key];
  }
  return out;
}

/** Parses the paging inputs of the NGO inbox. */
export function readPaging(body = {}) {
  const limit = Math.min(50, Math.max(1, Math.round(num(body.limit, 25))));
  const status = str(body.status, 16);
  if (status && !STATUSES.includes(status)) {
    throw new Rejected('bad_request', `"${status}" is not a request status.`);
  }
  const cursor = str(body.cursor, 64);
  return { limit, status, cursor };
}

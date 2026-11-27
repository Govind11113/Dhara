import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTIVE_STATUSES,
  STATUSES,
  TRANSITIONS,
  readPaging,
  transition,
  validateReply,
  validateRequest,
  view,
} from './planting.js';
import { Rejected } from './context.js';

const NOW = new Date('2026-11-27T10:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const inDays = (n) => new Date(NOW.getTime() + n * DAY).toISOString();

// --- validateRequest ---------------------------------------------------------

test('a pin alone is enough to request', () => {
  const r = validateRequest({ lat: 12.97, lng: 77.59 }, NOW);
  assert.equal(r.error, undefined);
  assert.equal(r.value.lat, 12.97);
  assert.equal(r.value.lng, 77.59);
});

test('a typed address alone is enough to request', () => {
  const r = validateRequest({ addressLabel: '12 MG Road, Pune' }, NOW);
  assert.equal(r.error, undefined);
  assert.equal(r.value.lat, null);
});

test('no pin and no address is refused', () => {
  assert.equal(validateRequest({}, NOW).error.code, 'location_required');
  assert.equal(validateRequest({ addressLabel: ' a ' }, NOW).error.code, 'location_required');
});

test('a half-supplied pin is refused rather than guessed', () => {
  assert.equal(validateRequest({ lat: 12.9 }, NOW).error.code, 'invalid_location');
  assert.equal(validateRequest({ lat: 12.9, lng: 'abc' }, NOW).error.code, 'invalid_location');
});

test('coordinates outside the globe are refused', () => {
  assert.equal(validateRequest({ lat: 91, lng: 0 }, NOW).error.code, 'invalid_location');
  assert.equal(validateRequest({ lat: 0, lng: -181 }, NOW).error.code, 'invalid_location');
});

test('the note is trimmed and capped', () => {
  const r = validateRequest({ addressLabel: 'Somewhere', note: `  ${'x'.repeat(900)}  ` }, NOW);
  assert.equal(r.value.note.length, 500);
});

test('preferred dates must be real, ordered and not in the past', () => {
  const base = { addressLabel: 'Somewhere' };
  assert.equal(validateRequest({ ...base, preferredFrom: 'soon' }, NOW).error.code, 'invalid_dates');
  assert.equal(
    validateRequest({ ...base, preferredFrom: inDays(5), preferredTo: inDays(2) }, NOW).error.code,
    'invalid_dates',
  );
  assert.equal(validateRequest({ ...base, preferredTo: inDays(-10) }, NOW).error.code, 'invalid_dates');
  assert.equal(
    validateRequest({ ...base, preferredFrom: inDays(1), preferredTo: inDays(400) }, NOW).error.code,
    'invalid_dates',
  );
  const ok = validateRequest({ ...base, preferredFrom: inDays(1), preferredTo: inDays(10) }, NOW);
  assert.equal(ok.error, undefined);
  assert.equal(ok.value.preferredFrom, inDays(1));
});

// --- validateReply -----------------------------------------------------------

const goodReply = {
  siteAddress: 'Cubbon Park, near the bandstand',
  siteLat: 12.976,
  siteLng: 77.592,
  meetingAt: inDays(3),
  meetingPoint: 'Main gate',
  replyNotes: 'Bring water',
};

test('a complete reply is accepted', () => {
  const r = validateReply(goodReply, NOW);
  assert.equal(r.error, undefined);
  assert.equal(r.value.meetingAt, inDays(3));
  assert.equal(r.value.siteLat, 12.976);
});

test('a reply without a pin is accepted, but a half pin is not', () => {
  const { siteLat, siteLng, ...noPin } = goodReply;
  assert.equal(validateReply(noPin, NOW).value.siteLat, null);
  assert.equal(validateReply({ ...noPin, siteLat: 12 }, NOW).error.code, 'invalid_location');
});

test('a reply needs a site, a meeting point and a future time', () => {
  assert.equal(validateReply({ ...goodReply, siteAddress: '' }, NOW).error.code, 'site_required');
  assert.equal(validateReply({ ...goodReply, meetingPoint: '' }, NOW).error.code, 'meeting_point_required');
  assert.equal(validateReply({ ...goodReply, meetingAt: undefined }, NOW).error.code, 'invalid_time');
  assert.equal(validateReply({ ...goodReply, meetingAt: 'tomorrow' }, NOW).error.code, 'invalid_time');
  assert.equal(validateReply({ ...goodReply, meetingAt: inDays(-1) }, NOW).error.code, 'invalid_time');
  assert.equal(validateReply({ ...goodReply, meetingAt: inDays(400) }, NOW).error.code, 'invalid_time');
});

// --- transitions -------------------------------------------------------------

test('the happy path runs open to completed', () => {
  assert.equal(transition('open', 'reply'), 'scheduled');
  assert.equal(transition('scheduled', 'accept'), 'confirmed');
  assert.equal(transition('confirmed', 'complete'), 'completed');
});

test('a declined request can be rescheduled', () => {
  assert.equal(transition('scheduled', 'decline'), 'declined');
  assert.equal(transition('declined', 'reply'), 'scheduled');
});

test('the NGO can change a slot the member has not answered yet', () => {
  assert.equal(transition('scheduled', 'reply'), 'scheduled');
});

test('every action is refused from every status it does not list', () => {
  for (const [action, rule] of Object.entries(TRANSITIONS)) {
    for (const status of STATUSES) {
      if (rule.from.includes(status)) continue;
      assert.throws(
        () => transition(status, action),
        (e) => e instanceof Rejected && e.code === 'invalid_state',
        `${action} from ${status} should be refused`,
      );
    }
  }
});

test('finished requests cannot move at all', () => {
  for (const status of ['completed', 'cancelled']) {
    for (const action of Object.keys(TRANSITIONS)) {
      assert.throws(() => transition(status, action), Rejected);
    }
  }
});

test('a confirmed request cannot be cancelled or answered again from the app', () => {
  assert.throws(() => transition('confirmed', 'cancel'), Rejected);
  assert.throws(() => transition('confirmed', 'decline'), Rejected);
  assert.throws(() => transition('confirmed', 'accept'), Rejected);
});

test('an unknown action is a bad request', () => {
  assert.throws(
    () => transition('open', 'explode'),
    (e) => e instanceof Rejected && e.code === 'bad_request',
  );
});

test('active statuses are exactly the ones still in play', () => {
  assert.deepEqual([...ACTIVE_STATUSES].sort(), ['confirmed', 'declined', 'open', 'scheduled']);
});

// --- view / paging -----------------------------------------------------------

test('view keeps ids of accounts and Appwrite internals off the wire', () => {
  const out = view({
    $id: 'r1',
    $permissions: ['read("user:u1")'],
    userId: 'u1',
    repliedBy: 'ngo1',
    geohash: 'abc',
    userName: 'Asha',
    status: 'open',
  });
  assert.deepEqual(out, { id: 'r1', status: 'open', userName: 'Asha' });
});

test('paging clamps the limit and rejects an unknown status', () => {
  assert.equal(readPaging({ limit: 9999 }).limit, 50);
  assert.equal(readPaging({ limit: -3 }).limit, 1);
  assert.equal(readPaging({}).limit, 25);
  assert.equal(readPaging({ status: 'open' }).status, 'open');
  assert.throws(() => readPaging({ status: 'nonsense' }), Rejected);
});

import { describe, expect, it } from 'vitest';

import {
  EMPTY_REPLY,
  checkReplyForm,
  formFromRequest,
  fromLocalInput,
  toLocalInput,
} from './planting';

describe('local time conversion', () => {
  it('round-trips through a datetime-local value', () => {
    const iso = '2026-12-05T04:30:00.000Z';
    expect(fromLocalInput(toLocalInput(iso))).toBe(iso);
  });

  it('treats empty and invalid values as no time', () => {
    expect(toLocalInput(undefined)).toBe('');
    expect(toLocalInput('nope')).toBe('');
    expect(fromLocalInput('')).toBeNull();
    expect(fromLocalInput('not a date')).toBeNull();
  });
});

describe('checkReplyForm', () => {
  const now = new Date('2026-11-27T10:00:00.000Z');
  const future = toLocalInput('2026-12-01T09:00:00.000Z');
  const good = {
    siteAddress: 'Cubbon Park, near the bandstand',
    meetingAt: future,
    meetingPoint: 'Main gate',
    replyNotes: ' Bring water ',
  };

  it('builds the payload the server expects', () => {
    const r = checkReplyForm(good, now);
    expect('payload' in r).toBe(true);
    if ('payload' in r) {
      expect(r.payload).toEqual({
        siteAddress: 'Cubbon Park, near the bandstand',
        meetingAt: '2026-12-01T09:00:00.000Z',
        meetingPoint: 'Main gate',
        replyNotes: 'Bring water',
      });
    }
  });

  it('sends the address only, with no map pin', () => {
    const r = checkReplyForm(good, now);
    expect('payload' in r && 'siteLat' in r.payload).toBe(false);
  });

  it('says what is wrong, one thing at a time', () => {
    const msg = (patch: Partial<typeof good>) => {
      const r = checkReplyForm({ ...good, ...patch }, now);
      return 'error' in r ? r.error : '';
    };
    expect(msg({ siteAddress: ' ' })).toMatch(/planting site/);
    expect(msg({ meetingAt: '' })).toMatch(/date and time/);
    expect(msg({ meetingAt: toLocalInput('2026-11-20T09:00:00.000Z') })).toMatch(/future/);
    expect(msg({ meetingPoint: '' })).toMatch(/where to meet/);
  });
});

describe('formFromRequest', () => {
  it('starts a new slot from the earlier reply but without its time', () => {
    const f = formFromRequest({ siteAddress: 'Cubbon Park', meetingPoint: 'Main gate', replyNotes: 'Bring water' });
    expect(f.siteAddress).toBe('Cubbon Park');
    expect(f.meetingAt).toBe('');
    expect(f.meetingPoint).toBe('Main gate');
  });

  it('copes with an empty request', () => {
    expect(formFromRequest({})).toEqual(EMPTY_REPLY);
  });
});

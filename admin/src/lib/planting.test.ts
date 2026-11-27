import { describe, expect, it } from 'vitest';

import {
  EMPTY_REPLY,
  checkReplyForm,
  formFromRequest,
  fromLocalInput,
  parseMapLink,
  toLocalInput,
} from './planting';

describe('parseMapLink', () => {
  it('reads a plain pair', () => {
    expect(parseMapLink('12.9716, 77.5946')).toEqual({ lat: 12.9716, lng: 77.5946 });
    expect(parseMapLink(' -33.86,151.21 ')).toEqual({ lat: -33.86, lng: 151.21 });
  });

  it('reads Google Maps links', () => {
    expect(parseMapLink('https://www.google.com/maps/place/Cubbon+Park/@12.9763,77.5929,17z/data=x')).toEqual({
      lat: 12.9763,
      lng: 77.5929,
    });
    expect(parseMapLink('https://www.google.com/maps/place/x/data=!3d12.9763!4d77.5929')).toEqual({
      lat: 12.9763,
      lng: 77.5929,
    });
    expect(parseMapLink('https://maps.google.com/?q=12.9763,77.5929')).toEqual({ lat: 12.9763, lng: 77.5929 });
  });

  it('reads OpenStreetMap links', () => {
    expect(parseMapLink('https://www.openstreetmap.org/?mlat=12.97&mlon=77.59#map=18/12.97/77.59')).toEqual({
      lat: 12.97,
      lng: 77.59,
    });
    expect(parseMapLink('https://www.openstreetmap.org/#map=17/18.52/73.85')).toEqual({ lat: 18.52, lng: 73.85 });
  });

  it('refuses text with no usable coordinates', () => {
    expect(parseMapLink('')).toBeNull();
    expect(parseMapLink('Cubbon Park')).toBeNull();
    expect(parseMapLink('https://maps.app.goo.gl/abc123')).toBeNull();
  });

  it('refuses coordinates outside the globe', () => {
    expect(parseMapLink('91, 10')).toBeNull();
    expect(parseMapLink('10, 181')).toBeNull();
  });
});

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
    mapLink: '12.9763, 77.5929',
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
        siteLat: 12.9763,
        siteLng: 77.5929,
        meetingAt: '2026-12-01T09:00:00.000Z',
        meetingPoint: 'Main gate',
        replyNotes: 'Bring water',
      });
    }
  });

  it('leaves the pin out when no link is given', () => {
    const r = checkReplyForm({ ...good, mapLink: '' }, now);
    expect('payload' in r && 'siteLat' in r.payload).toBe(false);
  });

  it('says what is wrong, one thing at a time', () => {
    const msg = (patch: Partial<typeof good>) => {
      const r = checkReplyForm({ ...good, ...patch }, now);
      return 'error' in r ? r.error : '';
    };
    expect(msg({ siteAddress: ' ' })).toMatch(/planting site/);
    expect(msg({ mapLink: 'somewhere nice' })).toMatch(/map link/);
    expect(msg({ meetingAt: '' })).toMatch(/date and time/);
    expect(msg({ meetingAt: toLocalInput('2026-11-20T09:00:00.000Z') })).toMatch(/future/);
    expect(msg({ meetingPoint: '' })).toMatch(/where to meet/);
  });
});

describe('formFromRequest', () => {
  it('starts a new slot from the earlier reply but without its time', () => {
    const f = formFromRequest({
      siteAddress: 'Cubbon Park',
      siteLat: 12.97,
      siteLng: 77.59,
      meetingPoint: 'Main gate',
      replyNotes: 'Bring water',
    });
    expect(f.siteAddress).toBe('Cubbon Park');
    expect(f.mapLink).toBe('12.97, 77.59');
    expect(f.meetingAt).toBe('');
    expect(f.meetingPoint).toBe('Main gate');
  });

  it('copes with an empty request', () => {
    expect(formFromRequest({})).toEqual(EMPTY_REPLY);
  });
});

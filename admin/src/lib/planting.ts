/**
 * Pure helpers for the planting-requests page. Tested in planting.test.ts.
 *
 * The server validates everything again; this exists so the NGO hears about a
 * typo before the round trip, in words they can act on.
 */

export const STATUS_FILTERS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'open', label: 'Waiting for a reply' },
  { value: 'scheduled', label: 'Scheduled, awaiting member' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'declined', label: 'Declined, needs a new time' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: '', label: 'Everything' },
];

export interface Pin {
  lat: number;
  lng: number;
}

function validPin(lat: number, lng: number): Pin | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/**
 * Reads a coordinate pair out of what a person pastes from a maps app.
 *
 * Accepts "12.97, 77.59", a Google Maps link ("@lat,lng", "!3dlat!4dlng",
 * "?q=lat,lng"), and an OpenStreetMap link ("mlat=&mlon=" or "#map=z/lat/lng").
 * Returns null for anything else, including a short link that only the maps
 * app can expand.
 */
export function parseMapLink(text: string): Pin | null {
  const s = text.trim();
  if (!s) return null;

  const num = '(-?\\d{1,3}(?:\\.\\d+)?)';
  const patterns: RegExp[] = [
    new RegExp(`^${num}\\s*,\\s*${num}$`),
    new RegExp(`!3d${num}!4d${num}`),
    new RegExp(`@${num},${num}`),
    new RegExp(`[?&](?:q|ll|query|destination)=${num}(?:,|%2C)\\s*${num}`),
    new RegExp(`mlat=${num}&mlon=${num}`),
    new RegExp(`#map=\\d+/${num}/${num}`),
  ];

  for (const re of patterns) {
    const m = re.exec(s);
    if (m) return validPin(Number(m[1]), Number(m[2]));
  }
  return null;
}

/** An ISO time as the value a datetime-local input wants, in the viewer's zone. */
export function toLocalInput(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** What a datetime-local input holds, as an ISO instant. Null when it is empty or invalid. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export interface ReplyForm {
  siteAddress: string;
  /** A pasted maps link or "lat, lng". Optional. */
  mapLink: string;
  /** The value of a datetime-local input. */
  meetingAt: string;
  meetingPoint: string;
  replyNotes: string;
}

export const EMPTY_REPLY: ReplyForm = {
  siteAddress: '',
  mapLink: '',
  meetingAt: '',
  meetingPoint: '',
  replyNotes: '',
};

export interface ReplyPayload {
  siteAddress: string;
  siteLat?: number;
  siteLng?: number;
  meetingAt: string;
  meetingPoint: string;
  replyNotes: string;
}

export type ReplyCheck = { error: string } | { payload: ReplyPayload };

export function checkReplyForm(form: ReplyForm, now: Date = new Date()): ReplyCheck {
  const siteAddress = form.siteAddress.trim();
  if (siteAddress.length < 3) return { error: 'Give the planting site as an address people can find.' };

  let pin: Pin | null = null;
  if (form.mapLink.trim()) {
    pin = parseMapLink(form.mapLink);
    if (!pin) {
      return {
        error: 'That map link could not be read. Paste the full link, or the pin as "latitude, longitude".',
      };
    }
  }

  const meetingAt = fromLocalInput(form.meetingAt);
  if (!meetingAt) return { error: 'Pick a date and time to meet.' };
  if (new Date(meetingAt).getTime() <= now.getTime()) return { error: 'The meeting time has to be in the future.' };

  const meetingPoint = form.meetingPoint.trim();
  if (meetingPoint.length < 3) return { error: 'Say where to meet, for example "main gate of the park".' };

  return {
    payload: {
      siteAddress,
      ...(pin ? { siteLat: pin.lat, siteLng: pin.lng } : {}),
      meetingAt,
      meetingPoint,
      replyNotes: form.replyNotes.trim(),
    },
  };
}

/** A form pre-filled from an earlier reply, so a new slot starts from what was sent. */
export function formFromRequest(r: {
  siteAddress?: string;
  siteLat?: number;
  siteLng?: number;
  meetingPoint?: string;
  replyNotes?: string;
}): ReplyForm {
  const hasPin = typeof r.siteLat === 'number' && typeof r.siteLng === 'number';
  return {
    siteAddress: r.siteAddress ?? '',
    mapLink: hasPin ? `${r.siteLat}, ${r.siteLng}` : '',
    // The time is left empty: a declined slot is exactly the one to replace.
    meetingAt: '',
    meetingPoint: r.meetingPoint ?? '',
    replyNotes: r.replyNotes ?? '',
  };
}

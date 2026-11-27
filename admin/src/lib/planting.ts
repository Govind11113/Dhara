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
  /** The value of a datetime-local input. */
  meetingAt: string;
  meetingPoint: string;
  replyNotes: string;
}

export const EMPTY_REPLY: ReplyForm = {
  siteAddress: '',
  meetingAt: '',
  meetingPoint: '',
  replyNotes: '',
};

export interface ReplyPayload {
  siteAddress: string;
  meetingAt: string;
  meetingPoint: string;
  replyNotes: string;
}

export type ReplyCheck = { error: string } | { payload: ReplyPayload };

export function checkReplyForm(form: ReplyForm, now: Date = new Date()): ReplyCheck {
  const siteAddress = form.siteAddress.trim();
  if (siteAddress.length < 3) return { error: 'Give the planting site as an address people can find.' };

  const meetingAt = fromLocalInput(form.meetingAt);
  if (!meetingAt) return { error: 'Pick a date and time to meet.' };
  if (new Date(meetingAt).getTime() <= now.getTime()) return { error: 'The meeting time has to be in the future.' };

  const meetingPoint = form.meetingPoint.trim();
  if (meetingPoint.length < 3) return { error: 'Say where to meet, for example "main gate of the park".' };

  return {
    payload: {
      siteAddress,
      meetingAt,
      meetingPoint,
      replyNotes: form.replyNotes.trim(),
    },
  };
}

/** A form pre-filled from an earlier reply, so a new slot starts from what was sent. */
export function formFromRequest(r: {
  siteAddress?: string;
  meetingPoint?: string;
  replyNotes?: string;
}): ReplyForm {
  return {
    siteAddress: r.siteAddress ?? '',
    // The time is left empty: a declined slot is exactly the one to replace.
    meetingAt: '',
    meetingPoint: r.meetingPoint ?? '',
    replyNotes: r.replyNotes ?? '',
  };
}

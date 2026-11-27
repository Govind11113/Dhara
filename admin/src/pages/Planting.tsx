import { useCallback, useEffect, useState } from 'react';

import { messageOf } from '../lib/api';
import { api } from '../lib/appwrite';
import { formatDate, mapsUrl, timeAgo } from '../lib/format';
import {
  EMPTY_REPLY,
  STATUS_FILTERS,
  checkReplyForm,
  formFromRequest,
  type ReplyForm,
} from '../lib/planting';
import type { PlantingPage, PlantingRequest } from '../lib/types';
import { Empty, ErrorBox, PageHeader, Pill, Spinner, useToast } from '../ui';

export function Planting() {
  const [status, setStatus] = useState('open');
  const [items, setItems] = useState<PlantingRequest[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Loads the first page, replacing what is shown. Used on mount, on a filter
  // change and after any action, so the list never shows a stale status.
  const loadFirst = useCallback(async (filter: string, isCurrent: () => boolean) => {
    setLoading(true);
    setError(null);
    try {
      const page = await api.call<PlantingPage>('/ngo/requests', { status: filter, limit: 25 });
      if (!isCurrent()) return;
      setItems(page.requests);
      setCursor(page.nextCursor);
    } catch (e) {
      if (isCurrent()) setError(messageOf(e));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let current = true;
    void loadFirst(status, () => current);
    return () => {
      current = false;
    };
  }, [status, loadFirst]);

  const reload = useCallback(() => {
    void loadFirst(status, () => true);
  }, [status, loadFirst]);

  async function more() {
    if (!cursor) return;
    setLoading(true);
    try {
      const page = await api.call<PlantingPage>('/ngo/requests', { status, limit: 25, cursor });
      setItems((prev) => [...prev, ...page.requests]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageHeader title="Planting requests" />
      <p className="muted">
        Members ask for a place to plant a tree. Reply with a site, a time and a meeting point, and they will see it in
        the app.
      </p>

      <div className="filters">
        <label htmlFor="pl-status">Show</label>
        <select id="pl-status" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS_FILTERS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && items.length === 0 && !error && <Spinner label="Loading requests" />}
      {!loading && !error && items.length === 0 && (
        <Empty title="Nothing here." hint="New requests from the app show up as Waiting for a reply." />
      )}

      <ul className="cards">
        {items.map((r) => (
          <RequestCard key={r.id} item={r} onChanged={reload} />
        ))}
      </ul>

      {cursor && (
        <div className="actions">
          <button type="button" className="btn" disabled={loading} onClick={() => void more()}>
            {loading ? 'Loading…' : 'Show more'}
          </button>
        </div>
      )}
    </>
  );
}

function when(from?: string, to?: string): string {
  if (from && to) return `${formatDate(from)} to ${formatDate(to)}`;
  if (from) return `From ${formatDate(from)}`;
  if (to) return `By ${formatDate(to)}`;
  return 'No preference';
}

const ANSWER: Record<string, string> = {
  accepted: 'Will come',
  declined: 'Cannot make it',
};

export function RequestCard({ item, onChanged }: { item: PlantingRequest; onChanged(): void }) {
  const toast = useToast();
  const [replying, setReplying] = useState(false);
  const [busy, setBusy] = useState(false);

  const memberPin = mapsUrl(item.lat, item.lng);
  const sitePin = mapsUrl(item.siteLat, item.siteLng);
  const canReply = item.status === 'open' || item.status === 'scheduled' || item.status === 'declined';

  async function complete() {
    setBusy(true);
    try {
      await api.call('/ngo/complete', { id: item.id });
      toast('Marked as completed. The member has been told.');
      onChanged();
    } catch (e) {
      toast(messageOf(e), true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="card">
      <div className="review-head">
        <h2>{item.userName || 'A member'}</h2>
        <Pill value={item.status} />
        <span className="muted">{timeAgo(item.createdAt)}</span>
      </div>

      {item.note && <p className="message">{item.note}</p>}

      <dl className="facts">
        <dt>Member is at</dt>
        <dd>
          {item.addressLabel || (memberPin ? 'Shared a map pin' : '—')}
          {memberPin && (
            <>
              {' '}
              <a href={memberPin} target="_blank" rel="noreferrer">
                Open map
              </a>
            </>
          )}
        </dd>
        <dt>Would like</dt>
        <dd>{when(item.preferredFrom, item.preferredTo)}</dd>

        {item.siteAddress && (
          <>
            <dt>Planting site</dt>
            <dd>
              {item.siteAddress}
              {sitePin && (
                <>
                  {' '}
                  <a href={sitePin} target="_blank" rel="noreferrer">
                    Open map
                  </a>
                </>
              )}
            </dd>
            <dt>Meeting</dt>
            <dd>
              {formatDate(item.meetingAt)} at {item.meetingPoint}
            </dd>
            {item.replyNotes && (
              <>
                <dt>Notes sent</dt>
                <dd>{item.replyNotes}</dd>
              </>
            )}
          </>
        )}
        {item.userResponse && (
          <>
            <dt>Member's answer</dt>
            <dd>
              {ANSWER[item.userResponse] ?? item.userResponse} · {timeAgo(item.respondedAt)}
            </dd>
          </>
        )}
      </dl>

      {replying ? (
        <ReplyFormView
          item={item}
          onDone={() => {
            setReplying(false);
            onChanged();
          }}
          onCancel={() => setReplying(false)}
        />
      ) : (
        <div className="actions">
          {canReply && (
            <button type="button" className="btn btn-primary" onClick={() => setReplying(true)}>
              {item.status === 'open' ? 'Reply with a place and time' : 'Propose a new time'}
            </button>
          )}
          {item.status === 'confirmed' && (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void complete()}>
              {busy ? 'Saving…' : 'Mark as completed'}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function ReplyFormView({
  item,
  onDone,
  onCancel,
}: {
  item: PlantingRequest;
  onDone(): void;
  onCancel(): void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<ReplyForm>(() => (item.siteAddress ? formFromRequest(item) : EMPTY_REPLY));
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof ReplyForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;

    const checked = checkReplyForm(form);
    if ('error' in checked) {
      setProblem(checked.error);
      return;
    }

    setProblem(null);
    setBusy(true);
    try {
      await api.call('/ngo/reply', { id: item.id, ...checked.payload });
      toast('Reply sent. The member has been notified.');
      onDone();
    } catch (err) {
      setProblem(messageOf(err));
      setBusy(false);
    }
  }

  const id = `reply-${item.id}`;

  return (
    <form onSubmit={submit} aria-label="Reply to request">
      {problem && (
        <div className="error-box" role="alert">
          {problem}
        </div>
      )}

      <label htmlFor={`${id}-site`}>Planting site address</label>
      <input
        id={`${id}-site`}
        className="wide"
        maxLength={256}
        value={form.siteAddress}
        onChange={set('siteAddress')}
        required
      />

      <label htmlFor={`${id}-time`}>Date and time to meet</label>
      <input id={`${id}-time`} type="datetime-local" value={form.meetingAt} onChange={set('meetingAt')} required />

      <label htmlFor={`${id}-point`}>Meeting point</label>
      <input
        id={`${id}-point`}
        className="wide"
        maxLength={256}
        placeholder="For example: main gate of the park"
        value={form.meetingPoint}
        onChange={set('meetingPoint')}
        required
      />

      <label htmlFor={`${id}-notes`}>Notes for the member (optional)</label>
      <textarea id={`${id}-notes`} rows={3} maxLength={500} value={form.replyNotes} onChange={set('replyNotes')} />

      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Sending…' : 'Send reply'}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

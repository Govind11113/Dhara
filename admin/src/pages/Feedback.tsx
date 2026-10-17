import { useState } from 'react';

import { PAGE_SIZE, useList } from '../hooks';
import { api } from '../lib/appwrite';
import { messageOf } from '../lib/api';
import { humanise, timeAgo } from '../lib/format';
import type { Feedback as FeedbackItem } from '../lib/types';
import { Empty, ErrorBox, PageHeader, Pager, PhotoButton, Pill, Spinner, useToast } from '../ui';

const STATUSES = ['open', 'triaged', 'answered', 'closed', ''];
const CATEGORY: Record<string, string> = {
  bug: 'Something is broken',
  idea: 'Idea',
  reward_request: 'Reward suggestion',
  verification_dispute: 'Photo wrongly rejected',
  other: 'Something else',
};

export function Feedback() {
  const [status, setStatus] = useState('open');
  const [offset, setOffset] = useState(0);
  const { data, error, loading, reload } = useList<FeedbackItem>({
    list: 'feedback',
    filters: status ? { status } : {},
    offset,
  });

  return (
    <>
      <PageHeader title="Feedback" />
      <div className="filters">
        <label htmlFor="fb-status">Show</label>
        <select id="fb-status" value={status} onChange={(e) => { setOffset(0); setStatus(e.target.value); }}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s ? humanise(s) : 'Everything'}
            </option>
          ))}
        </select>
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Spinner label="Loading feedback" />}
      {data && data.items.length === 0 && <Empty title="Nothing here." hint="New feedback from the app shows up as Open." />}

      <ul className="cards">
        {data?.items.map((f) => (
          <FeedbackCard key={f.$id} item={f} onSaved={reload} />
        ))}
      </ul>

      {data && <Pager offset={offset} limit={PAGE_SIZE} total={data.total} onChange={setOffset} />}
    </>
  );
}

function FeedbackCard({ item, onSaved }: { item: FeedbackItem; onSaved(): void }) {
  const toast = useToast();
  const [reply, setReply] = useState(item.adminReply ?? '');
  const [busy, setBusy] = useState(false);

  async function send(status: 'answered' | 'triaged' | 'closed') {
    setBusy(true);
    try {
      await api.call('/admin/feedback/reply', { id: item.$id, reply: reply.trim(), status });
      toast(status === 'answered' ? 'Reply sent. The member has been notified.' : `Marked ${humanise(status).toLowerCase()}.`);
      onSaved();
    } catch (e) {
      toast(messageOf(e), true);
    } finally {
      setBusy(false);
    }
  }

  const device = [item.deviceModel, item.platform, item.appVersion && `app ${item.appVersion}`].filter(Boolean).join(' · ');

  return (
    <li className="card">
      <div className="review-head">
        <h2>{CATEGORY[item.category] ?? humanise(item.category)}</h2>
        <Pill value={item.status} />
        <span className="muted">{timeAgo(item.createdAt)}</span>
      </div>

      <p className="message">{item.message}</p>

      <dl className="facts">
        <dt>Member</dt>
        <dd className="mono" title={item.userId}>{item.userId}</dd>
        {device && (
          <>
            <dt>Device</dt>
            <dd>{device}</dd>
          </>
        )}
        {item.refType && (
          <>
            <dt>About</dt>
            <dd>{item.refType} {item.refId}</dd>
          </>
        )}
        {item.screenshotFileId && (
          <>
            <dt>Attachment</dt>
            <dd><PhotoButton bucketId="feedback_media" fileId={item.screenshotFileId} label="Feedback attachment" /></dd>
          </>
        )}
      </dl>

      <label htmlFor={`reply-${item.$id}`}>Your reply (the member sees this in the app)</label>
      <textarea id={`reply-${item.$id}`} rows={3} maxLength={1000} value={reply} onChange={(e) => setReply(e.target.value)} />

      <div className="actions">
        <button type="button" className="btn btn-primary" disabled={busy || reply.trim().length < 3} onClick={() => send('answered')}>
          Send reply
        </button>
        {item.status === 'open' && (
          <button type="button" className="btn" disabled={busy} onClick={() => send('triaged')}>
            Mark as being looked at
          </button>
        )}
        {item.status !== 'closed' && (
          <button type="button" className="btn" disabled={busy} onClick={() => send('closed')}>
            Close
          </button>
        )}
      </div>
    </li>
  );
}

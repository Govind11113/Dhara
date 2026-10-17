import { useState } from 'react';

import { api } from '../lib/appwrite';
import { messageOf } from '../lib/api';
import { explainReasons, explainVerdict, mapsUrl, percent, timeAgo } from '../lib/format';
import type { QueueItem, QueueResult } from '../lib/types';
import { Empty, ErrorBox, PageHeader, Photo, Pill, ReasonDialog, Spinner, useLoad, useToast } from '../ui';

interface DecideResult {
  credits: number;
}

export function Queue() {
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => api.call<QueueResult>('/admin/queue'), []);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<QueueItem | null>(null);

  const items = (data?.items ?? []).filter((i) => !gone.has(i.id));

  async function decide(item: QueueItem, decision: 'approve' | 'reject', reason = '') {
    setBusy(item.id);
    try {
      const out = await api.call<DecideResult>('/admin/review/decide', {
        kind: item.kind,
        id: item.id,
        decision,
        reason,
      });
      setGone((g) => new Set(g).add(item.id));
      toast(
        decision === 'approve'
          ? out.credits > 0
            ? `Approved. ${out.credits} credits paid to ${item.userName || 'the member'}.`
            : 'Approved. No new credits (already paid).'
          : 'Rejected. The member has been told why.',
      );
    } catch (e) {
      toast(messageOf(e), true);
      // Something changed under us (another admin, or it was decided already).
      reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader title="Review queue">
        <button type="button" className="btn" onClick={() => { setGone(new Set()); reload(); }} disabled={loading}>
          Refresh
        </button>
      </PageHeader>

      <p className="muted lead">
        Submissions held for a person to look at. Approving pays the credits through the normal ledger, so it
        cannot pay twice.
      </p>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Spinner label="Loading the queue" />}
      {data && items.length === 0 && <Empty title="Nothing waiting." hint="New held submissions appear here." />}

      <ul className="cards">
        {items.map((item) => (
          <li key={item.id} className="card review">
            <div className="review-photo">
              <Photo fileId={item.photoFileId} alt={`Photo for ${item.title}`} />
            </div>

            <div className="review-body">
              <div className="review-head">
                <h2>{item.title}</h2>
                <Pill value={item.kind === 'tree' ? 'new tree' : 'check-in'} tone="info" />
                <span className="muted">{timeAgo(item.createdAt)}</span>
              </div>

              <p className="who">
                <strong>{item.userName || 'Unknown member'}</strong>
                {item.userEmail && <span className="muted"> · {item.userEmail}</span>}
                {item.trustScore !== null && (
                  <span className={item.trustScore < 60 ? 'bad' : 'muted'}> · trust {item.trustScore}</span>
                )}
              </p>

              {item.isBanned && (
                <div className="error-box" role="alert">
                  This account is suspended. Approving will fail until you restore it on the Users page.
                </div>
              )}

              <AiPanel item={item} />

              <dl className="facts">
                {item.reason && (
                  <>
                    <dt>Held because</dt>
                    <dd>{explainReasons(item.reason).join('. ')}</dd>
                  </>
                )}
                {typeof item.accuracyM === 'number' && (
                  <>
                    <dt>GPS accuracy</dt>
                    <dd>±{Math.round(item.accuracyM)} m</dd>
                  </>
                )}
                {typeof item.distanceM === 'number' && (
                  <>
                    <dt>Distance from tree</dt>
                    <dd>{Math.round(item.distanceM)} m</dd>
                  </>
                )}
                {item.addressLabel && (
                  <>
                    <dt>Place</dt>
                    <dd>{item.addressLabel}</dd>
                  </>
                )}
                {mapsUrl(item.lat, item.lng) && (
                  <>
                    <dt>Location</dt>
                    <dd>
                      <a href={mapsUrl(item.lat, item.lng)!} target="_blank" rel="noreferrer noopener">
                        Open on map
                      </a>
                    </dd>
                  </>
                )}
              </dl>

              <div className="actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy === item.id}
                  onClick={() => decide(item, 'approve')}
                >
                  {busy === item.id ? 'Working…' : 'Approve'}
                </button>
                <button type="button" className="btn btn-danger-outline" disabled={busy === item.id} onClick={() => setRejecting(item)}>
                  Reject…
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <ReasonDialog
        open={rejecting !== null}
        title={rejecting?.kind === 'verification' ? 'Reject this check-in?' : 'Reject this tree?'}
        description={
          <>
            <p>The member sees this reason, so keep it short and kind.</p>
            {rejecting?.kind === 'verification' && (
              <p className="warn-text">
                A rejected check-in uses up that month&apos;s check-in for the tree. They cannot submit another
                for the same month.
              </p>
            )}
          </>
        }
        confirmLabel="Reject"
        danger
        onCancel={() => setRejecting(null)}
        onConfirm={async (reason) => {
          const item = rejecting;
          setRejecting(null);
          if (item) await decide(item, 'reject', reason);
        }}
      />
    </>
  );
}

function AiPanel({ item }: { item: QueueItem }) {
  if (!item.aiVerdict && item.aiConfidence === undefined) {
    return (
      <div className="ai ai-none">
        <strong>AI check</strong>
        <span className="muted"> — did not run on this one (it was unavailable or switched off).</span>
      </div>
    );
  }
  const reasons = explainVerdict(item.aiVerdict);
  return (
    <div className="ai">
      <div className="ai-head">
        <strong>AI check</strong>
        <span className="muted">
          {' '}
          confidence {percent(item.aiConfidence)}
          {item.aiModel ? ` · ${item.aiModel}` : ''}
        </span>
      </div>
      {reasons.length ? (
        <ul className="ai-list">
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">No details recorded.</p>
      )}
    </div>
  );
}

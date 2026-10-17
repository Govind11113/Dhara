import { useState } from 'react';

import { PAGE_SIZE, useList } from '../hooks';
import { api } from '../lib/appwrite';
import { messageOf } from '../lib/api';
import { humanise, shortId, timeAgo } from '../lib/format';
import type { Flag } from '../lib/types';
import { Empty, ErrorBox, PageHeader, Pager, Pill, ReasonDialog, Spinner, useToast } from '../ui';

export function Flags() {
  const toast = useToast();
  const [show, setShow] = useState<'open' | 'all'>('open');
  const [offset, setOffset] = useState(0);
  const [target, setTarget] = useState<Flag | null>(null);

  const { data, error, loading, reload } = useList<Flag>({
    list: 'flags',
    filters: show === 'open' ? { resolved: false } : {},
    offset,
  });

  async function resolve(flag: Flag, resolution: string) {
    try {
      await api.call('/admin/flag/resolve', { id: flag.$id, resolution });
      toast('Flag resolved.');
      reload();
    } catch (e) {
      toast(messageOf(e), true);
    }
  }

  return (
    <>
      <PageHeader title="Fraud flags" />
      <p className="muted lead">
        Raised automatically when something looks off. Resolving a flag records that you looked at it; it does
        not change the member&apos;s trust score.
      </p>

      <div className="filters">
        <label htmlFor="flag-show">Show</label>
        <select id="flag-show" value={show} onChange={(e) => { setOffset(0); setShow(e.target.value as 'open' | 'all'); }}>
          <option value="open">Unresolved</option>
          <option value="all">All</option>
        </select>
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Spinner label="Loading flags" />}
      {data && data.items.length === 0 && <Empty title={show === 'open' ? 'No unresolved flags.' : 'No flags yet.'} />}

      {data && data.items.length > 0 && (
        <div className="table-wrap">
          <table aria-label="Fraud flags">
            <thead>
              <tr>
                <th scope="col">Kind</th>
                <th scope="col">Severity</th>
                <th scope="col">Detail</th>
                <th scope="col" className="num">Trust</th>
                <th scope="col">Member</th>
                <th scope="col">When</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((f) => (
                <tr key={f.$id}>
                  <th scope="row">{humanise(f.kind)}</th>
                  <td><Pill value={f.severity} /></td>
                  <td>{f.detail || '—'}</td>
                  <td className={`num${f.trustScoreDelta < 0 ? ' bad' : ''}`}>{f.trustScoreDelta || '—'}</td>
                  <td className="mono" title={f.userId}>{shortId(f.userId)}</td>
                  <td>{timeAgo(f.createdAt)}</td>
                  <td>
                    {f.resolved ? (
                      <span className="muted small">Resolved{f.resolution ? `: ${f.resolution}` : ''}</span>
                    ) : (
                      <button type="button" className="btn btn-small" onClick={() => setTarget(f)}>
                        Resolve…
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && <Pager offset={offset} limit={PAGE_SIZE} total={data.total} onChange={setOffset} />}

      <ReasonDialog
        open={target !== null}
        title="Resolve this flag"
        description={<p>{target ? `${humanise(target.kind)} — ${target.detail || 'no detail'}` : ''}</p>}
        label="What did you find?"
        confirmLabel="Resolve"
        onCancel={() => setTarget(null)}
        onConfirm={async (text) => {
          const f = target;
          setTarget(null);
          if (f) await resolve(f, text);
        }}
      />
    </>
  );
}

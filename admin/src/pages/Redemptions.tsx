import { useState } from 'react';

import { PAGE_SIZE, useList } from '../hooks';
import { api } from '../lib/appwrite';
import { messageOf } from '../lib/api';
import { compactNumber, humanise, shortId, timeAgo } from '../lib/format';
import type { Redemption } from '../lib/types';
import { Empty, ErrorBox, PageHeader, Pager, Pill, ReasonDialog, Spinner, useToast } from '../ui';

const STATUSES = ['pending', 'processing', 'fulfilled', 'failed', 'cancelled', ''];

interface UpdateResult {
  refunded: number;
}

export function Redemptions() {
  const toast = useToast();
  const [status, setStatus] = useState('pending');
  const [offset, setOffset] = useState(0);
  const [failing, setFailing] = useState<{ rd: Redemption; as: 'failed' | 'cancelled' } | null>(null);
  const [code, setCode] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const { data, error, loading, reload } = useList<Redemption>({
    list: 'redemptions',
    filters: status ? { status } : {},
    offset,
  });

  async function update(rd: Redemption, next: string, extra: Record<string, string> = {}) {
    setBusy(rd.$id);
    try {
      const out = await api.call<UpdateResult>('/admin/redemption/update', { id: rd.$id, status: next, ...extra });
      toast(out.refunded > 0 ? `Marked ${next}. ${out.refunded} credits refunded.` : `Marked ${next}.`);
      reload();
    } catch (e) {
      toast(messageOf(e), true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader title="Redemptions" />
      <p className="muted lead">
        Credits are taken when a member redeems. Failing or cancelling one gives the credits back automatically,
        once.
      </p>

      <div className="filters">
        <label htmlFor="rd-status">Show</label>
        <select id="rd-status" value={status} onChange={(e) => { setOffset(0); setStatus(e.target.value); }}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s ? humanise(s) : 'Everything'}
            </option>
          ))}
        </select>
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Spinner label="Loading redemptions" />}
      {data && data.items.length === 0 && <Empty title="No redemptions here." />}

      {data && data.items.length > 0 && (
        <div className="table-wrap">
          <table aria-label="Redemptions">
            <thead>
              <tr>
                <th scope="col">Reward</th>
                <th scope="col">Status</th>
                <th scope="col" className="num">Credits</th>
                <th scope="col" className="num">Value</th>
                <th scope="col">Member</th>
                <th scope="col">Requested</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((rd) => {
                const open = rd.status === 'pending' || rd.status === 'processing';
                const needsCode = !['electricity_bill', 'tree_donation'].includes(rd.type);
                return (
                  <tr key={rd.$id}>
                    <th scope="row">
                      {rd.rewardTitle}
                      <div className="muted small">{humanise(rd.type)}</div>
                    </th>
                    <td>
                      <Pill value={rd.status} />
                      {rd.voucherCode && <div className="muted small mono">{rd.voucherCode}</div>}
                      {rd.failureReason && <div className="muted small">{rd.failureReason}</div>}
                    </td>
                    <td className="num">{compactNumber(rd.creditsSpent)}</td>
                    <td className="num">₹{compactNumber(rd.faceValueInr)}</td>
                    <td className="mono" title={rd.userId}>{shortId(rd.userId)}</td>
                    <td>{timeAgo(rd.requestedAt)}</td>
                    <td>
                      {open ? (
                        <div className="row-actions">
                          {rd.status === 'pending' && (
                            <button type="button" className="btn btn-small" disabled={busy === rd.$id} onClick={() => update(rd, 'processing')}>
                              Start
                            </button>
                          )}
                          {needsCode && (
                            <>
                              <label className="sr-only" htmlFor={`code-${rd.$id}`}>Voucher code for {rd.rewardTitle}</label>
                              <input
                                id={`code-${rd.$id}`}
                                className="code-input"
                                placeholder="Voucher code"
                                maxLength={128}
                                value={code[rd.$id] ?? ''}
                                onChange={(e) => setCode((c) => ({ ...c, [rd.$id]: e.target.value }))}
                              />
                            </>
                          )}
                          <button
                            type="button"
                            className="btn btn-small btn-primary"
                            disabled={busy === rd.$id || (needsCode && !(code[rd.$id] ?? '').trim())}
                            onClick={() => update(rd, 'fulfilled', needsCode ? { voucherCode: (code[rd.$id] ?? '').trim() } : {})}
                          >
                            Delivered
                          </button>
                          <button type="button" className="btn btn-small btn-danger-outline" disabled={busy === rd.$id} onClick={() => setFailing({ rd, as: 'failed' })}>
                            Failed…
                          </button>
                          <button type="button" className="btn btn-small" disabled={busy === rd.$id} onClick={() => setFailing({ rd, as: 'cancelled' })}>
                            Cancel…
                          </button>
                        </div>
                      ) : (
                        <span className="muted small">Done</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data && <Pager offset={offset} limit={PAGE_SIZE} total={data.total} onChange={setOffset} />}

      <ReasonDialog
        open={failing !== null}
        title={failing?.as === 'cancelled' ? 'Cancel this redemption?' : 'Mark this redemption as failed?'}
        description={
          <p>
            {failing ? `${compactNumber(failing.rd.creditsSpent)} credits go back to the member straight away.` : ''} The
            member sees this reason.
          </p>
        }
        confirmLabel={failing?.as === 'cancelled' ? 'Cancel redemption' : 'Mark failed'}
        danger
        onCancel={() => setFailing(null)}
        onConfirm={async (reason) => {
          const f = failing;
          setFailing(null);
          if (f) await update(f.rd, f.as, { failureReason: reason });
        }}
      />
    </>
  );
}

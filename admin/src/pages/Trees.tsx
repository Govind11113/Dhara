import { useState } from 'react';

import { PAGE_SIZE, useList } from '../hooks';
import { formatDate, humanise, percent, shortId } from '../lib/format';
import type { Tree, Verification } from '../lib/types';
import { Empty, ErrorBox, PageHeader, Pager, PhotoButton, Pill, Spinner } from '../ui';

const TREE_STATUSES = ['', 'pending_review', 'alive', 'at_risk', 'missed', 'dead', 'rejected'];
const VER_STATUSES = ['', 'manual_review', 'approved', 'rejected'];

export function Trees() {
  const [tab, setTab] = useState<'trees' | 'checkins'>('trees');

  return (
    <>
      <PageHeader title="Trees" />
      <div className="tabs" role="tablist" aria-label="Trees or check-ins">
        <button type="button" role="tab" aria-selected={tab === 'trees'} className={`tab${tab === 'trees' ? ' tab-on' : ''}`} onClick={() => setTab('trees')}>
          Trees
        </button>
        <button type="button" role="tab" aria-selected={tab === 'checkins'} className={`tab${tab === 'checkins' ? ' tab-on' : ''}`} onClick={() => setTab('checkins')}>
          Check-ins
        </button>
      </div>
      {tab === 'trees' ? <TreeTable /> : <CheckinTable />}
    </>
  );
}

function StatusFilter({ id, value, options, onChange }: { id: string; value: string; options: string[]; onChange(v: string): void }) {
  return (
    <div className="filters">
      <label htmlFor={id}>Status</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o ? humanise(o) : 'All'}
          </option>
        ))}
      </select>
    </div>
  );
}

function TreeTable() {
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const { data, error, loading, reload } = useList<Tree>({ list: 'trees', filters: status ? { status } : {}, offset });

  return (
    <>
      <StatusFilter id="tree-status" value={status} options={TREE_STATUSES} onChange={(v) => { setOffset(0); setStatus(v); }} />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Spinner label="Loading trees" />}
      {data && data.items.length === 0 && <Empty title="No trees match." />}
      {data && data.items.length > 0 && (
        <div className="table-wrap">
          <table aria-label="Trees">
            <thead>
              <tr>
                <th scope="col">Tree</th>
                <th scope="col">Status</th>
                <th scope="col" className="num">Progress</th>
                <th scope="col">AI</th>
                <th scope="col">Planted</th>
                <th scope="col">Owner</th>
                <th scope="col">Photo</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((t) => (
                <tr key={t.$id}>
                  <th scope="row">
                    {t.nickname || t.speciesName}
                    <div className="muted small">{t.nickname ? t.speciesName : t.addressLabel}</div>
                  </th>
                  <td>
                    <Pill value={t.status} />
                    {t.rejectReason && <div className="muted small">{t.rejectReason}</div>}
                  </td>
                  <td className="num">{t.verificationCount}/{t.vestingMonths ?? 12}</td>
                  <td>{typeof t.aiConfidence === 'number' && t.aiModel ? percent(t.aiConfidence) : '—'}</td>
                  <td>{formatDate(t.plantedAt)}</td>
                  <td className="mono" title={t.ownerId}>{shortId(t.ownerId)}</td>
                  <td><PhotoButton fileId={t.plantPhotoFileId} label={`Photo of ${t.nickname || t.speciesName}`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager offset={offset} limit={PAGE_SIZE} total={data.total} onChange={setOffset} />}
    </>
  );
}

function CheckinTable() {
  const [status, setStatus] = useState('');
  const [offset, setOffset] = useState(0);
  const { data, error, loading, reload } = useList<Verification>({ list: 'verifications', filters: status ? { status } : {}, offset });

  return (
    <>
      <StatusFilter id="ver-status" value={status} options={VER_STATUSES} onChange={(v) => { setOffset(0); setStatus(v); }} />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Spinner label="Loading check-ins" />}
      {data && data.items.length === 0 && <Empty title="No check-ins match." />}
      {data && data.items.length > 0 && (
        <div className="table-wrap">
          <table aria-label="Check-ins">
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Status</th>
                <th scope="col" className="num">Distance</th>
                <th scope="col" className="num">Credits</th>
                <th scope="col">AI</th>
                <th scope="col">Submitted</th>
                <th scope="col">Photo</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((v) => (
                <tr key={v.$id}>
                  <th scope="row">
                    {v.monthKey}
                    <div className="muted small mono" title={v.treeId}>tree {shortId(v.treeId)}</div>
                  </th>
                  <td>
                    <Pill value={v.status} />
                    {v.rejectReason && <div className="muted small">{v.rejectReason}</div>}
                  </td>
                  <td className="num">{Math.round(v.distanceM)} m</td>
                  <td className="num">{v.creditsAwarded}</td>
                  <td>{typeof v.aiConfidence === 'number' && v.aiVerdict ? percent(v.aiConfidence) : '—'}</td>
                  <td>{formatDate(v.verifiedAt)}</td>
                  <td><PhotoButton fileId={v.photoFileId} label={`Check-in photo ${v.monthKey}`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager offset={offset} limit={PAGE_SIZE} total={data.total} onChange={setOffset} />}
    </>
  );
}

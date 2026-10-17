import { useState } from 'react';

import { PAGE_SIZE, useList } from '../hooks';
import { formatDate, humanise } from '../lib/format';
import type { AdminAction } from '../lib/types';
import { Empty, ErrorBox, PageHeader, Pager, Spinner } from '../ui';

export function Audit() {
  const [offset, setOffset] = useState(0);
  const { data, error, loading, reload } = useList<AdminAction>({ list: 'actions', offset });

  return (
    <>
      <PageHeader title="Audit log" />
      <p className="muted lead">Every change made from this panel, newest first. It cannot be edited from here.</p>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Spinner label="Loading the log" />}
      {data && data.items.length === 0 && <Empty title="No actions recorded yet." />}

      {data && data.items.length > 0 && (
        <div className="table-wrap">
          <table aria-label="Audit log">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Who</th>
                <th scope="col">Action</th>
                <th scope="col">Target</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((a) => (
                <tr key={a.$id}>
                  <td>{formatDate(a.createdAt)}</td>
                  <td>{a.adminEmail || a.adminId}</td>
                  <th scope="row">{humanise(a.action.replace('.', ' '))}</th>
                  <td className="mono">{[a.targetType, a.targetId].filter(Boolean).join(' ')}</td>
                  <td className="small mono">{a.detail || '—'}</td>
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

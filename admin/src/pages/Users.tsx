import { useState } from 'react';

import { PAGE_SIZE, useList } from '../hooks';
import { api } from '../lib/appwrite';
import { messageOf } from '../lib/api';
import { compactNumber, timeAgo } from '../lib/format';
import type { Profile } from '../lib/types';
import { Empty, ErrorBox, PageHeader, Pager, Pill, ReasonDialog, Spinner, useToast } from '../ui';

export function Users() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [typed, setTyped] = useState('');
  const [suspended, setSuspended] = useState<'all' | 'yes'>('all');
  const [offset, setOffset] = useState(0);
  const [target, setTarget] = useState<Profile | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const { data, error, loading, reload } = useList<Profile>({
    list: 'users',
    search,
    filters: suspended === 'yes' ? { isBanned: true } : {},
    offset,
  });

  async function setBan(u: Profile, banned: boolean, reason = '') {
    setBusy(u.$id);
    try {
      await api.call('/admin/user/ban', { userId: u.userId || u.$id, banned, reason });
      toast(banned ? `${u.name} has been suspended.` : `${u.name} has been restored.`);
      reload();
    } catch (e) {
      toast(messageOf(e), true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader title="Members" />

      <form
        className="filters"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setOffset(0);
          setSearch(typed.trim());
        }}
      >
        <label className="sr-only" htmlFor="user-search">
          Search members by name
        </label>
        <input id="user-search" type="search" placeholder="Search by name" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <button type="submit" className="btn">
          Search
        </button>

        <label className="sr-only" htmlFor="user-filter">
          Show
        </label>
        <select
          id="user-filter"
          value={suspended}
          onChange={(e) => {
            setOffset(0);
            setSuspended(e.target.value as 'all' | 'yes');
          }}
        >
          <option value="all">All members</option>
          <option value="yes">Suspended only</option>
        </select>
      </form>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Spinner label="Loading members" />}
      {data && data.items.length === 0 && <Empty title="No members found." hint={search ? 'Try a different name.' : undefined} />}

      {data && data.items.length > 0 && (
        <div className="table-wrap">
          <table aria-label="Members">
            <thead>
              <tr>
                <th scope="col">Member</th>
                <th scope="col" className="num">Trust</th>
                <th scope="col" className="num">Credits</th>
                <th scope="col" className="num">Trees</th>
                <th scope="col" className="num">Level</th>
                <th scope="col">Last active</th>
                <th scope="col">Status</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((u) => (
                <tr key={u.$id}>
                  <th scope="row">
                    {u.name}
                    <div className="muted small">{u.email}</div>
                  </th>
                  <td className={`num${u.trustScore < 60 ? ' bad' : ''}`}>{u.trustScore}</td>
                  <td className="num">
                    {compactNumber(u.creditsAvailable)}
                    <div className="muted small">{compactNumber(u.creditsLifetime)} earned</div>
                  </td>
                  <td className="num">
                    {u.treesAlive}
                    <div className="muted small">{u.treesPlanted} planted</div>
                  </td>
                  <td className="num">{u.level}</td>
                  <td>{timeAgo(u.lastActiveAt)}</td>
                  <td>
                    {u.isBanned ? <Pill value="suspended" tone="bad" /> : <Pill value="active" tone="good" />}
                    {u.isBanned && u.banReason && <div className="muted small">{u.banReason}</div>}
                  </td>
                  <td>
                    {u.isBanned ? (
                      <button type="button" className="btn btn-small" disabled={busy === u.$id} onClick={() => setBan(u, false)}>
                        Restore
                      </button>
                    ) : (
                      <button type="button" className="btn btn-small btn-danger-outline" disabled={busy === u.$id} onClick={() => setTarget(u)}>
                        Suspend…
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
        title={`Suspend ${target?.name ?? 'this member'}?`}
        description={<p>They cannot plant, check in or earn credits while suspended. They see this reason.</p>}
        confirmLabel="Suspend"
        danger
        onCancel={() => setTarget(null)}
        onConfirm={async (reason) => {
          const u = target;
          setTarget(null);
          if (u) await setBan(u, true, reason);
        }}
      />
    </>
  );
}

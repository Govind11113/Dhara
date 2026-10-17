import { Link } from 'react-router-dom';

import { api } from '../lib/appwrite';
import { compactNumber, formatMass, ms, plural, share } from '../lib/format';
import type { Stats } from '../lib/types';
import { ErrorBox, PageHeader, Spinner, useLoad } from '../ui';

function Tile({ label, value, hint, to, tone }: { label: string; value: string; hint?: string; to?: string; tone?: 'warn' }) {
  const body = (
    <>
      <span className="tile-label">{label}</span>
      <span className={`tile-value${tone ? ` tile-${tone}` : ''}`}>{value}</span>
      {hint && <span className="tile-hint">{hint}</span>}
    </>
  );
  return to ? (
    <Link to={to} className="tile tile-link">
      {body}
    </Link>
  ) : (
    <div className="tile">{body}</div>
  );
}

export function Dashboard() {
  const { data: s, error, loading, reload } = useLoad(() => api.call<Stats>('/admin/stats'), []);

  return (
    <>
      <PageHeader title="Dashboard">
        <button type="button" className="btn" onClick={reload} disabled={loading}>
          Refresh
        </button>
      </PageHeader>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !s && <Spinner label="Loading the numbers" />}

      {s && (
        <>
          <section aria-labelledby="needs">
            <h2 id="needs">Needs attention</h2>
            <div className="tiles">
              <Tile
                label="Review queue"
                value={compactNumber(s.queue.trees + s.queue.verifications)}
                hint={`${plural(s.queue.trees, 'tree')} · ${plural(s.queue.verifications, 'check-in')}`}
                to="/queue"
                tone={s.queue.trees + s.queue.verifications > 0 ? 'warn' : undefined}
              />
              <Tile label="Open feedback" value={compactNumber(s.open.feedback)} to="/feedback" tone={s.open.feedback > 0 ? 'warn' : undefined} />
              <Tile label="Unresolved flags" value={compactNumber(s.open.flags)} to="/flags" tone={s.open.flags > 0 ? 'warn' : undefined} />
              <Tile label="Pending redemptions" value={compactNumber(s.open.redemptions)} to="/redemptions" tone={s.open.redemptions > 0 ? 'warn' : undefined} />
            </div>
          </section>

          <section aria-labelledby="community">
            <h2 id="community">Community</h2>
            <div className="tiles">
              <Tile label="Members" value={compactNumber(s.users.total)} hint={`${s.users.banned} suspended`} to="/users" />
              <Tile label="Trees" value={compactNumber(s.trees.total)} hint={`${s.trees.byStatus.alive ?? 0} alive`} to="/trees" />
              <Tile label="Check-ins" value={compactNumber(s.verifications.total)} hint={`${s.verifications.byStatus.approved ?? 0} approved`} to="/trees" />
              <Tile
                label="Credits issued"
                value={compactNumber(s.credits.lifetimeIssued)}
                hint={`${compactNumber(s.credits.spent)} spent${s.credits.approximate ? ' · approximate' : ''}`}
              />
              <Tile
                label="CO₂ credited"
                value={formatMass(s.co2.offsetGrams)}
                hint={`species estimate${s.co2.approximate ? ' · approximate' : ''}`}
              />
            </div>
          </section>

          <section aria-labelledby="ai">
            <h2 id="ai">AI photo check · last {s.ai.windowDays} days</h2>
            <div className="tiles">
              <Tile label="Photos checked" value={compactNumber(s.ai.total)} hint={s.ai.enabled ? s.ai.model : 'switched off'} to="/ai" />
              <Tile label="Approved" value={share(s.ai.approve, s.ai.total)} hint={`${s.ai.approve} photos`} />
              <Tile label="Held for review" value={share(s.ai.review, s.ai.total)} hint={`${s.ai.review} photos`} />
              <Tile label="Rejected" value={share(s.ai.reject, s.ai.total)} hint={`${s.ai.reject} photos`} />
              <Tile
                label="Unavailable"
                value={share(s.ai.unavailable, s.ai.total)}
                hint={`${s.ai.unavailable} calls · then ${s.ai.onUnavailable === 'review' ? 'held for review' : 'allowed through'}`}
                tone={s.ai.unavailable > 0 ? 'warn' : undefined}
                to="/ai"
              />
              <Tile label="Average answer time" value={ms(s.ai.avgLatencyMs)} />
            </div>
          </section>
        </>
      )}
    </>
  );
}

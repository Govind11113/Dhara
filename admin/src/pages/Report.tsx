import { useState } from 'react';

import { InlineBar, MonthBars } from '../charts';
import { api } from '../lib/appwrite';
import { csvFilename, downloadCsv, reportTables, toCsv } from '../lib/csv';
import { biggest, compactNumber, formatDate, formatMass, percent } from '../lib/format';
import type { Report as ReportData } from '../lib/types';
import { Empty, ErrorBox, PageHeader, Spinner, useLoad } from '../ui';

const RANGES = [6, 12, 24];

export function Report() {
  const [months, setMonths] = useState(12);
  const { data: r, error, loading, reload } = useLoad(
    () => api.call<ReportData>('/admin/report', { months }),
    [months],
  );

  const tables = r ? reportTables(r) : [];
  const cut = r
    ? ([
        ['trees', 'trees'],
        ['verifications', 'check-ins'],
        ['profiles', 'members'],
        ['footprints', 'footprints'],
      ] as const)
        .filter(([k]) => r.capped[k])
        .map(([, label]) => label)
    : [];

  return (
    <>
      <PageHeader title="Impact report">
        <label className="sr-only" htmlFor="report-range">
          Period
        </label>
        <select id="report-range" value={months} onChange={(e) => setMonths(Number(e.target.value))} disabled={loading}>
          {RANGES.map((n) => (
            <option key={n} value={n}>
              Last {n} months
            </option>
          ))}
        </select>
        <button type="button" className="btn no-print" onClick={() => window.print()} disabled={!r}>
          Print or save as PDF
        </button>
      </PageHeader>

      <p className="muted lead">
        What members have done through Dhara. Share it as a PDF, or download the tables to open in a
        spreadsheet.
      </p>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !r && <Spinner label="Building the report" />}

      {r && (
        <>
          {cut.length > 0 && (
            <div className="error-box" role="status">
              Only the most recent 1,000 {cut.join(', ')} are included, so these figures are lower than the
              true totals.
            </div>
          )}

          <section aria-labelledby="kpis">
            <h2 id="kpis" className="sr-only">
              Headline figures
            </h2>
            <div className="tiles">
              <Kpi label="Members" value={compactNumber(r.totals.members)} />
              <Kpi label="Trees registered" value={compactNumber(r.totals.trees)} hint={`${r.totals.livingTrees} living`} />
              <Kpi
                label="Survival rate"
                value={percent(r.totals.survivalRate ?? undefined)}
                hint={r.totals.acceptedTrees ? `of ${r.totals.acceptedTrees} accepted trees` : 'no accepted trees yet'}
              />
              <Kpi label="Check-ins approved" value={compactNumber(r.totals.approvedCheckins)} />
              <Kpi label="CO₂ credited" value={formatMass(r.totals.co2CreditedGrams)} hint="estimate, see note below" />
              <Kpi label="Credits issued" value={compactNumber(r.totals.creditsIssued)} hint={`${compactNumber(r.totals.creditsSpent)} spent`} />
            </div>
          </section>

          <section aria-labelledby="trends">
            <h2 id="trends">By month</h2>
            <div className="charts">
              <MonthBars title="Trees planted" months={r.months} values={r.series.map((s) => s.treesPlanted)} unit="trees" />
              <MonthBars title="Check-ins approved" months={r.months} values={r.series.map((s) => s.checkins)} unit="check-ins" color="var(--info)" />
              <MonthBars
                title="CO₂ credited (kg)"
                months={r.months}
                values={r.series.map((s) => Math.round(s.co2CreditedGrams / 100) / 10)}
                unit="kg"
                color="#7a8f1a"
                integer={false}
              />
              <MonthBars title="New members" months={r.months} values={r.series.map((s) => s.newMembers)} unit="members" color="#8e44ad" />
            </div>
          </section>

          <div className="two-col">
            <section aria-labelledby="species">
              <h2 id="species">By species</h2>
              {r.bySpecies.length === 0 ? (
                <Empty title="No trees yet." />
              ) : (
                <div className="table-wrap">
                  <table aria-label="Trees by species">
                    <thead>
                      <tr>
                        <th scope="col">Species</th>
                        <th scope="col" className="num">Trees</th>
                        <th scope="col" className="num">Alive</th>
                        <th scope="col"><span className="sr-only">Share</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.bySpecies.map((s) => (
                        <tr key={s.code}>
                          <th scope="row">{s.name}</th>
                          <td className="num">{s.trees}</td>
                          <td className="num">{s.alive}</td>
                          <td className="bar-cell"><InlineBar value={s.trees} max={r.bySpecies[0].trees} label={`${s.name}: ${s.trees} trees`} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section aria-labelledby="places">
              <h2 id="places">By place</h2>
              {r.byCity.length === 0 ? (
                <Empty title="No trees yet." />
              ) : (
                <div className="table-wrap">
                  <table aria-label="Trees by place">
                    <thead>
                      <tr>
                        <th scope="col">Place</th>
                        <th scope="col" className="num">Trees</th>
                        <th scope="col"><span className="sr-only">Share</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.byCity.map((c) => (
                        <tr key={c.city}>
                          <th scope="row">{c.city}</th>
                          <td className="num">{c.trees}</td>
                          <td className="bar-cell"><InlineBar value={c.trees} max={r.byCity[0].trees} label={`${c.city}: ${c.trees} trees`} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <section aria-labelledby="footprint">
            <h2 id="footprint">Carbon footprint of members</h2>
            {r.footprint.available ? (
              <>
                <div className="tiles">
                  <Kpi label="Average per month" value={formatMass(r.footprint.avgMonthKg * 1000)} hint={`median ${formatMass(r.footprint.medianMonthKg * 1000)}`} />
                  <Kpi label="Average per year" value={formatMass(r.footprint.avgYearKg * 1000)} hint="if every month looked like the latest" />
                  <Kpi label="Members counted" value={String(r.footprint.members)} hint="each member's latest month" />
                  <Kpi
                    label="Biggest part"
                    value={biggest(r.footprint.groups)}
                    hint="average share of the footprint"
                  />
                </div>
                <MonthBars
                  title="Average footprint per member (kg a month)"
                  months={r.footprint.trend.map((t) => t.month)}
                  values={r.footprint.trend.map((t) => t.avgMonthKg ?? 0)}
                  unit="kg"
                  color="#e8833a"
                  integer={false}
                />
                <p className="muted small">
                  Months with fewer than {r.footprint.minMembers} members are left blank so no individual can be picked out.
                </p>
              </>
            ) : (
              <div className="card">
                <p className="empty-title">Not shown yet.</p>
                <p className="muted">
                  Members&apos; carbon footprints are personal. Totals appear here only once at least{' '}
                  {r.footprint.minMembers} members have saved one, so an average can never be traced to one
                  or two people. Individual footprints are never visible to the team.
                </p>
              </div>
            )}
          </section>

          <section aria-labelledby="notes" className="notes">
            <h2 id="notes">How to read this</h2>
            <ul>
              <li>
                <strong>CO₂ credited</strong> adds, for every approved check-in, one twelfth of that
                species&apos; yearly absorption for a fully grown tree. It applies the full grown-tree rate to
                young trees too, so it is an estimate that runs high while trees are small, not a measurement.
              </li>
              <li>
                <strong>Survival rate</strong> is living trees as a share of trees that were accepted. Trees
                still in review or rejected are not counted either way.
              </li>
              <li>
                <strong>Places</strong> are read from the address saved when a tree was registered, and
                trees without one appear under Unknown.
              </li>
            </ul>
            <p className="muted small">Generated {formatDate(r.generatedAt)}.</p>
          </section>

          <section aria-labelledby="downloads" className="no-print">
            <h2 id="downloads">Download</h2>
            <div className="actions">
              {tables.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className="btn"
                  onClick={() => downloadCsv(csvFilename(t.key), toCsv(t.headers, t.rows))}
                >
                  {t.label} (CSV)
                </button>
              ))}
            </div>
          </section>
        </>
      )}
    </>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="tile">
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
      {hint && <span className="tile-hint">{hint}</span>}
    </div>
  );
}

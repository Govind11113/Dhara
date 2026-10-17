import { barLayout, integerTop, monthLabel, niceMax } from './lib/chart';

// The SVG is drawn in these units and scaled to fit its card, which is often
// under half this width. Text is sized for that: 20 units renders at about 10px.
const W = 560;
const H = 150;

/**
 * Bars by month as inline SVG, with no chart library.
 *
 * The picture is for sighted users; the same numbers are also written out as a
 * visually hidden table, which is what a screen reader reads, so nothing is
 * conveyed by the graphic alone.
 */
export function MonthBars({
  title,
  months,
  values,
  unit = '',
  color = 'var(--green)',
  integer = true,
}: {
  title: string;
  months: string[];
  values: number[];
  unit?: string;
  color?: string;
  /** Whole-number axis, for counts. Off for measurements such as kilograms. */
  integer?: boolean;
}) {
  const peak = Math.max(0, ...values.filter(Number.isFinite));
  const top = integer ? integerTop(peak) : niceMax(peak);
  const bars = barLayout(values, W, H, top);
  const total = values.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);

  return (
    <figure className="chart">
      <figcaption>
        <strong>{title}</strong>
        <span className="muted small">
          {' '}
          · {total.toLocaleString('en-IN')} {unit}
        </span>
      </figcaption>

      <svg viewBox={`0 -22 ${W} ${H + 56}`} role="img" aria-label={`${title}, by month`} preserveAspectRatio="xMidYMid meet">
        <title>{title}</title>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1="0" x2={W} y1={H - f * H} y2={H - f * H} className="grid" />
            <text x="2" y={H - f * H - 5} className="tick">
              {Math.round(top * f * 10) / 10}
            </text>
          </g>
        ))}
        {bars.map((b, i) => (
          <g key={months[i]}>
            <rect x={b.x} y={b.y} width={b.width} height={Math.max(b.height, 0)} rx="3" fill={color}>
              <title>{`${months[i]}: ${b.value}${unit ? ` ${unit}` : ''}`}</title>
            </rect>
            {(months.length <= 6 || i % 2 === (months.length - 1) % 2) && (
              <text x={b.x + b.width / 2} y={H + 24} textAnchor="middle" className="tick">
                {monthLabel(months[i])}
              </text>
            )}
          </g>
        ))}
      </svg>

      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">{unit || 'Count'}</th>
          </tr>
        </thead>
        <tbody>
          {months.map((m, i) => (
            <tr key={m}>
              <th scope="row">{m}</th>
              <td>{values[i]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** A horizontal bar inside a table cell. */
export function InlineBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="inline-bar" role="img" aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

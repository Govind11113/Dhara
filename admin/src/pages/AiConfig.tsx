import { useState } from 'react';

import { PAGE_SIZE, useList } from '../hooks';
import { api } from '../lib/appwrite';
import { messageOf } from '../lib/api';
import { ms, percent, share, timeAgo } from '../lib/format';
import type { ConfigItem, Inspection, Stats } from '../lib/types';
import { Empty, ErrorBox, PageHeader, Pager, Pill, Spinner, useLoad, useToast } from '../ui';

export function AiConfig() {
  return (
    <>
      <PageHeader title="AI check and settings" />
      <Health />
      <Settings />
      <Inspections />
    </>
  );
}

function Health() {
  const { data: s, error, loading, reload } = useLoad(() => api.call<Stats>('/admin/stats'), []);
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !s) return <Spinner label="Loading model health" />;
  if (!s) return null;
  const ai = s.ai;
  const models = Object.entries(ai.byModel);

  return (
    <section aria-labelledby="health">
      <h2 id="health">Model health · last {ai.windowDays} days</h2>
      <p className="muted lead">
        Using <strong>{ai.model || 'no model'}</strong>
        {ai.enabled ? '' : ' (the check is switched off)'}. If the model cannot answer, new photos are{' '}
        <strong>{ai.onUnavailable === 'review' ? 'held for review' : 'allowed through on the older checks'}</strong>.
      </p>
      {models.length === 0 ? (
        <Empty title="No AI checks recorded yet." hint="They appear here as members plant trees and check in." />
      ) : (
        <div className="table-wrap">
          <table aria-label="Model health">
            <thead>
              <tr>
                <th scope="col">Model</th>
                <th scope="col" className="num">Calls</th>
                <th scope="col" className="num">Unavailable</th>
                <th scope="col" className="num">Average answer</th>
              </tr>
            </thead>
            <tbody>
              {models.map(([name, m]) => (
                <tr key={name}>
                  <th scope="row" className="mono">{name}</th>
                  <td className="num">{m.calls}</td>
                  <td className={`num${m.unavailable > 0 ? ' bad' : ''}`}>{m.unavailable} ({share(m.unavailable, m.calls)})</td>
                  <td className="num">{ms(m.avgLatencyMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Settings() {
  const { data, error, loading, reload } = useLoad(() => api.call<{ items: ConfigItem[] }>('/admin/config/list'), []);
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <Spinner label="Loading settings" />;
  if (!data) return null;

  const ORDER = ['vision', 'tree', 'fraud', 'redeem'];
  const groups = new Map<string, ConfigItem[]>();
  for (const item of data.items) {
    const g = item.key.split('.')[0];
    groups.set(g, [...(groups.get(g) ?? []), item]);
  }
  const ordered = [...groups.entries()].sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]));
  const TITLES: Record<string, string> = { vision: 'AI photo check', tree: 'Trees', fraud: 'Fraud rules', redeem: 'Redemptions' };

  return (
    <section aria-labelledby="settings">
      <h2 id="settings">Settings</h2>
      <p className="muted lead">
        Changes apply to new submissions straight away and are recorded in the audit log. Values outside the safe
        range are refused.
      </p>
      {ordered.map(([g, items]) => (
        <fieldset key={g} className="settings-group">
          <legend>{TITLES[g] ?? g}</legend>
          {items.map((item) => (
            <SettingRow key={item.key} item={item} onSaved={reload} />
          ))}
        </fieldset>
      ))}
    </section>
  );
}

function SettingRow({ item, onSaved }: { item: ConfigItem; onSaved(): void }) {
  const toast = useToast();
  const [value, setValue] = useState(item.value);
  const [busy, setBusy] = useState(false);
  const dirty = value !== item.value;
  const { spec } = item;
  const id = `cfg-${item.key}`;

  async function save() {
    setBusy(true);
    try {
      await api.call('/admin/config/set', { key: item.key, value });
      toast(`${spec.label} updated.`);
      onSaved();
    } catch (e) {
      toast(messageOf(e), true);
      setValue(item.value);
    } finally {
      setBusy(false);
    }
  }

  let control;
  if (spec.type === 'bool') {
    control = (
      <select id={id} value={value} onChange={(e) => setValue(e.target.value)}>
        <option value="true">On</option>
        <option value="false">Off</option>
      </select>
    );
  } else if (spec.type === 'enum') {
    control = (
      <select id={id} value={value} onChange={(e) => setValue(e.target.value)}>
        {spec.options?.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  } else if (spec.type === 'string') {
    control = <input id={id} type="text" className="wide" value={value} onChange={(e) => setValue(e.target.value)} />;
  } else {
    control = (
      <input
        id={id}
        type="number"
        inputMode="decimal"
        step={spec.type === 'float' ? 0.05 : 1}
        min={spec.min}
        max={spec.max}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    );
  }

  return (
    <div className="setting">
      <div>
        <label htmlFor={id}>{spec.label}</label>
        <div className="muted small">
          {item.key}
          {spec.min !== undefined && spec.max !== undefined ? ` · ${spec.min} to ${spec.max}` : ''}
        </div>
      </div>
      <div className="setting-control">
        {control}
        <button type="button" className="btn btn-small btn-primary" disabled={!dirty || busy} onClick={save}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function Inspections() {
  const [offset, setOffset] = useState(0);
  const { data, error, loading, reload } = useList<Inspection>({ list: 'inspections', offset });

  return (
    <section aria-labelledby="insp">
      <h2 id="insp">Recent AI checks</h2>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <Spinner label="Loading checks" />}
      {data && data.items.length === 0 && <Empty title="No checks recorded yet." />}
      {data && data.items.length > 0 && (
        <div className="table-wrap">
          <table aria-label="Recent AI checks">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">What</th>
                <th scope="col">Decision</th>
                <th scope="col" className="num">Confidence</th>
                <th scope="col" className="num">Time</th>
                <th scope="col">Model call</th>
                <th scope="col">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.$id}>
                  <td>{timeAgo(r.createdAt)}</td>
                  <td>{r.refType === 'tree_plant' ? 'Planting' : r.refType === 'tree_verify' ? 'Check-in' : r.refType || '—'}</td>
                  <td><Pill value={r.action} /></td>
                  <td className="num">{r.status === 'ok' ? percent(r.confidence) : '—'}</td>
                  <td className="num">{ms(r.latencyMs)}{r.attempts > 1 ? ` · ${r.attempts} tries` : ''}</td>
                  <td>
                    <Pill value={r.status} />
                    {r.error && <div className="muted small">{r.error}</div>}
                  </td>
                  <td className="small">{r.verdict || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager offset={offset} limit={PAGE_SIZE} total={data.total} onChange={setOffset} />}
    </section>
  );
}

import { useMemo, useState } from 'react';
import { MethodTag, Sparkline } from '../components/ui';
import { downloadText } from '../lib/download';
import { formatMs, formatTime } from '../lib/format';
import { groupSamples, latencyCsv, latencyHtml, latencyJson, type LatencySample } from '../lib/latency/report';
import { useAppStore } from '../store/AppStore';

export default function LatencyPage() {
  const { state } = useAppStore();
  const [filter, setFilter] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const samples = useMemo<LatencySample[]>(() => state.history.filter((h) => !h.error).map((h) => ({ at: h.at, method: h.method, url: h.url, status: h.status, ok: h.ok, time: h.time, size: h.size, timings: h.timings, via: h.via })), [state.history]);
  const groups = useMemo(() => groupSamples(samples).filter((g) => !filter || g.key.toLowerCase().includes(filter.toLowerCase())), [samples, filter]);
  const selected = groups.find((g) => g.key === sel) ?? null;
  const exportSamples = selected ? selected.samples : samples;
  const stamp = new Date().toISOString().slice(0, 10);
  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div className="stack-sm">
            <h1>Latency</h1>
            <p className="muted small">Response times per endpoint from your history (query strings ignored). p50/p95 use nearest-rank percentiles over successful sends; direct-mode numbers include browser overhead, proxy-mode numbers come from the proxy.</p>
          </div>
          <div className="row">
            <input className="input compact" placeholder="Filter endpoints…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter endpoints" />
            <button type="button" className="btn small" disabled={!exportSamples.length} onClick={() => downloadText(latencyCsv(exportSamples), `latency-${stamp}.csv`, 'text/csv')}>CSV</button>
            <button type="button" className="btn small" disabled={!exportSamples.length} onClick={() => downloadText(latencyJson(exportSamples), `latency-${stamp}.json`)}>JSON</button>
            <button type="button" className="btn small" disabled={!exportSamples.length} onClick={() => downloadText(latencyHtml(exportSamples, selected ? `Latency: ${selected.key}` : 'API latency report'), `latency-${stamp}.html`, 'text/html')}>HTML report</button>
          </div>
        </div>
        <div className="table-wrap card tight">
          <table className="table">
            <thead>
              <tr>
                <th>Endpoint</th>
                <th className="n">Sends</th>
                <th>Trend</th>
                <th className="n">p50</th>
                <th className="n">p95</th>
                <th className="n">max</th>
                <th className="n">errors</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.key} className={g.key === sel ? 'selectable selected' : 'selectable'} onClick={() => setSel(g.key === sel ? null : g.key)}>
                  <td>
                    <div className="row nowrap">
                      <MethodTag method={g.method} />
                      <span className="ellipsis mono small" style={{ maxWidth: 380 }} title={g.url}>{g.url}</span>
                    </div>
                  </td>
                  <td className="n">{g.stats.count}</td>
                  <td><Sparkline values={g.samples.slice(-40).map((s) => s.time)} label={`Last ${Math.min(40, g.samples.length)} response times`} /></td>
                  <td className="n">{formatMs(g.stats.p50)}</td>
                  <td className="n">{formatMs(g.stats.p95)}</td>
                  <td className="n">{formatMs(g.stats.max)}</td>
                  <td className="n">{g.stats.errors}</td>
                </tr>
              ))}
              {!groups.length && (
                <tr>
                  <td colSpan={7} className="muted small">No data yet. Every request you send is tracked.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {selected && (
          <div className="card">
            <h2>
              <MethodTag method={selected.method} /> <span className="mono small break">{selected.url}</span>
            </h2>
            <div className="stats">
              <div className="stat"><b>{selected.stats.count}</b><span>sends</span></div>
              <div className="stat"><b>{formatMs(selected.stats.min)}</b><span>min</span></div>
              <div className="stat"><b>{formatMs(selected.stats.p50)}</b><span>p50</span></div>
              <div className="stat"><b>{formatMs(selected.stats.p95)}</b><span>p95</span></div>
              <div className="stat"><b>{formatMs(selected.stats.p99)}</b><span>p99</span></div>
              <div className="stat"><b>{formatMs(selected.stats.max)}</b><span>max</span></div>
              <div className="stat"><b>{formatMs(selected.stats.mean)}</b><span>mean</span></div>
            </div>
            <Sparkline values={selected.samples.map((s) => s.time)} width={600} height={60} label="All response times" />
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>When</th><th>Status</th><th className="n">Total</th><th className="n">DNS</th><th className="n">Connect</th><th className="n">TLS</th><th className="n">TTFB</th><th className="n">Download</th><th>Via</th></tr>
                </thead>
                <tbody>
                  {selected.samples.slice().reverse().slice(0, 100).map((s, i) => (
                    <tr key={i}>
                      <td className="small">{formatTime(s.at)}</td>
                      <td>{s.status}</td>
                      <td className="n">{formatMs(s.time)}</td>
                      <td className="n">{s.timings?.dns === undefined ? '–' : formatMs(s.timings.dns)}</td>
                      <td className="n">{s.timings?.connect === undefined ? '–' : formatMs(s.timings.connect)}</td>
                      <td className="n">{s.timings?.tls === undefined ? '–' : formatMs(s.timings.tls)}</td>
                      <td className="n">{s.timings?.ttfb === undefined ? '–' : formatMs(s.timings.ttfb)}</td>
                      <td className="n">{s.timings?.download === undefined ? '–' : formatMs(s.timings.download)}</td>
                      <td className="tiny">{s.via}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

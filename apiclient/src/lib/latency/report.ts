import { formatMs } from '../format';
import { latencyStats, sparklinePath, type LatencyStats } from './stats';

export interface LatencySample {
  at: string;
  method: string;
  url: string;
  status: number;
  ok: boolean;
  time: number;
  size: number;
  timings?: { dns?: number; connect?: number; tls?: number; ttfb?: number; download?: number; total: number; source: string };
  via: string;
}

export interface LatencyGroup {
  key: string;
  method: string;
  url: string;
  samples: LatencySample[];
  stats: LatencyStats;
}

export function groupSamples(samples: LatencySample[]): LatencyGroup[] {
  const map = new Map<string, LatencyGroup>();
  for (const s of samples) {
    const q = s.url.indexOf('?');
    const url = q >= 0 ? s.url.slice(0, q) : s.url;
    const key = `${s.method} ${url}`;
    let g = map.get(key);
    if (!g) {
      g = { key, method: s.method, url, samples: [], stats: latencyStats([]) };
      map.set(key, g);
    }
    g.samples.push(s);
  }
  for (const g of map.values()) {
    g.samples.sort((a, b) => a.at.localeCompare(b.at));
    g.stats = latencyStats(g.samples.map((s) => ({ time: s.time, ok: s.ok })));
  }
  return [...map.values()].sort((a, b) => b.samples.length - a.samples.length);
}

const csvCell = (v: unknown) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function latencyCsv(samples: LatencySample[]): string {
  const head = ['at', 'method', 'url', 'status', 'ok', 'time_ms', 'size_bytes', 'dns_ms', 'connect_ms', 'tls_ms', 'ttfb_ms', 'download_ms', 'via'];
  const rows = samples.map((s) => [s.at, s.method, s.url, s.status, s.ok, round(s.time), s.size, round(s.timings?.dns), round(s.timings?.connect), round(s.timings?.tls), round(s.timings?.ttfb), round(s.timings?.download), s.via].map(csvCell).join(','));
  return [head.join(','), ...rows].join('\r\n') + '\r\n';
}

const round = (n: number | undefined) => (n === undefined ? '' : Math.round(n * 100) / 100);

export function latencyJson(samples: LatencySample[]): string {
  const groups = groupSamples(samples).map((g) => ({ method: g.method, url: g.url, stats: g.stats, samples: g.samples }));
  return JSON.stringify({ app: 'apiclient', generatedAt: new Date().toISOString(), groups }, null, 2);
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Self-contained HTML page: a table per endpoint with stats, an inline SVG sparkline and the raw samples. */
export function latencyHtml(samples: LatencySample[], title = 'API latency report'): string {
  const groups = groupSamples(samples);
  const section = (g: LatencyGroup) => {
    const path = sparklinePath(
      g.samples.map((s) => s.time),
      320,
      48,
    );
    const rows = g.samples.map((s) => `<tr><td>${esc(s.at)}</td><td>${s.status}</td><td class="n">${round(s.time)}</td><td class="n">${s.size}</td><td class="n">${round(s.timings?.ttfb)}</td><td>${esc(s.via)}</td></tr>`).join('');
    return `<section><h2><span class="m">${esc(g.method)}</span> ${esc(g.url)}</h2>
<div class="stats"><div><b>${g.stats.count}</b><span>requests</span></div><div><b>${formatMs(g.stats.p50)}</b><span>p50</span></div><div><b>${formatMs(g.stats.p95)}</b><span>p95</span></div><div><b>${formatMs(g.stats.max)}</b><span>max</span></div><div><b>${formatMs(g.stats.mean)}</b><span>mean</span></div><div><b>${g.stats.errors}</b><span>errors</span></div></div>
<svg class="spark" viewBox="0 0 320 48" width="320" height="48" role="img" aria-label="Response time over time"><path d="${path}" fill="none" stroke="#c2410c" stroke-width="1.5"/></svg>
<details><summary>${g.samples.length} samples</summary><table><thead><tr><th>Time</th><th>Status</th><th>ms</th><th>Bytes</th><th>TTFB ms</th><th>Via</th></tr></thead><tbody>${rows}</tbody></table></details></section>`;
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;color:#1b2433;background:#fff;max-width:960px}h1{font-size:1.4rem}h2{font-size:1rem;word-break:break-all}.m{display:inline-block;padding:1px 6px;border-radius:4px;background:#ffedd5;color:#9a3412;font-size:.8rem;margin-right:6px}section{border:1px solid #e2e6ec;border-radius:10px;padding:14px;margin:14px 0}.stats{display:flex;flex-wrap:wrap;gap:16px;margin:8px 0}.stats div{display:flex;flex-direction:column}.stats b{font-size:1.1rem}.stats span{font-size:.78rem;color:#5f6b7d}table{border-collapse:collapse;width:100%;font-size:.85rem}td,th{text-align:left;padding:4px 8px;border-bottom:1px solid #eee}td.n{text-align:right;font-variant-numeric:tabular-nums}summary{cursor:pointer;color:#5f6b7d;font-size:.85rem}@media(prefers-color-scheme:dark){body{background:#0f131a;color:#e4e8ef}section{border-color:#262e3b}td,th{border-color:#262e3b}.m{background:#3b1f0e;color:#fdba74}}</style></head>
<body><h1>${esc(title)}</h1><p>${samples.length} requests across ${groups.length} endpoints · generated ${esc(new Date().toISOString())} by API Client.</p>${groups.map(section).join('')}</body></html>`;
}

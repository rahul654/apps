export interface LatencyStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  errors: number;
}

/** Nearest-rank percentile on a sorted copy. */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export function latencyStats(samples: { time: number; ok: boolean }[]): LatencyStats {
  const okTimes = samples.filter((s) => s.ok).map((s) => s.time);
  const times = okTimes.length ? okTimes : samples.map((s) => s.time);
  const count = samples.length;
  if (!count) return { count: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0, errors: 0 };
  const sum = times.reduce((a, b) => a + b, 0);
  return {
    count,
    min: Math.min(...times),
    max: Math.max(...times),
    mean: times.length ? sum / times.length : 0,
    p50: percentile(times, 50),
    p95: percentile(times, 95),
    p99: percentile(times, 99),
    errors: samples.filter((s) => !s.ok).length,
  };
}

/** SVG path (polyline) for a sparkline, scaled to w×h, oldest value first. */
export function sparklinePath(values: number[], w = 120, h = 28, pad = 2): string {
  if (!values.length) return '';
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  return values
    .map((v, i) => {
      const x = pad + i * step;
      const y = h - pad - ((v - min) / span) * (h - pad * 2);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

/** Groups history by "METHOD url" (query string stripped). */
export function groupKey(method: string, url: string): string {
  const q = url.indexOf('?');
  return `${method.toUpperCase()} ${q >= 0 ? url.slice(0, q) : url}`;
}

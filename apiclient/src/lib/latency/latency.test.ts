import { describe, expect, it } from 'vitest';
import { groupSamples, latencyCsv, latencyHtml, latencyJson, type LatencySample } from './report';
import { latencyStats, percentile, sparklinePath } from './stats';

const sample = (over: Partial<LatencySample>): LatencySample => ({ at: '2024-01-01T00:00:00.000Z', method: 'GET', url: 'https://a/b', status: 200, ok: true, time: 10, size: 5, via: 'direct', ...over });

describe('latency stats', () => {
  it('nearest-rank percentiles', () => {
    const v = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(v, 50)).toBe(50);
    expect(percentile(v, 95)).toBe(100);
    expect(percentile(v, 99)).toBe(100);
    expect(percentile([5], 50)).toBe(5);
    expect(percentile([], 50)).toBe(0);
    expect(percentile([3, 1, 2], 50)).toBe(2);
  });
  it('stats exclude errors from timing but count them', () => {
    const s = latencyStats([{ time: 10, ok: true }, { time: 30, ok: true }, { time: 999, ok: false }]);
    expect(s).toEqual({ count: 3, min: 10, max: 30, mean: 20, p50: 10, p95: 30, p99: 30, errors: 1 });
    expect(latencyStats([]).count).toBe(0);
    expect(latencyStats([{ time: 7, ok: false }]).max).toBe(7);
  });
  it('sparkline path scales values', () => {
    expect(sparklinePath([0, 10], 100, 20, 0)).toBe('M0.0 20.0 L100.0 0.0');
    expect(sparklinePath([], 100, 20)).toBe('');
    expect(sparklinePath([5], 100, 20, 0)).toBe('M0.0 0.0');
  });
  it('groups samples by method + url without query and sorts by time', () => {
    const g = groupSamples([sample({ url: 'https://a/b?x=2', time: 30, at: '2024-01-01T00:00:02Z' }), sample({ url: 'https://a/b?x=1', time: 10, at: '2024-01-01T00:00:01Z' }), sample({ method: 'POST', time: 5 })]);
    expect(g.map((x) => x.key)).toEqual(['GET https://a/b', 'POST https://a/b']);
    expect(g[0].samples.map((s) => s.time)).toEqual([10, 30]);
    expect(g[0].stats.p50).toBe(10);
  });
  it('exports CSV, JSON and a self-contained HTML page', () => {
    const samples = [sample({ url: 'https://a/b?q="x,y"', timings: { dns: 1, connect: 2, tls: 0, ttfb: 5, download: 2, total: 10, source: 'proxy' } }), sample({ status: 500, ok: false })];
    const csv = latencyCsv(samples);
    expect(csv.split('\r\n')[0]).toBe('at,method,url,status,ok,time_ms,size_bytes,dns_ms,connect_ms,tls_ms,ttfb_ms,download_ms,via');
    expect(csv.split('\r\n')[1]).toBe('2024-01-01T00:00:00.000Z,GET,"https://a/b?q=""x,y""",200,true,10,5,1,2,0,5,2,direct');
    const json = JSON.parse(latencyJson(samples)) as { groups: { stats: { count: number } }[] };
    expect(json.groups[0].stats.count).toBe(2);
    const html = latencyHtml(samples, 'T <x>');
    expect(html).toContain('<title>T &lt;x&gt;</title>');
    expect(html).toContain('<path d="M');
    expect(html).not.toContain('<script');
  });
});

/**
 * Structural JSON diff: added / removed / changed leaves with JSON-pointer-like paths.
 * Arrays compare index by index, or as multisets when `ignoreOrder` is set.
 * `ignoreKeys` drops keys by name (anywhere) or by full path (when it contains a dot or slash).
 */
export interface DiffEntry {
  path: string;
  kind: 'added' | 'removed' | 'changed';
  before?: unknown;
  after?: unknown;
}

export interface JsonDiffOptions {
  ignoreKeys?: string[];
  ignoreOrder?: boolean;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Deterministic serialisation (sorted keys) used for equality and for sorting arrays. */
export function canonical(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonical).join(',')}]`;
  if (isObj(x)) return `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${canonical(x[k])}`).join(',')}}`;
  return JSON.stringify(x) ?? 'undefined';
}

function strip(x: unknown, ignore: Set<string>, path: string): unknown {
  if (Array.isArray(x)) return x.map((v, i) => strip(v, ignore, `${path}[${i}]`));
  if (isObj(x)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) {
      const p = path ? `${path}.${k}` : k;
      if (ignore.has(k) || ignore.has(p)) continue;
      out[k] = strip(v, ignore, p);
    }
    return out;
  }
  return x;
}

export function diffJson(a: unknown, b: unknown, opts: JsonDiffOptions = {}): DiffEntry[] {
  const ignore = new Set((opts.ignoreKeys ?? []).map((k) => k.trim()).filter(Boolean));
  const out: DiffEntry[] = [];
  const left = ignore.size ? strip(a, ignore, '') : a;
  const right = ignore.size ? strip(b, ignore, '') : b;
  walk(left, right, '$', out, !!opts.ignoreOrder);
  return out;
}

function walk(a: unknown, b: unknown, path: string, out: DiffEntry[], ignoreOrder: boolean): void {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (ignoreOrder) {
      const remaining = b.map((v) => ({ v, used: false, key: canonical(v) }));
      const unmatchedA: unknown[] = [];
      for (const v of a) {
        const key = canonical(v);
        const hit = remaining.find((r) => !r.used && r.key === key);
        if (hit) hit.used = true;
        else unmatchedA.push(v);
      }
      const unmatchedB = remaining.filter((r) => !r.used).map((r) => r.v);
      // Pair leftover elements positionally so similar objects show as "changed" rather than remove+add.
      const n = Math.max(unmatchedA.length, unmatchedB.length);
      for (let i = 0; i < n; i++) {
        if (i < unmatchedA.length && i < unmatchedB.length) walk(unmatchedA[i], unmatchedB[i], `${path}[~${i}]`, out, ignoreOrder);
        else if (i < unmatchedA.length) out.push({ path: `${path}[~${i}]`, kind: 'removed', before: unmatchedA[i] });
        else out.push({ path: `${path}[~${i}]`, kind: 'added', after: unmatchedB[i] });
      }
      return;
    }
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (i >= a.length) out.push({ path: `${path}[${i}]`, kind: 'added', after: b[i] });
      else if (i >= b.length) out.push({ path: `${path}[${i}]`, kind: 'removed', before: a[i] });
      else walk(a[i], b[i], `${path}[${i}]`, out, ignoreOrder);
    }
    return;
  }
  if (isObj(a) && isObj(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const p = `${path}.${k}`;
      if (!(k in a)) out.push({ path: p, kind: 'added', after: b[k] });
      else if (!(k in b)) out.push({ path: p, kind: 'removed', before: a[k] });
      else walk(a[k], b[k], p, out, ignoreOrder);
    }
    return;
  }
  if (canonical(a) !== canonical(b)) out.push({ path, kind: 'changed', before: a, after: b });
}

export function summarize(entries: DiffEntry[]): { added: number; removed: number; changed: number } {
  return {
    added: entries.filter((e) => e.kind === 'added').length,
    removed: entries.filter((e) => e.kind === 'removed').length,
    changed: entries.filter((e) => e.kind === 'changed').length,
  };
}

/** Pretty JSON with sorted keys (and sorted arrays when ignoreOrder), for the text diff view. */
export function normalizedText(x: unknown, opts: JsonDiffOptions = {}): string {
  const ignore = new Set((opts.ignoreKeys ?? []).map((k) => k.trim()).filter(Boolean));
  const v = ignore.size ? strip(x, ignore, '') : x;
  const sortDeep = (y: unknown): unknown => {
    if (Array.isArray(y)) {
      const arr = y.map(sortDeep);
      return opts.ignoreOrder ? arr.sort((p, q) => (canonical(p) < canonical(q) ? -1 : canonical(p) > canonical(q) ? 1 : 0)) : arr;
    }
    if (isObj(y)) return Object.fromEntries(Object.keys(y).sort().map((k) => [k, sortDeep(y[k])]));
    return y;
  };
  return JSON.stringify(sortDeep(v), null, 2) ?? '';
}

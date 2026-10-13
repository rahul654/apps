// JSON helpers: parse with precise error location, format, sort keys, structural diff.

export type Indent = 2 | 4 | 'tab';

export interface JsonError {
  message: string;
  /** 0-based character offset of the error. */
  offset: number;
  /** 1-based line and column. */
  line: number;
  column: number;
}

export type ParseResult = { ok: true; value: unknown } | { ok: false; error: JsonError };

class JsonSyntaxError extends Error {
  constructor(
    message: string,
    public offset: number,
  ) {
    super(message);
  }
}

/** 1-based line/column for a character offset. */
export function lineColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: end - lineStart + 1 };
}

function describeChar(ch: string | undefined): string {
  if (ch === undefined) return 'end of input';
  if (ch === '\n') return 'newline';
  if (ch === '\t') return 'tab';
  if (ch === "'") return `"'" (JSON strings need double quotes)`;
  return JSON.stringify(ch);
}

const NUMBER_RE = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const HEX4_RE = /^[0-9a-fA-F]{4}$/;

/**
 * Strict JSON scanner used only to locate an error after `JSON.parse` fails, because
 * engines report positions inconsistently (Safari reports none at all).
 * Throws JsonSyntaxError on the first problem; returns normally if the text is valid.
 */
function scan(s: string): void {
  const n = s.length;
  let i = 0;

  const fail = (msg: string, at = i): never => {
    throw new JsonSyntaxError(msg, at);
  };
  const ws = () => {
    while (i < n) {
      const c = s.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13) i++;
      else break;
    }
  };
  const string = () => {
    const start = i;
    i++; // opening quote
    for (;;) {
      if (i >= n) fail('Unterminated string', start);
      const c = s.charCodeAt(i);
      if (c === 34) {
        i++;
        return;
      }
      if (c === 92) {
        const e = s[i + 1];
        if (e !== undefined && '"\\/bfnrt'.includes(e)) i += 2;
        else if (e === 'u') {
          if (!HEX4_RE.test(s.slice(i + 2, i + 6))) fail('Invalid \\u escape (needs 4 hex digits)');
          i += 6;
        } else fail('Invalid escape sequence in string');
      } else if (c < 0x20) {
        fail('Control character in string (newlines and tabs must be escaped)');
      } else i++;
    }
  };
  const value = (): void => {
    ws();
    if (i >= n) fail('Unexpected end of input, expected a value');
    const ch = s[i];
    if (ch === '{') {
      i++;
      ws();
      if (s[i] === '}') {
        i++;
        return;
      }
      for (;;) {
        ws();
        if (s[i] !== '"') fail(`Expected a double-quoted property name but found ${describeChar(s[i])}`);
        string();
        ws();
        if (s[i] !== ':') fail(`Expected ':' after property name but found ${describeChar(s[i])}`);
        i++;
        value();
        ws();
        if (s[i] === ',') {
          i++;
          ws();
          if (s[i] === '}') fail('Trailing comma is not allowed in JSON');
          continue;
        }
        if (s[i] === '}') {
          i++;
          return;
        }
        fail(`Expected ',' or '}' after property value but found ${describeChar(s[i])}`);
      }
    }
    if (ch === '[') {
      i++;
      ws();
      if (s[i] === ']') {
        i++;
        return;
      }
      for (;;) {
        value();
        ws();
        if (s[i] === ',') {
          i++;
          ws();
          if (s[i] === ']') fail('Trailing comma is not allowed in JSON');
          continue;
        }
        if (s[i] === ']') {
          i++;
          return;
        }
        fail(`Expected ',' or ']' after array element but found ${describeChar(s[i])}`);
      }
    }
    if (ch === '"') return string();
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      NUMBER_RE.lastIndex = i;
      const m = NUMBER_RE.exec(s);
      if (!m) fail('Invalid number');
      i += m![0].length;
      return;
    }
    for (const lit of ['true', 'false', 'null']) {
      if (s.startsWith(lit, i)) {
        i += lit.length;
        return;
      }
    }
    fail(`Unexpected ${describeChar(ch)}`);
  };

  value();
  ws();
  if (i < n) fail(`Unexpected ${describeChar(s[i])} after the end of the JSON value`);
}

/** Locate the error in text that JSON.parse rejected. */
export function locateJsonError(text: string, original?: unknown): JsonError {
  let message = original instanceof Error ? original.message : 'Invalid JSON';
  let offset = 0;
  try {
    scan(text);
    // Scanner disagrees (should not happen); fall back to the engine's position if it gave one.
    const m = /position (\d+)/.exec(message);
    if (m) offset = Number(m[1]);
  } catch (e) {
    if (e instanceof JsonSyntaxError) {
      message = e.message;
      offset = e.offset;
    } else if (e instanceof RangeError) {
      message = 'Input is nested too deeply to locate the error';
    }
  }
  if (text.trim() === '') {
    message = 'Input is empty';
    offset = 0;
  }
  return { message, offset, ...lineColumn(text, offset) };
}

export function parseJson(text: string): ParseResult {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: locateJsonError(text, e) };
  }
}

/** Deep copy with object keys sorted (arrays keep their order). `__proto__` keys stay own data props. */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(keys.map((k) => [k, sortKeysDeep((value as Record<string, unknown>)[k])]));
  }
  return value;
}

export function formatJson(value: unknown, indent: Indent, sortKeys = false): string {
  return JSON.stringify(sortKeys ? sortKeysDeep(value) : value, null, indent === 'tab' ? '\t' : indent) ?? '';
}

export function minifyJson(value: unknown, sortKeys = false): string {
  return JSON.stringify(sortKeys ? sortKeysDeep(value) : value) ?? '';
}

// ---------- Structural diff ----------

export type JsonDiffKind = 'added' | 'removed' | 'changed';

export interface JsonDiffEntry {
  path: string;
  kind: JsonDiffKind;
  before?: unknown;
  after?: unknown;
}

const IDENT_RE = /^[A-Za-z_$][\w$]*$/;

export function childPath(parent: string, key: string | number): string {
  if (typeof key === 'number') return `${parent}[${key}]`;
  return IDENT_RE.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

type Kind = 'array' | 'object' | 'scalar';
const kindOf = (v: unknown): Kind => (Array.isArray(v) ? 'array' : v !== null && typeof v === 'object' ? 'object' : 'scalar');
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * Structural diff of two JSON values. Objects are compared by key, arrays by index.
 * Returns at most `limit` entries; `truncated` tells whether more differences exist.
 */
export function diffJson(a: unknown, b: unknown, limit = 5000): { entries: JsonDiffEntry[]; truncated: boolean } {
  const entries: JsonDiffEntry[] = [];
  let truncated = false;

  const push = (e: JsonDiffEntry) => {
    if (entries.length >= limit) {
      truncated = true;
      return false;
    }
    entries.push(e);
    return true;
  };

  const walk = (x: unknown, y: unknown, path: string): boolean => {
    if (x === y) return true;
    const kx = kindOf(x);
    const ky = kindOf(y);
    if (kx !== ky || kx === 'scalar') return push({ path, kind: 'changed', before: x, after: y });
    if (kx === 'array') {
      const ax = x as unknown[];
      const ay = y as unknown[];
      const len = Math.max(ax.length, ay.length);
      for (let i = 0; i < len; i++) {
        const p = childPath(path, i);
        const ok = i >= ax.length ? push({ path: p, kind: 'added', after: ay[i] }) : i >= ay.length ? push({ path: p, kind: 'removed', before: ax[i] }) : walk(ax[i], ay[i], p);
        if (!ok) return false;
      }
      return true;
    }
    const ox = x as Record<string, unknown>;
    const oy = y as Record<string, unknown>;
    for (const k of Object.keys(ox)) {
      const p = childPath(path, k);
      const ok = has(oy, k) ? walk(ox[k], oy[k], p) : push({ path: p, kind: 'removed', before: ox[k] });
      if (!ok) return false;
    }
    for (const k of Object.keys(oy)) {
      if (!has(ox, k) && !push({ path: childPath(path, k), kind: 'added', after: oy[k] })) return false;
    }
    return true;
  };

  walk(a, b, '$');
  return { entries, truncated };
}

/** Short single-line preview of a JSON value. */
export function previewJson(value: unknown, max = 120): string {
  const s = value === undefined ? '' : (JSON.stringify(value) ?? String(value));
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Plain-text report of a diff, for copying. */
export function diffReport(entries: JsonDiffEntry[]): string {
  return entries
    .map((e) => {
      if (e.kind === 'added') return `+ ${e.path}: ${previewJson(e.after, 500)}`;
      if (e.kind === 'removed') return `- ${e.path}: ${previewJson(e.before, 500)}`;
      return `~ ${e.path}: ${previewJson(e.before, 500)} → ${previewJson(e.after, 500)}`;
    })
    .join('\n');
}

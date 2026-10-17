/**
 * JSON text helpers that tolerate Postman `{{variable}}` placeholders in non-string positions
 * (`"id": {{destinationId}}`), plus `//` and `/* *\/` comments (Postman strips them before sending).
 *
 * Everything works on a token stream whose tokens keep their exact source text, so prettifying
 * never rewrites a number, a string or a placeholder: it only changes the whitespace between tokens.
 * `JSON.parse` + `JSON.stringify` is not used because it would reject placeholders and round big
 * integers (ids above 2^53).
 */

export type JsonTokType = '{' | '}' | '[' | ']' | ':' | ',' | 'string' | 'word' | 'comment';

export interface JsonTok {
  type: JsonTokType;
  text: string;
  from: number;
  to: number;
}

export interface JsonTextError {
  message: string;
  from: number;
  to: number;
  /** 1-based. */
  line: number;
  /** 1-based. */
  col: number;
}

const PUNCT = new Set(['{', '}', '[', ']', ':', ',']);
const NUMBER_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const PLACEHOLDER_RE = /\{\{[^{}\n]+\}\}/;

export function lineCol(text: string, pos: number): { line: number; col: number } {
  let line = 1;
  let last = -1;
  for (let i = text.indexOf('\n'); i >= 0 && i < pos; i = text.indexOf('\n', i + 1)) {
    line++;
    last = i;
  }
  return { line, col: pos - last };
}

function err(text: string, message: string, from: number, to = from + 1): JsonTextError {
  return { message, from, to: Math.max(to, from), ...lineCol(text, from) };
}

/** Length of a `{{name}}` placeholder starting at `i`, or 0. */
function placeholderAt(text: string, i: number): number {
  if (text[i] !== '{' || text[i + 1] !== '{') return 0;
  const end = text.indexOf('}}', i + 2);
  if (end < 0) return 0;
  const inner = text.slice(i + 2, end);
  return inner && !/[{}\n]/.test(inner) ? end + 2 - i : 0;
}

/** Splits text into tokens. Whitespace is dropped; every other character belongs to exactly one token. */
export function tokenizeJson(text: string): { tokens: JsonTok[]; error: JsonTextError | null } {
  const tokens: JsonTok[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '﻿') {
      i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      let end = text.indexOf('\n', i);
      if (end < 0) end = n;
      tokens.push({ type: 'comment', text: text.slice(i, end).replace(/\r$/, ''), from: i, to: end });
      i = end;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) return { tokens, error: err(text, 'Unterminated comment', i, n) };
      tokens.push({ type: 'comment', text: text.slice(i, end + 2), from: i, to: end + 2 });
      i = end + 2;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      for (; j < n; j++) {
        const d = text[j];
        if (d === '\\') j++;
        else if (d === '"') break;
        else if (d === '\n') return { tokens, error: err(text, 'Unterminated string', i, j) };
      }
      if (j >= n) return { tokens, error: err(text, 'Unterminated string', i, n) };
      tokens.push({ type: 'string', text: text.slice(i, j + 1), from: i, to: j + 1 });
      i = j + 1;
      continue;
    }
    if (PUNCT.has(c) && !placeholderAt(text, i)) {
      tokens.push({ type: c as JsonTokType, text: c, from: i, to: i + 1 });
      i++;
      continue;
    }
    // A bare word: a number, true/false/null, a placeholder, or garbage. Placeholders may sit inside it.
    let j = i;
    while (j < n) {
      const p = placeholderAt(text, j);
      if (p) {
        j += p;
        continue;
      }
      const d = text[j];
      if (d === ' ' || d === '\t' || d === '\n' || d === '\r' || d === '"' || PUNCT.has(d)) break;
      if (d === '/' && (text[j + 1] === '/' || text[j + 1] === '*')) break;
      j++;
    }
    tokens.push({ type: 'word', text: text.slice(i, j), from: i, to: j });
    i = j;
  }
  return { tokens, error: null };
}

const isValueWord = (w: string) => w === 'true' || w === 'false' || w === 'null' || NUMBER_RE.test(w) || PLACEHOLDER_RE.test(w);

/** Validates JSON text (placeholders and comments allowed). Returns null when it is valid or empty. */
export function validateJsonText(text: string): JsonTextError | null {
  const { tokens: all, error } = tokenizeJson(text);
  if (error) return error;
  const toks = all.filter((t) => t.type !== 'comment');
  if (!toks.length) return null;
  let i = 0;
  const end = () => err(text, 'Unexpected end of JSON', text.length, text.length);
  const unexpected = (t: JsonTok, expected?: string) => err(text, `${expected ? `Expected ${expected}, found` : 'Unexpected'} ${t.type === 'string' ? 'string' : `'${t.text.length > 20 ? t.text.slice(0, 20) + '…' : t.text}'`}`, t.from, t.to);
  const value = (): JsonTextError | null => {
    const t = toks[i];
    if (!t) return end();
    if (t.type === 'string') {
      i++;
      return null;
    }
    if (t.type === 'word') {
      if (!isValueWord(t.text)) return err(text, `Invalid value '${t.text.length > 20 ? t.text.slice(0, 20) + '…' : t.text}'`, t.from, t.to);
      i++;
      return null;
    }
    if (t.type === '{') {
      i++;
      if (toks[i]?.type === '}') {
        i++;
        return null;
      }
      for (;;) {
        const k = toks[i];
        if (!k) return end();
        if (k.type === '}') return err(text, 'Trailing comma before }', toks[i - 1].from, toks[i - 1].to);
        if (k.type !== 'string' && !(k.type === 'word' && PLACEHOLDER_RE.test(k.text))) return unexpected(k, 'a property name in double quotes');
        i++;
        const colon = toks[i];
        if (!colon) return end();
        if (colon.type !== ':') return unexpected(colon, "':'");
        i++;
        const e = value();
        if (e) return e;
        const sep = toks[i];
        if (!sep) return end();
        if (sep.type === '}') {
          i++;
          return null;
        }
        if (sep.type !== ',') return unexpected(sep, "',' or '}'");
        i++;
      }
    }
    if (t.type === '[') {
      i++;
      if (toks[i]?.type === ']') {
        i++;
        return null;
      }
      for (;;) {
        const v = toks[i];
        if (!v) return end();
        if (v.type === ']') return err(text, 'Trailing comma before ]', toks[i - 1].from, toks[i - 1].to);
        const e = value();
        if (e) return e;
        const sep = toks[i];
        if (!sep) return end();
        if (sep.type === ']') {
          i++;
          return null;
        }
        if (sep.type !== ',') return unexpected(sep, "',' or ']'");
        i++;
      }
    }
    return unexpected(t);
  };
  const e = value();
  if (e) return e;
  if (i < toks.length) return unexpected(toks[i], 'end of JSON');
  return null;
}

/**
 * Re-indents JSON text. Token texts are copied verbatim, so placeholders, strings and numbers are
 * never changed; only whitespace is. Invalid JSON is left alone and the error is returned.
 */
export function prettifyJsonText(text: string, indent = 2): { text: string; error: null } | { text: null; error: JsonTextError } {
  const error = validateJsonText(text);
  if (error) return { text: null, error };
  const { tokens } = tokenizeJson(text);
  if (!tokens.length) return { text, error: null };
  const pad = (depth: number) => ' '.repeat(depth * indent);
  // Output as a list of small pieces. Trimming touches only the tail, so formatting stays linear;
  // trimming one big string with an end-anchored regex at every newline was quadratic and froze
  // the page on large responses.
  const out = new TailBuffer();
  let depth = 0;
  // Whether the next token starts a fresh line (after an opening bracket, a comma or a line comment).
  let atLineStart = true;
  const newline = () => {
    out.trimEnd(' \t');
    out.push('\n' + pad(depth));
    atLineStart = true;
  };
  const nextSignificant = (from: number) => {
    for (let j = from; j < tokens.length; j++) if (tokens[j].type !== 'comment') return tokens[j];
    return undefined;
  };
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    switch (t.type) {
      case '{':
      case '[': {
        out.push(t.text);
        const next = nextSignificant(k + 1);
        const close = t.type === '{' ? '}' : ']';
        const hasCommentInside = tokens[k + 1]?.type === 'comment';
        if (next?.type === close && !hasCommentInside) {
          // Empty container stays on one line.
          let ci = k + 1;
          while (tokens[ci] !== next) ci++;
          out.push(next.text);
          k = ci;
          atLineStart = false;
          break;
        }
        depth++;
        newline();
        break;
      }
      case '}':
      case ']':
        depth = Math.max(0, depth - 1);
        newline();
        out.push(t.text);
        atLineStart = false;
        break;
      case ',': {
        // Drop spaces before the comma, but keep a line break a comment left there.
        const ws = out.trimEnd(' \t\n');
        if (ws.includes('\n')) out.push(ws);
        out.push(',');
        newline();
        break;
      }
      case ':':
        out.push(': ');
        atLineStart = false;
        break;
      case 'comment': {
        const line = t.text.startsWith('//');
        const prev = tokens[k - 1];
        // A comment that sat on the same line as the previous token stays trailing it.
        if (prev && atLineStart && !text.slice(prev.to, t.from).includes('\n')) {
          const ws = out.trimEnd(' \t');
          if (out.lastChar() === '\n') out.trimEnd('\n', 1);
          else out.push(ws);
          atLineStart = false;
        }
        if (!atLineStart && out.lastChar() !== ' ') out.push(' ');
        out.push(t.text);
        if (line) newline();
        else {
          out.push(' ');
          atLineStart = false;
        }
        break;
      }
      default:
        out.push(t.text);
        atLineStart = false;
    }
  }
  const lines = out.toString().split('\n');
  for (let j = 0; j < lines.length; j++) {
    const l = lines[j];
    let e = l.length;
    while (e > 0 && (l[e - 1] === ' ' || l[e - 1] === '\t')) e--;
    if (e < l.length) lines[j] = l.slice(0, e);
  }
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return { text: lines.join('\n'), error: null };
}

/** A string built from pieces, with cheap edits at the end. */
class TailBuffer {
  private parts: string[] = [];
  push(s: string): void {
    if (s) this.parts.push(s);
  }
  lastChar(): string {
    const last = this.parts[this.parts.length - 1];
    return last ? last[last.length - 1] : '';
  }
  /** Removes trailing characters found in `chars` (at most `max` of them) and returns what was removed. */
  trimEnd(chars: string, max = Infinity): string {
    let removed = '';
    while (this.parts.length && removed.length < max) {
      const i = this.parts.length - 1;
      const last = this.parts[i];
      let j = last.length;
      while (j > 0 && removed.length + (last.length - j) < max && chars.includes(last[j - 1])) j--;
      removed = last.slice(j) + removed;
      if (j > 0) {
        this.parts[i] = last.slice(0, j);
        break;
      }
      this.parts.pop();
    }
    return removed;
  }
  toString(): string {
    return this.parts.join('');
  }
}

/** Compact form of the same token stream (comments kept on their own). Handy for tests and size checks. */
export function significantTokens(text: string): string[] {
  return tokenizeJson(text).tokens.map((t) => t.text);
}

/**
 * Console capture for HTML sandboxes. `bridgeMain` is stringified and injected as the first
 * script of the srcdoc document, so it must be self-contained: no imports, no outer variables,
 * nothing that compiles to a helper. It posts `{ __sbx: channel, … }` messages to the parent,
 * which accepts them only from that frame's window and with the current channel id.
 */

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export interface ConsoleEntry {
  id: number;
  level: ConsoleLevel;
  text: string;
  /** Collapsed repeats of the same line. */
  count: number;
}

export type BridgeMessage = { type: 'console'; level: ConsoleLevel; text: string } | { type: 'clear' };

export function bridgeMain(win: any, channel: string, lineOffset: number): void {
  const MAX_TEXT = 10000;
  const MAX_ITEMS = 50;
  const post = (msg: any) => {
    try {
      win.parent.postMessage(Object.assign({ __sbx: channel }, msg), '*');
    } catch (e) {
      /* the parent went away */
    }
  };
  const fmt = (v: any, depth: number, seen: any): string => {
    const t = typeof v;
    if (t === 'string') return depth ? JSON.stringify(v) : v;
    if (t === 'bigint') return String(v) + 'n';
    if (v === null || t === 'number' || t === 'boolean' || t === 'undefined' || t === 'symbol') return String(v);
    if (t === 'function') return 'ƒ ' + (v.name || 'anonymous') + '()';
    if (v instanceof Error) return depth ? v.name + ': ' + v.message : v.stack || v.name + ': ' + v.message;
    if (win.Node && v instanceof win.Node) {
      if (v.nodeType === 1) {
        const id = v.id ? '#' + v.id : '';
        const cls = typeof v.className === 'string' && v.className.trim() ? '.' + v.className.trim().split(/\s+/).join('.') : '';
        return '<' + v.tagName.toLowerCase() + id + cls + '>';
      }
      return v.nodeName;
    }
    if (seen.has(v)) return '[Circular]';
    if (v instanceof Date) return isNaN(v.getTime()) ? 'Invalid Date' : v.toISOString();
    if (v instanceof RegExp) return String(v);
    if (depth > 2) return Array.isArray(v) ? 'Array(' + v.length + ')' : '{…}';
    seen.add(v);
    let out: string;
    if (Array.isArray(v)) {
      const items = v.slice(0, MAX_ITEMS).map((x: any) => fmt(x, depth + 1, seen));
      if (v.length > MAX_ITEMS) items.push('… ' + (v.length - MAX_ITEMS) + ' more');
      out = '[' + items.join(', ') + ']';
    } else if (v instanceof Map) {
      const items: string[] = [];
      v.forEach((val: any, key: any) => {
        if (items.length < MAX_ITEMS) items.push(fmt(key, depth + 1, seen) + ' => ' + fmt(val, depth + 1, seen));
      });
      out = 'Map(' + v.size + ') {' + items.join(', ') + '}';
    } else if (v instanceof Set) {
      const items: string[] = [];
      v.forEach((val: any) => {
        if (items.length < MAX_ITEMS) items.push(fmt(val, depth + 1, seen));
      });
      out = 'Set(' + v.size + ') {' + items.join(', ') + '}';
    } else {
      const keys = Object.keys(v);
      const items = keys.slice(0, MAX_ITEMS).map((k) => {
        let val: any;
        try {
          val = v[k];
        } catch (e) {
          val = '[unreadable]';
        }
        return (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)) + ': ' + fmt(val, depth + 1, seen);
      });
      if (keys.length > MAX_ITEMS) items.push('…');
      const ctor = v.constructor && v.constructor.name;
      out = (ctor && ctor !== 'Object' ? ctor + ' ' : '') + '{' + items.join(', ') + '}';
    }
    seen.delete(v);
    return out;
  };
  const format = (args: any[]): string => {
    const parts: string[] = [];
    let rest = args;
    if (typeof args[0] === 'string' && args[0].indexOf('%') !== -1) {
      let i = 1;
      const head = args[0].replace(/%([sdifoOc%])/g, (m: string, f: string) => {
        if (f === '%') return '%';
        if (i >= args.length) return m;
        const a = args[i++];
        if (f === 'c') return '';
        if (f === 's') return typeof a === 'string' ? a : fmt(a, 1, new WeakSet());
        if (f === 'd' || f === 'i') return String(parseInt(a, 10));
        if (f === 'f') return String(parseFloat(a));
        return fmt(a, 1, new WeakSet());
      });
      parts.push(head);
      rest = args.slice(i);
    }
    for (const a of rest) parts.push(fmt(a, 0, new WeakSet()));
    const text = parts.join(' ');
    return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + '… (truncated)' : text;
  };
  const con = win.console;
  const levels: [string, ConsoleLevel][] = [
    ['log', 'log'],
    ['info', 'info'],
    ['warn', 'warn'],
    ['error', 'error'],
    ['debug', 'debug'],
    ['trace', 'log'],
    ['dir', 'log'],
    ['table', 'log'],
  ];
  for (const [method, level] of levels) {
    const original = con[method];
    con[method] = function (...args: any[]) {
      post({ type: 'console', level, text: format(args) });
      if (typeof original === 'function') return original.apply(con, args);
    };
  }
  const originalAssert = con.assert;
  con.assert = function (cond: any, ...args: any[]) {
    if (!cond) post({ type: 'console', level: 'error', text: 'Assertion failed' + (args.length ? ': ' + format(args) : '') });
    if (typeof originalAssert === 'function') return originalAssert.apply(con, [cond, ...args]);
  };
  const originalClear = con.clear;
  con.clear = function () {
    post({ type: 'clear' });
    if (typeof originalClear === 'function') return originalClear.apply(con);
  };
  win.addEventListener('error', (e: any) => {
    if (!e || typeof e.message !== 'string') return;
    const inDoc = e.filename === 'about:srcdoc' && e.lineno;
    const where = inDoc ? ' (line ' + Math.max(1, e.lineno - lineOffset) + ')' : '';
    post({ type: 'console', level: 'error', text: e.message + where });
  });
  win.addEventListener('unhandledrejection', (e: any) => {
    post({ type: 'console', level: 'error', text: 'Uncaught (in promise) ' + fmt(e.reason, 0, new WeakSet()) });
  });
}

/**
 * Returns `html` with the bridge script inserted as the very first thing after any doctype,
 * so it runs before the page's own scripts. Error line numbers are shifted back by the lines
 * the injected tag adds, so they match the editor.
 */
export function withBridge(html: string, channel: string): string {
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)?.[0] ?? '';
  const rest = html.slice(doctype.length);
  // `<` escaped so no channel value can close the script tag early.
  const chan = JSON.stringify(channel).replace(/</g, '\\u003c');
  const call = (offset: number) => `<script>(${bridgeMain.toString()})(window, ${chan}, ${offset});</script>`;
  const added = (call(0).match(/\n/g) ?? []).length;
  return doctype + call(added) + rest;
}

export function parseBridgeMessage(data: unknown, channel: string): BridgeMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.__sbx !== channel) return null;
  if (d.type === 'clear') return { type: 'clear' };
  if (d.type !== 'console' || typeof d.text !== 'string') return null;
  const level: ConsoleLevel = ['log', 'info', 'warn', 'error', 'debug'].includes(d.level as string) ? (d.level as ConsoleLevel) : 'log';
  return { type: 'console', level, text: d.text.slice(0, 20000) };
}

export const MAX_ENTRIES = 500;

/** Appends a message to the log, collapsing an identical repeat of the last line and capping the length. */
export function appendEntry(log: ConsoleEntry[], msg: BridgeMessage, nextId: number): ConsoleEntry[] {
  if (msg.type === 'clear') return [];
  const last = log[log.length - 1];
  if (last && last.level === msg.level && last.text === msg.text) {
    return [...log.slice(0, -1), { ...last, count: last.count + 1 }];
  }
  const next = [...log, { id: nextId, level: msg.level, text: msg.text, count: 1 }];
  return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
}

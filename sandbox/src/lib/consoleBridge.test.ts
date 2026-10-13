import { describe, expect, it } from 'vitest';
import { appendEntry, bridgeMain, MAX_ENTRIES, parseBridgeMessage, withBridge, type ConsoleEntry } from './consoleBridge';

/** A minimal fake window: records posted messages and lets tests fire events. */
function fakeWindow() {
  const posted: Record<string, unknown>[] = [];
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const native: string[] = [];
  const consoleObj: Record<string, unknown> = {};
  for (const m of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir', 'table', 'clear', 'assert']) {
    consoleObj[m] = (...args: unknown[]) => native.push(`${m}:${args.length}`);
  }
  const win = {
    console: consoleObj,
    parent: { postMessage: (msg: Record<string, unknown>, origin: string) => posted.push({ ...msg, origin }) },
    addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] ??= []).push(fn),
    fire: (type: string, e: unknown) => listeners[type]?.forEach((fn) => fn(e)),
  };
  return { win, posted, native, console: consoleObj as Record<string, (...a: unknown[]) => void> };
}

/** Runs the bridge exactly as the frame would: from its stringified source. */
function install(lineOffset = 0) {
  const f = fakeWindow();
  const run = new Function('win', `(${bridgeMain.toString()})(win, "chan", ${lineOffset});`);
  run(f.win);
  return f;
}

describe('bridgeMain', () => {
  it('forwards console calls with the channel and still calls the original', () => {
    const { posted, native, console } = install();
    console.log('hello', 42, true, null, undefined);
    console.warn('careful');
    expect(posted[0]).toMatchObject({ __sbx: 'chan', type: 'console', level: 'log', text: 'hello 42 true null undefined', origin: '*' });
    expect(posted[1]).toMatchObject({ level: 'warn', text: 'careful' });
    expect(native).toEqual(['log:5', 'warn:1']);
  });

  it('formats objects, arrays, maps, sets, errors and cycles', () => {
    const { posted, console } = install();
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    console.log({ a: 1, 'b-c': 'x', nested: { deep: [1, 2] } });
    console.log([1, 'two', [3]]);
    console.log(new Map([['k', 1]]), new Set([1, 2]));
    console.log(cyclic);
    console.log(function named() {}, Symbol('s'), 10n);
    console.error(new TypeError('boom'));
    const texts = posted.map((p) => p.text);
    expect(texts[0]).toBe('{a: 1, "b-c": "x", nested: {deep: [1, 2]}}');
    expect(texts[1]).toBe('[1, "two", [3]]');
    expect(texts[2]).toBe('Map(1) {"k" => 1} Set(2) {1, 2}');
    expect(texts[3]).toBe('{a: 1, self: [Circular]}');
    expect(texts[4]).toBe('ƒ named() Symbol(s) 10n');
    expect(texts[5]).toMatch(/^TypeError: boom/);
  });

  it('applies printf-style substitutions and drops %c styles', () => {
    const { posted, console } = install();
    console.log('%cStyled%c %s has %d items (%i%%)', 'color:red', '', 'cart', '3.7', 42.9, 'extra');
    expect(posted[0].text).toBe('Styled cart has 3 items (42%) extra');
  });

  it('maps trace/dir/table to log, reports failed asserts and clear', () => {
    const { posted, console } = install();
    console.table([1]);
    console.assert(true, 'fine');
    console.assert(false, 'x is', 2);
    console.clear();
    expect(posted.map((p) => [p.type, p.level, p.text])).toEqual([
      ['console', 'log', '[1]'],
      ['console', 'error', 'Assertion failed: x is 2'],
      ['clear', undefined, undefined],
    ]);
  });

  it('reports uncaught errors with editor line numbers, and unhandled rejections', () => {
    const { posted, win } = install(3);
    win.fire('error', { message: 'Uncaught ReferenceError: x is not defined', filename: 'about:srcdoc', lineno: 15 });
    win.fire('error', { message: 'Script error.', filename: 'https://cdn.example/x.js', lineno: 1 });
    win.fire('error', { target: 'img' }); // resource errors have no message
    win.fire('unhandledrejection', { reason: new Error('nope') });
    expect(posted.map((p) => p.text)).toEqual(['Uncaught ReferenceError: x is not defined (line 12)', 'Script error.', expect.stringMatching(/^Uncaught \(in promise\) Error: nope/)]);
  });

  it('truncates huge output', () => {
    const { posted, console } = install();
    console.log('x'.repeat(20000));
    expect((posted[0].text as string).length).toBeLessThan(10100);
    expect(posted[0].text).toMatch(/truncated\)$/);
  });
});

describe('withBridge', () => {
  it('injects right after the doctype so the page keeps standards mode', () => {
    const out = withBridge('<!DOCTYPE html>\n<p>hi</p>', 'c1');
    expect(out.startsWith('<!DOCTYPE html><script>')).toBe(true);
    expect(out.endsWith('</script>\n<p>hi</p>')).toBe(true);
    expect(out).toContain('"c1"');
  });

  it('injects at the start when there is no doctype', () => {
    expect(withBridge('<p>hi</p>', 'c').startsWith('<script>')).toBe(true);
  });

  it('passes the number of lines it added, so error lines match the editor', () => {
    const out = withBridge('<!doctype html>\nline2', 'c');
    const added = out.indexOf('\nline2') === -1 ? 0 : (out.slice(0, out.indexOf('\nline2')).match(/\n/g) ?? []).length;
    expect(out).toMatch(new RegExp(`"c", ${added}\\);</script>`));
  });

  it('cannot be closed early by the channel id', () => {
    const out = withBridge('', '</script><script>alert(1)//');
    expect(out.match(/<\/script>/gi)).toHaveLength(1);
    expect(out).toContain('"\\u003c/script>\\u003cscript>alert(1)//"');
  });
});

describe('parseBridgeMessage', () => {
  it('accepts only messages for the current channel', () => {
    expect(parseBridgeMessage({ __sbx: 'a', type: 'console', level: 'warn', text: 'x' }, 'a')).toEqual({ type: 'console', level: 'warn', text: 'x' });
    expect(parseBridgeMessage({ __sbx: 'old', type: 'console', level: 'log', text: 'x' }, 'a')).toBeNull();
    expect(parseBridgeMessage({ __sbx: 'a', type: 'clear' }, 'a')).toEqual({ type: 'clear' });
    expect(parseBridgeMessage('string', 'a')).toBeNull();
    expect(parseBridgeMessage({ __sbx: 'a', type: 'console', level: 'evil', text: 'x' }, 'a')).toMatchObject({ level: 'log' });
    expect(parseBridgeMessage({ __sbx: 'a', type: 'console', text: 5 }, 'a')).toBeNull();
  });
});

describe('appendEntry', () => {
  it('collapses identical repeats, clears, and caps the log', () => {
    let log: ConsoleEntry[] = [];
    log = appendEntry(log, { type: 'console', level: 'log', text: 'a' }, 1);
    log = appendEntry(log, { type: 'console', level: 'log', text: 'a' }, 2);
    log = appendEntry(log, { type: 'console', level: 'warn', text: 'a' }, 3);
    expect(log.map((e) => [e.level, e.count])).toEqual([
      ['log', 2],
      ['warn', 1],
    ]);
    expect(appendEntry(log, { type: 'clear' }, 4)).toEqual([]);
    for (let i = 0; i < MAX_ENTRIES + 10; i++) log = appendEntry(log, { type: 'console', level: 'log', text: String(i) }, i + 10);
    expect(log).toHaveLength(MAX_ENTRIES);
    expect(log[log.length - 1].text).toBe(String(MAX_ENTRIES + 9));
  });
});

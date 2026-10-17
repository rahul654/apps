import { describe, expect, it } from 'vitest';
import { closeTabs, EMPTY_TABS, exampleTabId, newTabId, openTab, otherTabIds, parseTabId, pinTab, pruneTabs, replaceTabId, requestTabId, sanitizeTabs, tabIdsToRight, tabRoute, type TabsState } from './tabs';

const a = requestTabId('c1', 'a');
const b = requestTabId('c1', 'b');
const c = requestTabId('c1', 'c');
const ids = (s: TabsState) => s.tabs.map((t) => (t.preview ? `(${t.id})` : t.id));

describe('tab ids and routes', () => {
  it('round-trips every kind, even with ":" and "/" in ids', () => {
    expect(parseTabId(requestTabId('col:1', 'it/2'))).toEqual({ kind: 'request', cid: 'col:1', iid: 'it/2' });
    expect(parseTabId(exampleTabId('c', 'i', 'e'))).toEqual({ kind: 'example', cid: 'c', iid: 'i', eid: 'e' });
    expect(parseTabId(newTabId('t1'))).toEqual({ kind: 'new', tid: 't1' });
    expect(parseTabId('x:1')).toBeNull();
    expect(parseTabId('r:only')).toBeNull();
    expect(tabRoute(requestTabId('col:1', 'it/2'))).toBe('/r/col%3A1/it%2F2');
    expect(tabRoute(exampleTabId('c', 'i', 'e'))).toBe('/e/c/i/e');
    expect(tabRoute(newTabId('t1'))).toBe('/new/t1');
  });
});

describe('preview tabs', () => {
  it('a single click opens a preview tab that the next single click replaces in place', () => {
    let s = openTab(EMPTY_TABS, a);
    s = openTab(s, b, { preview: true });
    expect(ids(s)).toEqual([a, `(${b})`]);
    s = openTab(s, c, { preview: true });
    expect(ids(s)).toEqual([a, `(${c})`]);
    expect(s.activeId).toBe(c);
  });

  it('opening an open tab focuses it; a non-preview open (double click) makes it permanent', () => {
    let s = openTab(openTab(EMPTY_TABS, a), b, { preview: true });
    s = openTab(s, a, { preview: true });
    expect(s.activeId).toBe(a);
    expect(ids(s)).toEqual([a, `(${b})`]);
    s = openTab(s, b);
    expect(ids(s)).toEqual([a, b]);
    expect(openTab(s, b)).toEqual({ ...s, activeId: b });
  });

  it('a preview tab with unsaved changes is not replaced; pinTab makes it permanent', () => {
    let s = openTab(EMPTY_TABS, a, { preview: true });
    s = openTab(s, b, { preview: true, isDirty: (id) => id === a });
    expect(ids(s)).toEqual([`(${a})`, `(${b})`]);
    s = pinTab(s, b);
    expect(ids(s)).toEqual([`(${a})`, b]);
    expect(pinTab(s, b)).toBe(s);
  });
});

describe('closing', () => {
  const three = (): TabsState => ({ tabs: [{ id: a }, { id: b }, { id: c }], activeId: b });
  it('closing the active tab activates its right neighbour, else the left one', () => {
    expect(closeTabs(three(), [b])).toEqual({ tabs: [{ id: a }, { id: c }], activeId: c });
    expect(closeTabs({ ...three(), activeId: c }, [c]).activeId).toBe(b);
    expect(closeTabs(three(), [a]).activeId).toBe(b);
    expect(closeTabs(three(), [a, b, c])).toEqual(EMPTY_TABS);
    expect(closeTabs(three(), ['nope'])).toEqual(three());
  });

  it('close others / to the right', () => {
    expect(otherTabIds(three(), b)).toEqual([a, c]);
    expect(tabIdsToRight(three(), a)).toEqual([b, c]);
    expect(closeTabs(three(), otherTabIds(three(), b))).toEqual({ tabs: [{ id: b }], activeId: b });
  });

  it('prunes tabs whose target is gone', () => {
    expect(pruneTabs(three(), (id) => id !== b)).toEqual({ tabs: [{ id: a }, { id: c }], activeId: c });
  });
});

describe('replace and sanitize', () => {
  it('a saved new request keeps its position and active state', () => {
    const n = newTabId('t');
    const s = replaceTabId({ tabs: [{ id: a }, { id: n }, { id: c }], activeId: n }, n, b);
    expect(s).toEqual({ tabs: [{ id: a }, { id: b }, { id: c }], activeId: b });
  });

  it('drops malformed and duplicate entries; a missing active id falls back to the last tab', () => {
    expect(sanitizeTabs(null)).toEqual(EMPTY_TABS);
    expect(sanitizeTabs({ tabs: [{ id: a }, { id: a }, { id: 'bad' }, 3, { id: b, preview: true }], activeId: 'gone' })).toEqual({ tabs: [{ id: a }, { id: b, preview: true }], activeId: b });
  });
});

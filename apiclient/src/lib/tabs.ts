/**
 * Postman-style request tabs, per workspace. Pure functions over `TabsState`; the store persists it.
 *
 * A tab id encodes what it shows:
 *   r:<cid>:<iid>         a saved request
 *   e:<cid>:<iid>:<eid>   a saved example (a response in that request's `response[]`)
 *   n:<tid>               a new request that is not in any collection yet (its item lives in drafts)
 * Parts are URI-encoded, so ids containing ':' stay unambiguous.
 *
 * Preview tabs: a single click opens a temporary tab (italic) that the next single click replaces.
 * Editing it or double-clicking makes it permanent.
 */

export interface TabRef {
  id: string;
  /** Temporary tab, replaced by the next preview open. */
  preview?: boolean;
}

export interface TabsState {
  tabs: TabRef[];
  activeId: string | null;
}

export const EMPTY_TABS: TabsState = { tabs: [], activeId: null };

export type TabTarget = { kind: 'request'; cid: string; iid: string } | { kind: 'example'; cid: string; iid: string; eid: string } | { kind: 'new'; tid: string };

const enc = encodeURIComponent;

export const requestTabId = (cid: string, iid: string): string => `r:${enc(cid)}:${enc(iid)}`;
export const exampleTabId = (cid: string, iid: string, eid: string): string => `e:${enc(cid)}:${enc(iid)}:${enc(eid)}`;
export const newTabId = (tid: string): string => `n:${enc(tid)}`;

export function parseTabId(id: string): TabTarget | null {
  const [kind, ...rest] = id.split(':');
  let parts: string[];
  try {
    parts = rest.map(decodeURIComponent);
  } catch {
    return null;
  }
  if (kind === 'r' && parts.length === 2 && parts.every(Boolean)) return { kind: 'request', cid: parts[0], iid: parts[1] };
  if (kind === 'e' && parts.length === 3 && parts.every(Boolean)) return { kind: 'example', cid: parts[0], iid: parts[1], eid: parts[2] };
  if (kind === 'n' && parts.length === 1 && parts[0]) return { kind: 'new', tid: parts[0] };
  return null;
}

/** The hash route that shows a tab. */
export function tabRoute(id: string): string {
  const t = parseTabId(id);
  if (!t) return '/';
  if (t.kind === 'request') return `/r/${enc(t.cid)}/${enc(t.iid)}`;
  if (t.kind === 'example') return `/e/${enc(t.cid)}/${enc(t.iid)}/${enc(t.eid)}`;
  return `/new/${enc(t.tid)}`;
}

/**
 * Opens (or focuses) a tab and makes it active.
 * - already open: focus it; a non-preview open also makes it permanent.
 * - preview: replaces the current preview tab in place (unless it has unsaved changes), else appends.
 * - otherwise: appends a permanent tab.
 */
export function openTab(s: TabsState, id: string, opts: { preview?: boolean; isDirty?: (id: string) => boolean } = {}): TabsState {
  const existing = s.tabs.find((t) => t.id === id);
  if (existing) {
    const tabs = !opts.preview && existing.preview ? s.tabs.map((t) => (t.id === id ? { id } : t)) : s.tabs;
    return tabs === s.tabs && s.activeId === id ? s : { tabs, activeId: id };
  }
  const tab: TabRef = opts.preview ? { id, preview: true } : { id };
  if (opts.preview) {
    const i = s.tabs.findIndex((t) => t.preview && !opts.isDirty?.(t.id));
    if (i >= 0) return { tabs: s.tabs.map((t, j) => (j === i ? tab : t)), activeId: id };
  }
  return { tabs: [...s.tabs, tab], activeId: id };
}

/** Makes a preview tab permanent. */
export function pinTab(s: TabsState, id: string): TabsState {
  return s.tabs.some((t) => t.id === id && t.preview) ? { ...s, tabs: s.tabs.map((t) => (t.id === id ? { id } : t)) } : s;
}

export function activateTab(s: TabsState, id: string): TabsState {
  return s.activeId === id || !s.tabs.some((t) => t.id === id) ? s : { ...s, activeId: id };
}

/** Closes tabs. When the active one goes, its right neighbour (else the left one) becomes active. */
export function closeTabs(s: TabsState, ids: string[]): TabsState {
  const drop = new Set(ids);
  if (!s.tabs.some((t) => drop.has(t.id))) return s;
  const tabs = s.tabs.filter((t) => !drop.has(t.id));
  let activeId = s.activeId;
  if (activeId === null || drop.has(activeId)) {
    const i = s.tabs.findIndex((t) => t.id === activeId);
    const right = s.tabs.slice(i + 1).find((t) => !drop.has(t.id));
    const left = s.tabs.slice(0, Math.max(0, i)).reverse().find((t) => !drop.has(t.id));
    activeId = (right ?? left)?.id ?? null;
  }
  return { tabs, activeId };
}

/** Ids of the tabs "Close others" / "Close to the right" would close. */
export function otherTabIds(s: TabsState, id: string): string[] {
  return s.tabs.filter((t) => t.id !== id).map((t) => t.id);
}
export function tabIdsToRight(s: TabsState, id: string): string[] {
  const i = s.tabs.findIndex((t) => t.id === id);
  return i < 0 ? [] : s.tabs.slice(i + 1).map((t) => t.id);
}

/** Swaps a tab's id in place (a new request saved into a collection becomes a request tab). */
export function replaceTabId(s: TabsState, from: string, to: string): TabsState {
  if (!s.tabs.some((t) => t.id === from)) return s;
  const tabs = s.tabs.filter((t) => t.id !== to).map((t) => (t.id === from ? { id: to } : t));
  return { tabs, activeId: s.activeId === from ? to : s.activeId };
}

/** Drops tabs whose target no longer exists (deleted request, collection or example). */
export function pruneTabs(s: TabsState, exists: (id: string) => boolean): TabsState {
  const gone = s.tabs.filter((t) => !exists(t.id)).map((t) => t.id);
  return gone.length ? closeTabs(s, gone) : s;
}

/** Validates a stored value; anything malformed becomes empty. */
export function sanitizeTabs(x: unknown): TabsState {
  const o = x as Partial<TabsState> | null;
  if (!o || !Array.isArray(o.tabs)) return EMPTY_TABS;
  const seen = new Set<string>();
  const tabs: TabRef[] = [];
  for (const t of o.tabs) {
    if (!t || typeof t.id !== 'string' || seen.has(t.id) || !parseTabId(t.id)) continue;
    seen.add(t.id);
    tabs.push(t.preview ? { id: t.id, preview: true } : { id: t.id });
  }
  const activeId = typeof o.activeId === 'string' && seen.has(o.activeId) ? o.activeId : (tabs[tabs.length - 1]?.id ?? null);
  return { tabs, activeId };
}

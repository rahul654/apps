/**
 * Top-bar search (Ctrl/Cmd+K, or "/" outside text fields): pick a collection (or all) and what to
 * search (request names, URLs, saved responses), type, then open a result with Enter or a click.
 * The chosen collection and fields are remembered in prefs; nothing typed is stored.
 */
import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { collectionId } from '../lib/postman/normalize';
import { SEARCH_FIELDS, searchCollections, type SearchField, type SearchResult } from '../lib/search';
import { exampleTabId, requestTabId, tabRoute } from '../lib/tabs';
import { useAppStore } from '../store/AppStore';
import { IconExample, IconSearch } from './Icons';
import { MethodTag } from './ui';

const FIELD_LABEL: Record<SearchField, string> = { name: 'name', url: 'URL', response: 'saved response' };
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** The top-bar trigger and, when open, the panel. */
export function SearchButton() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="search-trigger"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts="Control+K Meta+K"
        aria-label="Search requests and saved responses"
        title={`Search (${isMac ? '⌘' : 'Ctrl'}+K)`}
      >
        <IconSearch size={15} />
        <span className="search-label">Search…</span>
        <kbd className="search-kbd">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
      {open && (
        <SearchPanel
          onClose={() => {
            setOpen(false);
            requestAnimationFrame(() => trigger.current?.focus());
          }}
        />
      )}
    </>
  );
}

let lastQuery = '';

function SearchPanel({ onClose }: { onClose: () => void }) {
  const { state, dispatch, getState } = useAppStore();
  const navigate = useNavigate();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState(lastQuery);
  const [active, setActive] = useState(0);
  const deferred = useDeferredValue(query);
  const { search } = state.prefs;
  // A collection picked in another workspace doesn't exist here: search all.
  const cid = search.cid && state.collections.some((c) => collectionId(c) === search.cid) ? search.cid : null;
  const setSearch = (patch: Partial<typeof search>) => {
    const prefs = getState().prefs;
    dispatch({ type: 'prefs/set', prefs: { ...prefs, search: { ...prefs.search, ...patch } } });
  };

  const results = useMemo(() => searchCollections(state.collections, deferred, { cid, fields: search.fields, limit: 100 }), [state.collections, deferred, cid, search.fields]);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  useEffect(() => setActive(0), [deferred, cid, search.fields]);
  useEffect(() => {
    lastQuery = query;
  }, [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  const open = (r: SearchResult) => {
    onClose();
    navigate(tabRoute(r.kind === 'response' ? exampleTabId(r.cid, r.iid, r.eid!) : requestTabId(r.cid, r.iid)));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if ((e.target as HTMLElement).tagName === 'SELECT') return;
      e.preventDefault();
      if (results.length) setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length);
    } else if (e.key === 'Enter' && (e.target as HTMLElement) === input.current) {
      e.preventDefault();
      if (results[active]) open(results[active]);
    } else if (e.key === 'Tab') {
      // Keep focus inside the panel.
      const f = [...(panel.current?.querySelectorAll<HTMLElement>('input, select, button:not([disabled])') ?? [])];
      if (!f.length) return;
      const i = f.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && i === f.length - 1) {
        e.preventDefault();
        f[0].focus();
      }
    }
  };

  const toggleField = (f: SearchField, on: boolean) => {
    const next = SEARCH_FIELDS.map((x) => x.id).filter((x) => (x === f ? on : search.fields.includes(x)));
    setSearch({ fields: next });
  };

  const optionId = (i: number) => `${id}-opt-${i}`;
  return (
    <div className="search-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} className="search-panel" role="dialog" aria-modal="true" aria-label="Search requests and saved responses" onKeyDown={onKeyDown}>
        <div className="search-input-row">
          <IconSearch size={17} />
          <input
            ref={input}
            className="search-input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search requests, URLs, saved responses…"
            aria-label="Search text"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls={`${id}-results`}
            aria-activedescendant={results[active] ? optionId(active) : undefined}
            aria-autocomplete="list"
            spellCheck={false}
            autoComplete="off"
          />
          <kbd className="search-kbd">Esc</kbd>
        </div>
        <div className="search-filters">
          <label className="row nowrap small">
            <span className="muted">Collection</span>
            <select className="input compact" value={cid ?? ''} onChange={(e) => setSearch({ cid: e.target.value || null })} aria-label="Collection to search">
              <option value="">All collections</option>
              {state.collections.map((c) => (
                <option key={collectionId(c)} value={collectionId(c)}>
                  {c.info.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="search-fields">
            <legend className="sr-only">Search in</legend>
            <span className="muted small" aria-hidden="true">In</span>
            {SEARCH_FIELDS.map((f) => (
              <label key={f.id} className="check small">
                <input type="checkbox" checked={search.fields.includes(f.id)} onChange={(e) => toggleField(f.id, e.target.checked)} /> {f.label}
              </label>
            ))}
          </fieldset>
        </div>
        <ul ref={list} className="search-results" id={`${id}-results`} role="listbox" aria-label="Results">
          {results.map((r, i) => (
            <li
              key={`${r.kind}:${r.cid}:${r.iid}:${r.eid ?? ''}`}
              id={optionId(i)}
              data-i={i}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'search-result active' : 'search-result'}
              onMouseMove={() => i !== active && setActive(i)}
              onClick={() => open(r)}
            >
              <div className="row nowrap search-result-title">
                <MethodTag method={r.method} />
                <span className="search-name">{r.name}</span>
                {r.kind === 'response' && (
                  <span className="search-example">
                    <IconExample size={13} /> {r.exampleName}
                  </span>
                )}
              </div>
              <div className="tiny muted search-where">
                {[r.collectionName, ...r.path].join(' / ')} · {r.matched.map((m) => FIELD_LABEL[m]).join(', ')}
              </div>
              <div className="tiny mono search-snippet">
                {r.snippet.before}
                <mark>{r.snippet.match}</mark>
                {r.snippet.after}
              </div>
            </li>
          ))}
        </ul>
        <p className="tiny muted search-status" role="status">
          {!search.fields.length
            ? 'Tick at least one of Request names, URLs or Saved responses.'
            : !deferred.trim()
              ? `Type to search ${cid ? 'this collection' : `${state.collections.length} collection${state.collections.length === 1 ? '' : 's'}`}. ↑↓ to choose, Enter to open.`
              : results.length
                ? `${results.length === 100 ? '100+' : results.length} result${results.length === 1 ? '' : 's'}`
                : 'No matches.'}
        </p>
      </div>
    </div>
  );
}

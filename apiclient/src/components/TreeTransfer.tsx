/**
 * Sidebar drag and drop (Postman-style) plus the "Move or copy to…" dialog.
 *
 * Drag a request or folder onto: a collection (into its root), a folder (into it; top/bottom edge =
 * before/after it), or a request (before/after it). Within one collection it simply moves; into
 * another collection a small menu asks Move or Copy. Every change has Undo. Moved requests keep
 * their ids, so open tabs, unsaved edits and the last response follow them (lib/postman/transfer).
 */
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { collectionId } from '../lib/postman/normalize';
import { findItem } from '../lib/postman/items';
import { destinationName, destinationOptions, transferItem, transferProblem, type DropDest, type ItemRef, type TransferMode } from '../lib/postman/transfer';
import type { PmCollection } from '../lib/postman/types';
import { replaceTabId, tabRoute } from '../lib/tabs';
import { useAppStore } from '../store/AppStore';
import { moveRuntime, runtimeKey } from '../store/tabRuntime';
import { Modal } from './Modal';

export type DropPlace = 'into' | 'before' | 'after';

/** What a tree row is, for working out where a drop lands. */
export type RowTarget =
  | { kind: 'collection'; cid: string; open: boolean; expand: () => void }
  | { kind: 'folder'; cid: string; id: string; parentId: string | null; index: number; open: boolean; expand: () => void }
  | { kind: 'request'; cid: string; id: string; parentId: string | null; index: number };

const rowKey = (t: RowTarget) => (t.kind === 'collection' ? `c:${t.cid}` : `${t.cid}:${t.id}`);

function placeFor(t: RowTarget, e: DragEvent<HTMLElement>): DropPlace {
  if (t.kind === 'collection') return 'into';
  const r = e.currentTarget.getBoundingClientRect();
  const y = r.height ? (e.clientY - r.top) / r.height : 0.5;
  if (t.kind === 'folder') return y < 0.25 ? 'before' : y > 0.75 && !t.open ? 'after' : 'into';
  return y < 0.5 ? 'before' : 'after';
}

function destFor(t: RowTarget, place: DropPlace): DropDest {
  if (t.kind === 'collection') return { cid: t.cid, parentId: null };
  if (place === 'into') return { cid: t.cid, parentId: t.id, ...(t.kind === 'folder' && t.open ? { index: 0 } : {}) };
  return { cid: t.cid, parentId: t.parentId, index: t.index + (place === 'after' ? 1 : 0) };
}

export interface TreeDnd {
  /** Props for a draggable request/folder row. */
  source: (ref: ItemRef & { name: string }) => { draggable: true; onDragStart: (e: DragEvent<HTMLElement>) => void; onDragEnd: () => void };
  /** Props that make a row a drop target, and its highlight class. */
  target: (t: RowTarget) => { onDragOver: (e: DragEvent<HTMLElement>) => void; onDragLeave: (e: DragEvent<HTMLElement>) => void; onDrop: (e: DragEvent<HTMLElement>) => void; className: string };
  /** Open the "Move or copy to…" dialog for an item. */
  chooseDestination: (ref: ItemRef & { name: string }) => void;
}

export function useTreeTransfer({ showToast, currentTabId }: { showToast: (msg: string, action?: { label: string; onClick: () => void }) => void; currentTabId: string | null }): [TreeDnd, ReactNode] {
  const { dispatch, drafts, setDraft, setTabs, getState } = useAppStore();
  const navigate = useNavigate();
  const dragging = useRef<(ItemRef & { name: string }) | null>(null);
  const [hint, setHint] = useState<{ key: string; place: DropPlace } | null>(null);
  const [choice, setChoice] = useState<{ from: ItemRef & { name: string }; dest: DropDest; x: number; y: number } | null>(null);
  const [dialog, setDialog] = useState<(ItemRef & { name: string }) | null>(null);
  const expandTimer = useRef<{ key: string; t: ReturnType<typeof setTimeout> } | null>(null);
  // Read at call time: Undo runs later, after the open tab may itself have moved.
  const currentTab = useRef(currentTabId);
  currentTab.current = currentTabId;

  const clearExpand = () => {
    if (expandTimer.current) clearTimeout(expandTimer.current.t);
    expandTimer.current = null;
  };

  /** Saves collections and re-points tabs/drafts/responses; navigates if the open tab moved. */
  const apply = (collections: PmCollection[], tabMoves: [string, string][]) => {
    const ws = getState().activeWorkspaceId;
    for (const [from, to] of tabMoves) {
      const d = drafts.get(from);
      if (d !== undefined) {
        setDraft(to, d);
        setDraft(from, undefined);
      }
      moveRuntime(runtimeKey(ws, from), runtimeKey(ws, to));
    }
    if (tabMoves.length) setTabs((s) => tabMoves.reduce((acc, [f, t]) => replaceTabId(acc, f, t), s));
    for (const c of collections) dispatch({ type: 'collection/put', collection: c });
    const moved = tabMoves.find(([f]) => f === currentTab.current);
    if (moved) navigate(tabRoute(moved[1]), { replace: true });
  };

  const run = (from: ItemRef & { name: string }, dest: DropDest, mode: TransferMode) => {
    const collections = getState().collections;
    const problem = transferProblem(collections, from, dest, mode);
    if (problem) {
      if (!/already there/.test(problem)) showToast(problem);
      return;
    }
    const result = transferItem(collections, from, dest, mode)!;
    const before = result.changed.map((c) => collections.find((x) => collectionId(x) === collectionId(c))!);
    const where = destinationName(collections, dest);
    apply(result.changed, result.tabMoves);
    const verb = mode === 'copy' ? 'Copied' : 'Moved';
    showToast(`${verb} “${from.name}” to ${where}.`, {
      label: 'Undo',
      onClick: () => apply(before, result.tabMoves.map(([a, b]) => [b, a])),
    });
  };

  // The Move/Copy menu closes on Escape or a click elsewhere.
  useEffect(() => {
    if (!choice) return;
    const off = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e instanceof MouseEvent && (e.target as HTMLElement).closest?.('.drop-choice')) return;
      setChoice(null);
    };
    document.addEventListener('mousedown', off);
    document.addEventListener('keydown', off);
    document.querySelector<HTMLElement>('.drop-choice [role=menuitem]')?.focus();
    return () => {
      document.removeEventListener('mousedown', off);
      document.removeEventListener('keydown', off);
    };
  }, [choice]);

  const dnd: TreeDnd = {
    source: (ref) => ({
      draggable: true,
      onDragStart: (e) => {
        e.stopPropagation();
        dragging.current = ref;
        e.dataTransfer.effectAllowed = 'copyMove';
        e.dataTransfer.setData('application/x-apiclient-item', JSON.stringify({ cid: ref.cid, id: ref.id }));
        e.dataTransfer.setData('text/plain', ref.name);
      },
      onDragEnd: () => {
        dragging.current = null;
        setHint(null);
        clearExpand();
      },
    }),
    target: (t) => ({
      className: hint?.key === rowKey(t) ? `drop-${hint.place}` : '',
      onDragOver: (e) => {
        const from = dragging.current;
        if (!from) return;
        e.stopPropagation();
        const place = placeFor(t, e);
        const dest = destFor(t, place);
        // Inside one collection dragging reorders (move); elsewhere Move or Copy is asked.
        // Every same-collection spot accepts the drop, so dragging up/down never shows a
        // "not allowed" cursor; a spot where nothing changes is simply a no-op. Only a folder
        // into itself (or its own subfolder) is refused.
        const sameCollection = from.cid === dest.cid;
        const problem = sameCollection ? transferProblem(getState().collections, from, dest, 'move') : null;
        if (problem && !/already there/.test(problem)) {
          if (hint) setHint(null);
          return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = sameCollection ? 'move' : 'copy';
        const key = rowKey(t);
        if (hint?.key !== key || hint.place !== place) setHint({ key, place });
        // Hovering over a closed collection/folder opens it, so you can drop deeper.
        if (t.kind !== 'request' && !t.open && place === 'into') {
          if (expandTimer.current?.key !== key) {
            clearExpand();
            expandTimer.current = { key, t: setTimeout(t.expand, 700) };
          }
        } else if (expandTimer.current?.key === key) clearExpand();
      },
      onDragLeave: (e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setHint((h) => (h?.key === rowKey(t) ? null : h));
        if (expandTimer.current?.key === rowKey(t)) clearExpand();
      },
      onDrop: (e) => {
        const from = dragging.current;
        if (!from) return;
        e.preventDefault();
        e.stopPropagation();
        const dest = destFor(t, placeFor(t, e));
        dragging.current = null;
        setHint(null);
        clearExpand();
        if (from.cid === dest.cid) run(from, dest, 'move');
        else setChoice({ from, dest, x: Math.min(e.clientX, window.innerWidth - 230), y: Math.min(e.clientY, window.innerHeight - 140) });
      },
    }),
    chooseDestination: (ref) => setDialog(ref),
  };

  const ui = (
    <>
      {choice && (
        <div className="tree-menu drop-choice" role="menu" aria-label={`Move or copy ${choice.from.name}`} style={{ position: 'fixed', left: choice.x, top: choice.y }}>
          <p className="tiny muted drop-choice-title">
            “{choice.from.name}” → {destinationName(getState().collections, choice.dest)}
          </p>
          {(['move', 'copy'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="menuitem"
              onClick={() => {
                const c = choice;
                setChoice(null);
                run(c.from, c.dest, mode);
              }}
              onKeyDown={(e) => {
                const items = [...(e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];
                const i = items.indexOf(e.currentTarget);
                if (e.key === 'ArrowDown') items[(i + 1) % items.length]?.focus();
                else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length]?.focus();
                else return;
                e.preventDefault();
              }}
            >
              {mode === 'move' ? 'Move here' : 'Copy here'}
            </button>
          ))}
          <hr />
          <button type="button" role="menuitem" onClick={() => setChoice(null)}>
            Cancel
          </button>
        </div>
      )}
      {dialog && <MoveCopyDialog item={dialog} onCancel={() => setDialog(null)} onDone={(dest, mode) => {
        setDialog(null);
        run(dialog, dest, mode);
      }} />}
    </>
  );
  return [dnd, ui];
}

/** Keyboard / touch alternative to dragging: pick a collection or folder, then Move or Copy. */
function MoveCopyDialog({ item, onCancel, onDone }: { item: ItemRef & { name: string }; onCancel: () => void; onDone: (dest: DropDest, mode: TransferMode) => void }) {
  const { state } = useAppStore();
  const options = destinationOptions(state.collections);
  const src = state.collections.find((c) => collectionId(c) === item.cid);
  const loc = src ? findItem(src, item.id) : null;
  const currentParent = loc?.parents[loc.parents.length - 1]?.id ?? null;
  const initial = options.findIndex((o) => o.dest.cid !== item.cid) >= 0 ? options.findIndex((o) => o.dest.cid !== item.cid) : 0;
  const [sel, setSel] = useState(initial);
  const dest = options[sel]?.dest;
  const moveProblem = dest ? transferProblem(state.collections, item, dest, 'move') : 'Pick a place.';
  const here = dest && dest.cid === item.cid && dest.parentId === currentParent;
  return (
    <Modal
      title={`Move or copy “${item.name}”`}
      onCancel={onCancel}
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn" disabled={!dest} onClick={() => dest && onDone(dest, 'copy')}>Copy</button>
          <button type="button" className="btn primary" disabled={!!moveProblem} title={moveProblem ?? undefined} onClick={() => dest && onDone(dest, 'move')}>Move</button>
        </>
      }
    >
      <label className="field">
        <span>To collection or folder</span>
        <select className="input" value={sel} onChange={(e) => setSel(Number(e.target.value))}>
          {options.map((o, i) => (
            <option key={`${o.dest.cid}:${o.dest.parentId}`} value={i}>
              {'  '.repeat(o.depth)}
              {o.depth ? o.label.split(' / ').pop() : o.label}
              {o.dest.cid === item.cid && o.dest.parentId === currentParent ? ' (current)' : ''}
            </option>
          ))}
        </select>
      </label>
      {here ? <p className="tiny muted">That’s where it is now: Copy makes a duplicate next to it.</p> : moveProblem && !/already there/.test(moveProblem) ? <p className="tiny warn-text">{moveProblem}</p> : null}
      <p className="tiny muted">Moved requests keep their open tabs and unsaved edits. Copies get new ids.</p>
    </Modal>
  );
}

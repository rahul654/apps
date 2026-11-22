import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Composer } from '../components/Composer';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ItemCard } from '../components/ItemCard';
import { ItemViewer } from '../components/ItemViewer';
import { UploadPanel } from '../components/UploadPanel';
import { ApiError } from '../lib/api';
import { formatBytes } from '../lib/format';
import { matchesFilter, type Filter, type Item } from '../lib/items';
import { auth, openLogin } from '../store/auth';
import { useStore } from '../store/createStore';
import { deleteItems, library, refresh } from '../store/library';
import { toast } from '../store/toasts';
import { addFiles } from '../store/uploads';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'media', label: 'Photos & videos' },
  { id: 'text', label: 'Texts' },
  { id: 'other', label: 'Files' },
];

/** `/` is the list; `/i/:id` is the list with that item open in the viewer. */
export function LibraryPage() {
  const { id: openId } = useParams();
  const navigate = useNavigate();
  const lib = useStore(library);
  const signedIn = Boolean(useStore(auth).session);
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirm, setConfirm] = useState<null | { ids: string[]; fromViewer: boolean }>(null);
  const lastToggled = useRef<string | null>(null);

  const visible = useMemo(() => lib.items.filter((i) => matchesFilter(i, filter)), [lib.items, filter]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, lib.items.filter((i) => matchesFilter(i, f.id)).length])) as Record<Filter, number>, [lib.items]);

  // Drop selections of items that are gone, and all of them when signing out.
  useEffect(() => {
    setSelected((s) => {
      if (!signedIn) return s.size ? new Set() : s;
      const ids = new Set(lib.items.map((i) => i.id));
      const kept = [...s].filter((id) => ids.has(id));
      return kept.length === s.size ? s : new Set(kept);
    });
  }, [lib.items, signedIn]);

  const toggle = useCallback(
    (id: string, range: boolean) => {
      setSelected((s) => {
        const next = new Set(s);
        const anchor = lastToggled.current;
        const on = !s.has(id);
        if (range && anchor && anchor !== id) {
          const a = visible.findIndex((i) => i.id === anchor);
          const b = visible.findIndex((i) => i.id === id);
          if (a >= 0 && b >= 0) for (const i of visible.slice(Math.min(a, b), Math.max(a, b) + 1)) on ? next.add(i.id) : next.delete(i.id);
        } else if (on) next.add(id);
        else next.delete(id);
        return next;
      });
      lastToggled.current = id;
    },
    [visible],
  );

  // Viewer: the open item and its neighbours in the current filter (the whole list if it's filtered out).
  const sequence = openId && visible.some((i) => i.id === openId) ? visible : lib.items;
  const index = openId ? sequence.findIndex((i) => i.id === openId) : -1;
  const openItem: Item | undefined = index >= 0 ? sequence[index] : undefined;
  const go = (item?: Item) => navigate(item ? `/i/${encodeURIComponent(item.id)}` : '/', { replace: true });
  const close = useCallback(() => navigate('/'), [navigate]);

  const runDelete = async (ids: string[], fromViewer: boolean) => {
    // Where the viewer goes next: the following item, else the previous one, else closed.
    const after = fromViewer ? (sequence[index + 1] ?? sequence[index - 1]) : undefined;
    try {
      const { deleted, refused } = await deleteItems(ids);
      setSelected((s) => new Set([...s].filter((x) => !ids.includes(x))));
      toast(refused ? `Deleted ${deleted}; ${refused} couldn’t be deleted.` : `Deleted ${deleted} item${deleted === 1 ? '' : 's'} permanently.`, refused ? 'error' : 'ok');
      setConfirm(null);
      if (fromViewer) go(after);
    } catch (err) {
      setConfirm(null);
      if (!(err instanceof ApiError && err.isAuth)) toast(err instanceof ApiError ? err.message : 'Couldn’t delete.', 'error');
    }
  };

  // Drag files anywhere onto the page to upload them (signed in).
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const hasFiles = (e: React.DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  const dropHandlers = {
    onDragEnter: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current++;
      setDragging(true);
    },
    onDragLeave: () => {
      if (--dragDepth.current <= 0) {
        dragDepth.current = 0;
        setDragging(false);
      }
    },
    onDragOver: (e: React.DragEvent) => hasFiles(e) && e.preventDefault(),
    onDrop: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (signedIn) addFiles(e.dataTransfer.files);
      else openLogin('Enter the upload password, then drop the files again.');
    },
  };

  const selectedItems = lib.items.filter((i) => selected.has(i.id));
  const allVisibleSelected = visible.length > 0 && visible.every((i) => selected.has(i.id));

  return (
    <div className="library" {...dropHandlers}>
      <div className="toolbar">
        <div className="filters" role="tablist" aria-label="Show">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className={`chip${filter === f.id ? ' active' : ''}`} onClick={() => setFilter(f.id)}>
              {f.label}
              <span className="chip-count">{counts[f.id]}</span>
            </button>
          ))}
        </div>
        <div className="row">
          {signedIn && visible.length > 0 && (
            <label className="select-all small">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={() => setSelected((s) => (allVisibleSelected ? new Set([...s].filter((id) => !visible.some((i) => i.id === id))) : new Set([...s, ...visible.map((i) => i.id)])))}
              />
              Select all
            </label>
          )}
          <button type="button" className="icon-btn" onClick={() => void refresh()} aria-label="Refresh" title="Refresh">
            ↻
          </button>
        </div>
      </div>

      {lib.error && lib.status === 'ready' && <p className="notice small">{lib.error} Showing what was loaded before.</p>}

      {lib.status === 'loading' ? (
        <ul className="grid" aria-busy="true" aria-label="Loading">
          {Array.from({ length: 8 }, (_, i) => (
            <li key={i} className="card skeleton" />
          ))}
        </ul>
      ) : lib.status === 'error' ? (
        <div className="empty">
          <p className="error">{lib.error}</p>
          <button type="button" className="btn" onClick={() => void refresh()}>
            Try again
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty">
          <div className="empty-icon" aria-hidden="true">
            {filter === 'text' ? '📝' : '🗂️'}
          </div>
          <p>{lib.items.length ? 'Nothing here with this filter.' : 'Nothing shared yet.'}</p>
          {!lib.items.length && (
            <p className="muted small">{signedIn ? 'Attach photos, videos or files with 📎, or paste text below and press Send.' : 'Photos, videos, files and text uploaded here show up for everyone who opens this page.'}</p>
          )}
        </div>
      ) : (
        <ul className="grid">
          {visible.map((item) => (
            <ItemCard key={item.id} item={item} selectable={signedIn} selected={selected.has(item.id)} onToggle={toggle} onOpen={(id) => navigate(`/i/${encodeURIComponent(id)}`)} />
          ))}
        </ul>
      )}

      <div className="dock">
        <UploadPanel />
        {signedIn && selected.size > 0 && (
          <div className="selection-bar" role="region" aria-label="Selection">
            <span className="grow small">
              <strong>{selected.size} selected</strong> <span className="muted">({formatBytes(selectedItems.reduce((n, i) => n + i.size, 0))})</span>
            </span>
            <button type="button" className="btn ghost small" onClick={() => setSelected(new Set())}>
              Clear
            </button>
            <button type="button" className="btn danger small" onClick={() => setConfirm({ ids: [...selected], fromViewer: false })}>
              🗑 Delete
            </button>
          </div>
        )}
        {signedIn && <Composer />}
      </div>

      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div>{signedIn ? 'Drop to upload' : 'Sign in to upload'}</div>
        </div>
      )}

      {openId && lib.status === 'ready' && !openItem && !confirm && <MissingItem onClose={close} />}
      {openItem && !confirm && (
        <ItemViewer
          item={openItem}
          onClose={close}
          onPrev={index > 0 ? () => go(sequence[index - 1]) : undefined}
          onNext={index < sequence.length - 1 ? () => go(sequence[index + 1]) : undefined}
          canDelete={signedIn}
          onDelete={() => setConfirm({ ids: [openItem.id], fromViewer: true })}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm.ids.length === 1 ? 'Delete permanently?' : `Delete ${confirm.ids.length} items permanently?`}
          body={
            <p>
              {confirm.ids.length === 1 ? <strong>{lib.items.find((i) => i.id === confirm.ids[0])?.name ?? 'This item'}</strong> : `${confirm.ids.length} items`} will be removed from Google Drive for good. It skips the Drive
              Trash, so it can’t be undone.
            </p>
          }
          confirmLabel="Delete"
          danger
          onConfirm={() => runDelete(confirm.ids, confirm.fromViewer)}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

function MissingItem({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    toast('That item doesn’t exist any more.', 'error');
    onClose();
  }, [onClose]);
  return null;
}

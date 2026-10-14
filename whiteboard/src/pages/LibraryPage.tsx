import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { BoardCard, type CardActions } from '../components/BoardCard';
import { IconArchive, IconClose, IconPen, IconPlus, IconSearch, IconTemplate, IconUpload } from '../components/Icons';
import { Menu } from '../components/Menu';
import { TemplateDialog } from '../components/TemplateDialog';
import { ThemeToggle } from '../components/Theme';
import { useThumbnailFiller } from '../hooks/useThumbnailFiller';
import { downloadText } from '../lib/download';
import { serializeScene } from '../lib/excalidrawFile';
import { fileNameFor, searchBoards, sortBoards } from '../lib/format';
import { ACCEPT, describeImport, importFiles } from '../lib/importFiles';
import { getPrefs, setPrefs, type SortMode } from '../lib/prefs';
import type { Template } from '../lib/templates';
import { useBoards } from '../store/BoardsStore';

type Notice = { text: string; kind: 'info' | 'error' };

const hasFiles = (e: DragEvent) => [...e.dataTransfer.types].includes('Files');

export function LibraryPage() {
  const { store, boards, thumbs, loading, invalid, error, removed, remove, undoRemove, dismissRemoved } = useBoards();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>(() => getPrefs().sort);
  const [templates, setTemplates] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [dragDepth, setDragDepth] = useState(0);
  const [now, setNow] = useState(Date.now);
  const fileInput = useRef<HTMLInputElement>(null);
  const openAfterImport = useRef(false);

  useThumbnailFiller(store, boards, thumbs);

  useEffect(() => {
    document.title = 'Whiteboard';
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => setNow(Date.now()), [boards]);

  const visible = useMemo(() => sortBoards(searchBoards(boards, query), sort), [boards, query, sort]);

  const fail = (e: unknown) => setNotice({ text: e instanceof Error ? e.message : String(e), kind: 'error' });

  const createBlank = async () => {
    try {
      const m = await store.create();
      navigate(`/b/${m.id}`);
    } catch (e) {
      fail(e);
    }
  };

  const createFromTemplate = async (t: Template) => {
    try {
      const { elements, appState } = t.build();
      const m = await store.create({ title: t.name, elements, appState, template: t.id });
      navigate(`/b/${m.id}`);
    } catch (e) {
      fail(e);
    }
  };

  const runImport = useCallback(
    async (files: File[], openSingle: boolean) => {
      if (!files.length) return;
      try {
        const s = await importFiles(store, files);
        if (openSingle && s.boards.length === 1 && !s.errors.length && !s.fromBackups) return navigate(`/b/${s.boards[0].id}`);
        setNotice({ text: describeImport(s), kind: s.errors.length ? 'error' : 'info' });
      } catch (e) {
        fail(e);
      }
    },
    [store, navigate],
  );

  const exportAll = async () => {
    try {
      const backup = await store.exportAll();
      downloadText(JSON.stringify(backup), `whiteboard-backup-${new Date().toISOString().slice(0, 10)}.json`);
      setNotice({ text: `Exported ${backup.boards.length} board${backup.boards.length === 1 ? '' : 's'}${backup.library.length ? ` and ${backup.library.length} library item${backup.library.length === 1 ? '' : 's'}` : ''}.`, kind: 'info' });
    } catch (e) {
      fail(e);
    }
  };

  const actions: CardActions = {
    rename: (id, title) => void store.rename(id, title).catch(fail),
    duplicate: (id) => void store.duplicate(id).catch(fail),
    download: (id) =>
      void store
        .load(id)
        .then((b) => {
          if (!b) return;
          downloadText(serializeScene({ elements: b.scene.elements, appState: b.scene.appState, files: b.files }, location.href.split('#')[0]), fileNameFor(b.meta.title, 'excalidraw'));
        })
        .catch(fail),
    remove: (id) => void remove(id).catch(fail),
  };

  const pickFiles = (openSingle: boolean) => {
    openAfterImport.current = openSingle;
    fileInput.current?.click();
  };

  return (
    <div
      className="page library"
      onDragEnter={(e) => hasFiles(e) && setDragDepth((d) => d + 1)}
      onDragLeave={(e) => hasFiles(e) && setDragDepth((d) => Math.max(0, d - 1))}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDragDepth(0);
        void runImport([...e.dataTransfer.files], false);
      }}
    >
      <header className="topbar">
        <span className="logo">
          <span className="logo-mark" aria-hidden="true">
            <IconPen size={17} />
          </span>
          <span>Whiteboard</span>
        </span>
        <span className="spacer" />
        <ThemeToggle />
      </header>

      <main className="library-main" id="main">
        <div className="library-head">
          <h1>
            Boards {boards.length > 0 && <span className="count-pill">{boards.length}</span>}
          </h1>
          <div className="actions-row">
            <button type="button" className="btn primary" onClick={() => void createBlank()}>
              <IconPlus size={17} /> New board
            </button>
            <button type="button" className="btn" onClick={() => setTemplates(true)}>
              <IconTemplate size={17} /> <span>From template</span>
            </button>
            <button type="button" className="btn" onClick={() => pickFiles(true)}>
              <IconUpload size={17} /> <span>Open file</span>
            </button>
            <Menu
              label="Backup"
              align="start"
              items={[
                { label: 'Export all boards (.json)', onSelect: () => void exportAll() },
                { label: 'Import backup or files…', onSelect: () => pickFiles(false) },
              ]}
            >
              <IconArchive size={17} /> <span>Backup</span>
            </Menu>
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT}
              multiple
              hidden
              aria-hidden="true"
              tabIndex={-1}
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = '';
                void runImport(files, openAfterImport.current);
              }}
            />
          </div>
        </div>

        {boards.length > 0 && (
          <div className="filter-row">
            <div className="search">
              <IconSearch size={16} />
              <label className="sr-only" htmlFor="board-search">
                Search boards
              </label>
              <input id="board-search" type="search" className="search-input" placeholder="Search boards" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
            </div>
            <label className="sort">
              <span className="muted small">Sort</span>
              <select
                className="input compact"
                value={sort}
                onChange={(e) => {
                  const s = e.target.value as SortMode;
                  setSort(s);
                  setPrefs({ sort: s });
                }}
              >
                <option value="edited">Last edited</option>
                <option value="name">Name</option>
                <option value="created">Created</option>
              </select>
            </label>
          </div>
        )}

        {notice && (
          <div className={`notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
            <span>{notice.text}</span>
            <button type="button" className="btn ghost icon small" onClick={() => setNotice(null)} aria-label="Dismiss message">
              <IconClose size={14} />
            </button>
          </div>
        )}
        {error && (
          <div className="notice error" role="alert">
            Couldn’t read saved boards: {error}
          </div>
        )}
        {invalid > 0 && (
          <div className="notice error" role="status">
            {invalid} saved board{invalid === 1 ? '' : 's'} couldn’t be read and {invalid === 1 ? 'is' : 'are'} hidden.
          </div>
        )}

        {loading ? (
          <p className="muted">Loading boards…</p>
        ) : boards.length === 0 ? (
          <div className="empty card">
            <h2>No boards yet</h2>
            <p className="muted">Create a board, start from a template, or drop .excalidraw files or a backup anywhere on this page. Everything stays in this browser.</p>
          </div>
        ) : visible.length === 0 ? (
          <p className="muted" role="status">
            No boards match “{query}”.
          </p>
        ) : (
          <ul className="board-grid" aria-label="Boards">
            {visible.map((b) => (
              <BoardCard key={b.id} board={b} thumb={thumbs.get(b.id)} now={now} actions={actions} />
            ))}
          </ul>
        )}
        <p className="muted tiny footnote">Boards are saved in this browser (IndexedDB). Use Backup → Export to keep a copy or move them to another device.</p>
      </main>

      {dragDepth > 0 && (
        <div className="drop-overlay" aria-hidden="true">
          <div>Drop .excalidraw, .excalidrawlib or backup files to import</div>
        </div>
      )}

      {templates && (
        <TemplateDialog
          onClose={() => setTemplates(false)}
          onBlank={() => {
            setTemplates(false);
            void createBlank();
          }}
          onPick={(t) => {
            setTemplates(false);
            void createFromTemplate(t);
          }}
        />
      )}

      {removed && <UndoToast key={removed.meta.id} title={removed.meta.title} onUndo={() => void undoRemove().catch(fail)} onDismiss={dismissRemoved} />}
    </div>
  );
}

function UndoToast({ title, onUndo, onDismiss }: { title: string; onUndo: () => void; onDismiss: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(onDismiss, 8000);
    return () => window.clearTimeout(t);
  }, [onDismiss]);
  return (
    <div className="toast" role="status">
      <span className="toast-text">
        Deleted <strong>{title}</strong>
      </span>
      <button type="button" className="btn small" onClick={onUndo}>
        Undo
      </button>
      <button type="button" className="btn ghost icon small" onClick={onDismiss} aria-label="Dismiss">
        <IconClose size={14} />
      </button>
    </div>
  );
}

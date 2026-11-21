import { lazy, Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { BoardEditorProps, SaveStatus } from '../components/BoardEditor';
import { IconAlert, IconBack, IconCheck } from '../components/Icons';
import { ThemeToggle, useTheme } from '../components/Theme';
import { normalizeTitle, DEFAULT_TITLE } from '../lib/format';
import type { LibraryItem, LoadedBoard } from '../lib/types';
import { useBoards } from '../store/BoardsStore';

const BoardEditor = lazy(() => import('../components/BoardEditor'));

type LoadState = { status: 'loading' } | { status: 'missing' } | { status: 'error'; message: string } | { status: 'ready'; board: LoadedBoard; library: LibraryItem[] };

const STATUS_TEXT: Record<SaveStatus, string> = { saved: 'Saved', pending: 'Unsaved changes', saving: 'Saving…', error: 'Couldn’t save' };

export function BoardPage() {
  const { id = '' } = useParams();
  const { store } = useBoards();
  const { resolved } = useTheme();
  const navigate = useNavigate();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [title, setTitle] = useState('');
  const [draft, setDraft] = useState('');
  const [save, setSave] = useState<{ status: SaveStatus; error?: string }>({ status: 'saved' });

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    setSave({ status: 'saved' });
    Promise.all([store.load(id), store.getLibrary()])
      .then(([board, library]) => {
        if (!live) return;
        if (!board) return setState({ status: 'missing' });
        setTitle(board.meta.title);
        setDraft(board.meta.title);
        setState({ status: 'ready', board, library });
      })
      .catch((e: unknown) => live && setState({ status: 'error', message: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
  }, [id, store]);

  useEffect(() => {
    document.title = title ? `${title} · Whiteboard` : 'Whiteboard';
    return () => {
      document.title = 'Whiteboard';
    };
  }, [title]);

  const rename = useCallback(
    async (next: string) => {
      const clean = normalizeTitle(next) || DEFAULT_TITLE;
      setDraft(clean);
      if (clean === title) return;
      setTitle(clean);
      try {
        await store.rename(id, clean);
      } catch (e) {
        setSave({ status: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    },
    [id, store, title],
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void rename(draft);
    (document.activeElement as HTMLElement | null)?.blur();
  };

  const onStatus = useCallback<BoardEditorProps['onStatus']>((status, error) => setSave({ status, error }), []);
  const back = useCallback(() => navigate('/'), [navigate]);

  // Warn before closing the tab only if a save failed (autosave covers the rest).
  useEffect(() => {
    if (save.status !== 'error') return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [save.status]);

  if (state.status === 'missing' || state.status === 'error') {
    return (
      <div className="page">
        <div className="message card">
          <h1>{state.status === 'missing' ? 'That board doesn’t exist' : 'Couldn’t open this board'}</h1>
          <p className="muted">{state.status === 'missing' ? 'It may have been deleted here or in another tab.' : state.message}</p>
          <Link to="/" className="btn primary self-start">
            All boards
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="board-page">
      <header className="board-bar">
        <Link to="/" className="btn ghost back-btn" aria-label="All boards" title="All boards">
          <IconBack />
          <span className="back-text">Boards</span>
        </Link>
        <form className="title-form" onSubmit={onSubmit}>
          <label className="sr-only" htmlFor="board-title">
            Board title
          </label>
          <input
            id="board-title"
            className="title-input"
            value={draft}
            maxLength={100}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void rename(draft)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setDraft(title);
                e.currentTarget.blur();
              }
            }}
            disabled={state.status !== 'ready'}
            autoComplete="off"
            spellCheck={false}
          />
        </form>
        <span className={`save-status ${save.status}`} role="status" aria-live="polite" title={save.error}>
          {save.status === 'saved' ? <IconCheck size={15} /> : save.status === 'error' ? <IconAlert size={15} /> : <span className="dot" aria-hidden="true" />}
          <span className="save-text">{STATUS_TEXT[save.status]}</span>
        </span>
        <ThemeToggle />
      </header>
      <div className="board-canvas">
        {state.status === 'ready' ? (
          <Suspense fallback={<EditorLoading />}>
            <BoardEditor key={state.board.meta.id} board={state.board} library={state.library} store={store} theme={resolved} title={title} onRename={rename} onStatus={onStatus} onBack={back} />
          </Suspense>
        ) : (
          <EditorLoading />
        )}
      </div>
    </div>
  );
}

function EditorLoading() {
  return (
    <div className="editor-loading" role="status">
      <span className="spinner" aria-hidden="true" />
      Loading editor…
    </div>
  );
}

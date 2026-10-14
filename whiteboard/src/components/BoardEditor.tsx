/**
 * The Excalidraw editor for one board. This module (and Excalidraw with it) is lazy-loaded
 * by BoardPage, so the boards list never downloads the editor.
 */
import { CaptureUpdateAction, Excalidraw, MainMenu, WelcomeScreen } from '@excalidraw/excalidraw';
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI, ExcalidrawInitialDataState, LibraryItems } from '@excalidraw/excalidraw/types';
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import '@excalidraw/excalidraw/index.css';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { BoardStore } from '../lib/boardStore';
import { pickAppState } from '../lib/schema';
import { contentSignature, viewSignature } from '../lib/sceneSignature';
import { filesRecord, renderThumbnail } from '../lib/thumbnail';
import type { LibraryItem, LoadedBoard, SavedAppState, SceneElement, SceneFile } from '../lib/types';

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error';

export interface BoardEditorProps {
  board: LoadedBoard;
  library: LibraryItem[];
  store: BoardStore;
  theme: 'light' | 'dark';
  title: string;
  /** The drawing was renamed inside Excalidraw (e.g. the file name in the export dialog). */
  onRename: (title: string) => void;
  onStatus: (status: SaveStatus, error?: string) => void;
  onBack: () => void;
}

const SAVE_DELAY = 700;
const THUMB_DELAY = 2500;

interface Snapshot {
  elements: readonly SceneElement[];
  appState: SavedAppState;
  files: BinaryFiles;
}

export default function BoardEditor({ board, library, store, theme, title, onRename, onStatus, onBack }: BoardEditorProps) {
  const id = board.meta.id;
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const latest = useRef<Snapshot | null>(null);
  const saved = useRef({
    content: contentSignature(board.scene.elements, board.scene.appState),
    view: viewSignature(board.scene.appState),
    revision: board.meta.revision,
  });
  const quick = useRef({ hash: -1, files: -1 });
  const saveTimer = useRef<number | undefined>(undefined);
  const thumbTimer = useRef<number | undefined>(undefined);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const thumbRevision = useRef(-1);
  const titleRef = useRef(title);
  const renameTimer = useRef<number | undefined>(undefined);
  // Boards without a saved viewport (new, template, imported) open zoomed to fit their content.
  const fitOnLoad = useRef(!(typeof board.scene.appState.scrollX === 'number' && typeof board.scene.appState.scrollY === 'number'));
  const cb = useRef({ onRename, onStatus });
  cb.current = { onRename, onStatus };

  const initialData = useMemo<ExcalidrawInitialDataState>(() => {
    return {
      elements: board.scene.elements as unknown as OrderedExcalidrawElement[],
      appState: { ...(board.scene.appState as Partial<AppState>), name: title },
      files: filesRecord(board.files),
      libraryItems: library as unknown as LibraryItems,
      scrollToContent: false,
    };
    // Only the first render's data seeds the editor; later changes flow through the API.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const makeThumbnail = useCallback(
    (snap: Snapshot, revision: number) => {
      if (revision <= thumbRevision.current) return;
      thumbRevision.current = revision;
      void renderThumbnail(snap.elements, snap.appState, snap.files)
        .then((url) => (url ? store.setThumbnail(id, url, revision) : undefined))
        .catch(() => undefined);
    },
    [id, store],
  );

  /** Writes the latest scene if it changed. `flush` also stores viewport-only changes. */
  const save = useCallback(
    (flush: boolean) => {
      window.clearTimeout(saveTimer.current);
      const snap = latest.current;
      if (!snap) return chain.current;
      const content = contentSignature(snap.elements, snap.appState);
      const view = viewSignature(snap.appState);
      const touch = content !== saved.current.content;
      if (!touch && (!flush || view === saved.current.view)) {
        cb.current.onStatus('saved');
        return chain.current;
      }
      const files = Object.values(snap.files) as unknown as SceneFile[];
      const run = async () => {
        cb.current.onStatus('saving');
        try {
          const meta = await store.save(id, { elements: snap.elements, appState: snap.appState, files }, Date.now(), { touch });
          saved.current = { content, view, revision: meta.revision };
          // Newer edits may have arrived while writing.
          const pending = latest.current !== snap && contentSignature(latest.current!.elements, latest.current!.appState) !== content;
          cb.current.onStatus(pending ? 'pending' : 'saved');
          if (touch) {
            window.clearTimeout(thumbTimer.current);
            if (flush) makeThumbnail(snap, meta.revision);
            else thumbTimer.current = window.setTimeout(() => makeThumbnail(snap, meta.revision), THUMB_DELAY);
          }
        } catch (e) {
          cb.current.onStatus('error', e instanceof Error ? e.message : String(e));
        }
      };
      chain.current = chain.current.then(run);
      return chain.current;
    },
    [id, store, makeThumbnail],
  );

  const onChange = useCallback(
    (elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      // Nothing to save until Excalidraw has loaded the initial scene.
      if (appState.isLoading) return;
      if (fitOnLoad.current) {
        fitOnLoad.current = false;
        // fitToContent zooms out to fit but never zooms in past 100%.
        if (elements.some((e) => !e.isDeleted)) requestAnimationFrame(() => apiRef.current?.scrollToContent(undefined, { fitToContent: true, animate: false }));
      }
      // Cheap check first: Excalidraw calls onChange on every pointer move.
      let hash = 0;
      for (const el of elements) hash = (hash * 31 + el.versionNonce + el.version) | 0;
      const fileCount = Object.keys(files).length;
      const picked = pickAppState(appState);
      latest.current = { elements: elements as unknown as SceneElement[], appState: picked, files };
      if (hash !== quick.current.hash || fileCount !== quick.current.files) {
        const first = quick.current.hash === -1;
        quick.current = { hash, files: fileCount };
        if (!first || contentSignature(latest.current.elements, picked) !== saved.current.content) {
          window.clearTimeout(saveTimer.current);
          saveTimer.current = window.setTimeout(() => void save(false), SAVE_DELAY);
          cb.current.onStatus('pending');
        }
      }
      const name = appState.name?.trim();
      if (name && name !== titleRef.current) {
        titleRef.current = name;
        window.clearTimeout(renameTimer.current);
        renameTimer.current = window.setTimeout(() => cb.current.onRename(name), 400);
      }
    },
    [save],
  );

  // Title changed in our header: tell Excalidraw (it uses the name for exports).
  useEffect(() => {
    if (title === titleRef.current) return;
    titleRef.current = title;
    apiRef.current?.updateScene({ appState: { name: title }, captureUpdate: CaptureUpdateAction.NEVER });
  }, [title]);

  // Flush on tab hide / page unload and when leaving the board.
  useEffect(() => {
    const flush = () => void save(true);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearTimeout(renameTimer.current);
      flush();
      // A content save made just before leaving still needs its preview.
      window.clearTimeout(thumbTimer.current);
      const snap = latest.current;
      void chain.current.then(() => {
        if (snap && saved.current.revision > thumbRevision.current && saved.current.revision > board.meta.revision) makeThumbnail(snap, saved.current.revision);
      });
    };
  }, [save, makeThumbnail, board.meta.revision]);

  const onLibraryChange = useCallback((items: LibraryItems) => void store.setLibrary(items as unknown as LibraryItem[]).catch(() => undefined), [store]);

  const openMermaid = useCallback(() => {
    apiRef.current?.updateScene({ appState: { openDialog: { name: 'ttd', tab: 'mermaid' } }, captureUpdate: CaptureUpdateAction.NEVER });
  }, []);

  return (
    <Excalidraw
      excalidrawAPI={(api) => (apiRef.current = api)}
      initialData={initialData}
      onChange={onChange}
      onLibraryChange={onLibraryChange}
      theme={theme}
      name={title}
      // No backend: AI text-to-diagram needs one, so only the Mermaid tab is shown.
      aiEnabled={false}
      autoFocus
      UIOptions={{
        canvasActions: { toggleTheme: false, export: { saveFileToDisk: true }, loadScene: true, saveToActiveFile: true, clearCanvas: true, changeViewBackgroundColor: true, saveAsImage: true },
      }}
    >
      <MainMenu>
        <MainMenu.Item onSelect={onBack} icon={<BackIcon />}>
          All boards
        </MainMenu.Item>
        <MainMenu.Separator />
        <MainMenu.DefaultItems.LoadScene />
        <MainMenu.DefaultItems.SaveToActiveFile />
        <MainMenu.DefaultItems.Export />
        <MainMenu.DefaultItems.SaveAsImage />
        <MainMenu.Item onSelect={openMermaid} icon={<DiagramIcon />}>
          Mermaid to diagram
        </MainMenu.Item>
        <MainMenu.DefaultItems.CommandPalette />
        <MainMenu.DefaultItems.SearchMenu />
        <MainMenu.DefaultItems.Help />
        <MainMenu.DefaultItems.ClearCanvas />
        <MainMenu.Separator />
        <MainMenu.DefaultItems.ChangeCanvasBackground />
      </MainMenu>
      <WelcomeScreen>
        <WelcomeScreen.Hints.MenuHint />
        <WelcomeScreen.Hints.ToolbarHint />
        <WelcomeScreen.Hints.HelpHint />
        <WelcomeScreen.Center>
          <WelcomeScreen.Center.Heading>Start drawing, or turn Mermaid text into a diagram.</WelcomeScreen.Center.Heading>
          <WelcomeScreen.Center.Menu>
            <WelcomeScreen.Center.MenuItem onSelect={openMermaid} icon={<DiagramIcon />}>
              Mermaid to diagram
            </WelcomeScreen.Center.MenuItem>
            <WelcomeScreen.Center.MenuItemLoadScene />
            <WelcomeScreen.Center.MenuItemHelp />
          </WelcomeScreen.Center.Menu>
        </WelcomeScreen.Center>
      </WelcomeScreen>
    </Excalidraw>
  );
}

const BackIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 18 9 12l6-6" />
  </svg>
);

const DiagramIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="7" height="5" rx="1" />
    <rect x="14" y="16" width="7" height="5" rx="1" />
    <path d="M6.5 8v5.5h11V16" />
  </svg>
);

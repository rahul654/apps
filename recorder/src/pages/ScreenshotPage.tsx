import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Annotator } from '../components/annotate/Annotator';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { errorMessage, Loading, Notice } from '../components/Feedback';
import { IconBack, IconCopy, IconDownload, IconEdit, IconShare, IconTrash } from '../components/Icons';
import type { Scene } from '../lib/annotations';
import { formatBytes, formatDate } from '../lib/format';
import { screenshotStore, type ScreenshotMeta } from '../lib/screenshotStore';
import { loadImage, renderThumbnail, type ExportType, type LoadedImage } from '../media/annotateRender';
import { canCopyImages, canShareImages, copyShot, downloadShot, shareShot } from '../media/shotFiles';
import { notifyLibraryChanged } from '../store/library';
import { useController, useRecorder } from '../store/RecorderContext';

const SAVE_DELAY = 400;
const THUMB_DELAY = 1500;

const SOURCE_LABEL: Record<ScreenshotMeta['source'], string> = { display: 'Screen capture', recording: 'Taken while recording', paste: 'Pasted image' };

export function ScreenshotPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const c = useController();
  const { prefs } = useRecorder();
  const [meta, setMeta] = useState<ScreenshotMeta | null | undefined>(undefined);
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [format, setFormat] = useState<ExportType>('image/png');
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');

  // Latest scene, pending writes.
  const sceneRef = useRef<Scene | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thumbTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const imageRef = useRef<LoadedImage | null>(null);
  imageRef.current = image;

  useEffect(() => {
    let cancelled = false;
    let img: LoadedImage | null = null;
    setMeta(undefined);
    setImage(null);
    setError(null);
    void (async () => {
      const store = screenshotStore();
      const m = await store.get(id);
      if (cancelled) return;
      setMeta(m ?? null);
      if (!m) return;
      sceneRef.current = m.scene;
      setTitle(m.title);
      c.setBaseTitle(`${m.title} · Recorder`);
      const blob = await store.getImage(id);
      if (!blob) throw new Error('The screenshot’s image is missing from this browser’s storage.');
      img = await loadImage(blob);
      if (cancelled) return img.close();
      setImage(img);
    })().catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
      img?.close();
    };
  }, [id, c]);

  const writeScene = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const scene = sceneRef.current;
    if (!scene) return;
    try {
      const next = await screenshotStore().update(id, { scene });
      if (next) setMeta((m) => (m ? { ...m, scene: next.scene, updatedAt: next.updatedAt } : m));
      setSaveState('saved');
    } catch (e) {
      setSaveState('error');
      setError(`Couldn’t save your changes: ${errorMessage(e)}`);
    }
  }, [id]);

  const writeThumb = useCallback(async () => {
    if (thumbTimer.current) clearTimeout(thumbTimer.current);
    thumbTimer.current = null;
    const img = imageRef.current;
    const scene = sceneRef.current;
    if (!img || !scene) return;
    try {
      await screenshotStore().setThumbnail(id, await renderThumbnail(img, scene));
      notifyLibraryChanged();
    } catch {
      /* thumbnail is cosmetic */
    }
  }, [id]);

  const onSceneChange = useCallback(
    (scene: Scene) => {
      sceneRef.current = scene;
      setMeta((m) => (m ? { ...m, scene } : m));
      setSaveState('saving');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void writeScene(), SAVE_DELAY);
      if (thumbTimer.current) clearTimeout(thumbTimer.current);
      thumbTimer.current = setTimeout(() => void writeThumb(), THUMB_DELAY);
    },
    [writeScene, writeThumb],
  );

  // Flush pending writes when leaving the page, hiding the tab or closing it.
  useEffect(() => {
    const flush = () => {
      if (saveTimer.current) void writeScene();
      if (thumbTimer.current) void writeThumb();
    };
    const onHidden = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHidden);
      flush();
    };
  }, [writeScene, writeThumb]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 2500);
  };

  const copy = useCallback(() => {
    if (!meta || !image) return;
    copyShot(meta, image)
      .then(() => showToast('Copied to the clipboard'))
      .catch((e) => setError(errorMessage(e)));
  }, [meta, image]);

  if (meta === undefined && !error) return <Loading label="Loading screenshot…" />;
  if (!meta)
    return (
      <div className="stack">
        <Notice kind="warn">{error ?? 'This screenshot doesn’t exist (it may have been deleted).'}</Notice>
        <Link to="/library" className="btn">
          <IconBack /> Back to library
        </Link>
      </div>
    );

  const rename = async () => {
    setEditingTitle(false);
    const t = title.trim();
    if (!t || t === meta.title) return setTitle(meta.title);
    await screenshotStore().rename(meta.id, t);
    setMeta({ ...meta, title: t });
    c.setBaseTitle(`${t} · Recorder`);
    notifyLibraryChanged();
  };

  const crop = meta.scene.crop;

  return (
    <div className="stack">
      <Link to="/library" className="back-link">
        <IconBack size={16} /> Library
      </Link>
      <div className="page-head">
        <div className="grow">
          {editingTitle ? (
            <input
              className="input title-input"
              value={title}
              autoFocus
              maxLength={200}
              aria-label="Screenshot title"
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => void rename()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void rename();
                if (e.key === 'Escape') {
                  setTitle(meta.title);
                  setEditingTitle(false);
                }
              }}
            />
          ) : (
            <h1>
              {meta.title}{' '}
              <button type="button" className="btn ghost small icon" onClick={() => setEditingTitle(true)} aria-label="Rename">
                <IconEdit size={16} />
              </button>
            </h1>
          )}
          <p className="muted small">
            {formatDate(meta.createdAt)} · {meta.width}×{meta.height}
            {crop ? ` (cropped to ${crop.w}×${crop.h})` : ''} · {formatBytes(meta.size)} · {SOURCE_LABEL[meta.source]} ·{' '}
            <span aria-live="polite">{saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Not saved' : 'Saved'}</span>
          </p>
        </div>
        <div className="row">
          {canCopyImages() && (
            <button type="button" className="btn primary" onClick={copy} disabled={!image} title="Copy the annotated image (Ctrl+C)">
              <IconCopy /> Copy
            </button>
          )}
          <div className="row nowrap split-btn">
            <button type="button" className="btn" disabled={!image} onClick={() => void downloadShot(meta, format, image ?? undefined).catch((e) => setError(errorMessage(e)))}>
              <IconDownload /> Download
            </button>
            <label className="sr-only" htmlFor="shot-format">
              Download format
            </label>
            <select id="shot-format" className="input format-select" value={format} onChange={(e) => setFormat(e.target.value as ExportType)}>
              <option value="image/png">PNG</option>
              <option value="image/jpeg">JPEG</option>
            </select>
          </div>
          {canShareImages() && (
            <button type="button" className="btn" disabled={!image} onClick={() => void shareShot(meta, image ?? undefined).catch((e) => e?.name !== 'AbortError' && setError(errorMessage(e)))}>
              <IconShare /> Share
            </button>
          )}
          <button type="button" className="btn danger" onClick={() => setConfirmDelete(true)} aria-label="Delete screenshot">
            <IconTrash />
          </button>
        </div>
      </div>
      {error && (
        <Notice kind="error" onDismiss={() => setError(null)}>
          {error}
        </Notice>
      )}
      {toast && <Notice kind="success">{toast}</Notice>}

      {image ? (
        <Annotator
          key={meta.id}
          image={image}
          initialScene={meta.scene}
          styles={prefs}
          onStylesChange={(p) => c.updatePrefs(p)}
          onSceneChange={onSceneChange}
          onCopy={canCopyImages() ? copy : undefined}
          label={`Screenshot: ${meta.title}`}
        />
      ) : (
        !error && <Loading label="Loading image…" />
      )}
      <p className="muted tiny">
        The original capture is kept in this browser so you can change the marks later. Downloads, copies and shares contain the annotated image only; blurred areas are pixelated
        in them.
      </p>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this screenshot?"
        confirmLabel="Delete"
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          if (saveTimer.current) clearTimeout(saveTimer.current);
          if (thumbTimer.current) clearTimeout(thumbTimer.current);
          saveTimer.current = thumbTimer.current = null;
          void screenshotStore()
            .delete(meta.id)
            .then(() => {
              notifyLibraryChanged();
              navigate('/library');
            });
        }}
      >
        “{meta.title}” will be removed from this browser. This can’t be undone.
      </ConfirmDialog>
    </div>
  );
}

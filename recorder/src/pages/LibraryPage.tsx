import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { errorMessage, Loading, Notice } from '../components/Feedback';
import { IconCopy, IconDownload, IconImage, IconPlay, IconRecord, IconScreenshot, IconShare, IconTrash, IconWave } from '../components/Icons';
import { RecoveryBanner } from '../components/RecoveryBanner';
import { StorageMeter } from '../components/StorageMeter';
import { formatBytes, formatDate, formatDuration } from '../lib/format';
import { describeMime } from '../lib/mime';
import { recordingStore, type RecordingMeta } from '../lib/recordingStore';
import { screenshotStore, type ScreenshotMeta } from '../lib/screenshotStore';
import { downloadRecording, shareRecording, canShareRecordings } from '../media/files';
import { canCopyImages, copyShot, downloadShot } from '../media/shotFiles';
import { notifyLibraryChanged, useLibrary, useScreenshots, useThumbnail } from '../store/library';
import { useOpenImage, useTakeScreenshot } from '../store/RecorderContext';
import { useShot } from '../store/screenshot';

type SortKey = 'newest' | 'oldest' | 'longest' | 'largest' | 'title';
type KindFilter = 'all' | 'recordings' | 'screenshots';

type Item = { kind: 'rec'; m: RecordingMeta } | { kind: 'shot'; m: ScreenshotMeta };
const duration = (i: Item) => (i.kind === 'rec' ? i.m.durationMs : 0);

const SORTS: Record<SortKey, { label: string; cmp: (a: Item, b: Item) => number }> = {
  newest: { label: 'Newest first', cmp: (a, b) => b.m.createdAt - a.m.createdAt },
  oldest: { label: 'Oldest first', cmp: (a, b) => a.m.createdAt - b.m.createdAt },
  longest: { label: 'Longest', cmp: (a, b) => duration(b) - duration(a) },
  largest: { label: 'Largest', cmp: (a, b) => b.m.size - a.m.size },
  title: { label: 'Title A–Z', cmp: (a, b) => a.m.title.localeCompare(b.m.title, undefined, { numeric: true, sensitivity: 'base' }) },
};

const KINDS: Array<{ id: KindFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'recordings', label: 'Recordings' },
  { id: 'screenshots', label: 'Screenshots' },
];

function Thumb({ m }: { m: RecordingMeta }) {
  const url = useThumbnail(m.id, m.hasThumb);
  const audio = !m.mimeType.startsWith('video/');
  return (
    <div className="thumb">
      {url ? <img src={url} alt="" /> : <span className="thumb-icon">{audio ? <IconWave size={32} /> : <IconPlay size={28} />}</span>}
      <span className="thumb-duration mono">{formatDuration(m.durationMs)}</span>
    </div>
  );
}

function RecordingCard({ m, onDelete, onError }: { m: RecordingMeta; onDelete: (m: RecordingMeta) => void; onError: (msg: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(m.title);
  const fmt = describeMime(m.mimeType);
  const save = async () => {
    setEditing(false);
    if (title.trim() && title.trim() !== m.title) {
      await recordingStore().rename(m.id, title);
      notifyLibraryChanged();
    } else setTitle(m.title);
  };
  return (
    <li className="rec-card">
      <Link to={`/play/${m.id}`} className="thumb-link" aria-label={`Play ${m.title}`}>
        <Thumb m={m} />
      </Link>
      <div className="rec-card-body">
        {editing ? (
          <input
            className="input"
            value={title}
            autoFocus
            aria-label="Recording title"
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => void save()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
              if (e.key === 'Escape') {
                setTitle(m.title);
                setEditing(false);
              }
            }}
          />
        ) : (
          <h3 className="rec-title">
            <Link to={`/play/${m.id}`}>{m.title}</Link>
          </h3>
        )}
        <p className="muted small">
          {formatDate(m.createdAt)} · {formatBytes(m.size)} · {fmt.label}
          {m.width && m.height ? ` · ${m.width}×${m.height}` : ''}
        </p>
        <div className="row rec-actions">
          <button type="button" className="btn small ghost" onClick={() => setEditing(true)}>
            Rename
          </button>
          <button type="button" className="btn small ghost" onClick={() => void downloadRecording(m).catch((e) => onError(String(e?.message ?? e)))}>
            <IconDownload size={16} /> Download
          </button>
          {canShareRecordings() && (
            <button type="button" className="btn small ghost" onClick={() => void shareRecording(m).catch((e) => e?.name !== 'AbortError' && onError(String(e?.message ?? e)))}>
              <IconShare size={16} /> Share
            </button>
          )}
          <button type="button" className="btn small ghost danger" onClick={() => onDelete(m)} aria-label={`Delete ${m.title}`}>
            <IconTrash size={16} />
          </button>
        </div>
      </div>
    </li>
  );
}

function ShotThumb({ m }: { m: ScreenshotMeta }) {
  const url = useThumbnail(m.id, m.hasThumb);
  const marks = m.scene.annotations.length;
  return (
    <div className="thumb">
      {url ? <img src={url} alt="" /> : <span className="thumb-icon"><IconScreenshot size={30} /></span>}
      <span className="thumb-duration thumb-kind">
        <IconScreenshot size={12} /> {marks > 0 ? `${marks} mark${marks === 1 ? '' : 's'}` : 'Screenshot'}
      </span>
    </div>
  );
}

function ScreenshotCard({ m, onDelete, onError, onCopied }: { m: ScreenshotMeta; onDelete: (m: ScreenshotMeta) => void; onError: (msg: string) => void; onCopied: () => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(m.title);
  const crop = m.scene.crop;
  const save = async () => {
    setEditing(false);
    if (title.trim() && title.trim() !== m.title) {
      await screenshotStore().rename(m.id, title);
      notifyLibraryChanged();
    } else setTitle(m.title);
  };
  return (
    <li className="rec-card">
      <Link to={`/shot/${m.id}`} className="thumb-link" aria-label={`Open ${m.title}`}>
        <ShotThumb m={m} />
      </Link>
      <div className="rec-card-body">
        {editing ? (
          <input
            className="input"
            value={title}
            autoFocus
            aria-label="Screenshot title"
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => void save()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
              if (e.key === 'Escape') {
                setTitle(m.title);
                setEditing(false);
              }
            }}
          />
        ) : (
          <h3 className="rec-title">
            <Link to={`/shot/${m.id}`}>{m.title}</Link>
          </h3>
        )}
        <p className="muted small">
          {formatDate(m.createdAt)} · {crop ? `${crop.w}×${crop.h}` : `${m.width}×${m.height}`} · Image
        </p>
        <div className="row rec-actions">
          <button type="button" className="btn small ghost" onClick={() => setEditing(true)}>
            Rename
          </button>
          <button type="button" className="btn small ghost" onClick={() => void downloadShot(m).catch((e) => onError(errorMessage(e)))}>
            <IconDownload size={16} /> PNG
          </button>
          {canCopyImages() && (
            <button type="button" className="btn small ghost" onClick={() => void copyShot(m).then(onCopied, (e) => onError(errorMessage(e)))}>
              <IconCopy size={16} /> Copy
            </button>
          )}
          <button type="button" className="btn small ghost danger" onClick={() => onDelete(m)} aria-label={`Delete ${m.title}`}>
            <IconTrash size={16} />
          </button>
        </div>
      </div>
    </li>
  );
}

export function LibraryPage() {
  const { items: recs, error: recError } = useLibrary();
  const { items: shots, error: shotError } = useScreenshots();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('newest');
  const [kind, setKind] = useState<KindFilter>('all');
  const [pendingDelete, setPendingDelete] = useState<Item | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const takeShot = useTakeScreenshot();
  const openImage = useOpenImage();
  const shotBusy = useShot().phase !== 'idle';
  const fileInput = useRef<HTMLInputElement>(null);
  const error = recError ?? shotError;

  const items: Item[] | null = useMemo(
    () => (recs && shots ? [...recs.map((m) => ({ kind: 'rec' as const, m })), ...shots.map((m) => ({ kind: 'shot' as const, m }))] : null),
    [recs, shots],
  );

  const shown = useMemo(() => {
    if (!items) return [];
    const q = query.trim().toLowerCase();
    return items
      .filter((i) => kind === 'all' || (kind === 'recordings' ? i.kind === 'rec' : i.kind === 'shot'))
      .filter((i) => !q || i.m.title.toLowerCase().includes(q))
      .sort(SORTS[sort].cmp);
  }, [items, query, sort, kind]);

  const onCopied = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div className="grow">
          <h1>Library</h1>
          <p className="muted">Recordings and screenshots are stored in this browser. Download them to keep a copy elsewhere.</p>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={takeShot} disabled={shotBusy} aria-keyshortcuts="Alt+Shift+S">
            <IconScreenshot /> Screenshot
          </button>
          <button type="button" className="btn" onClick={() => fileInput.current?.click()} title="Open an image to annotate (or paste one with Ctrl+V)">
            <IconImage /> Open image
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) openImage(f);
            }}
          />
          <Link to="/" className="btn primary">
            <IconRecord /> New recording
          </Link>
        </div>
      </div>
      <RecoveryBanner />
      {error && <Notice kind="error">Couldn’t open the recordings database: {error}</Notice>}
      {actionError && (
        <Notice kind="error" onDismiss={() => setActionError(null)}>
          {actionError}
        </Notice>
      )}
      {copied && <Notice kind="success">Copied to the clipboard</Notice>}
      {items && items.length > 0 && (
        <div className="row library-tools">
          <div className="segmented" role="group" aria-label="Show">
            {KINDS.map((k) => (
              <button key={k.id} type="button" aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
                {k.label}
              </button>
            ))}
          </div>
          <label className="field grow">
            <span className="sr-only">Search the library</span>
            <input className="input" type="search" placeholder="Search by title…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <label className="field">
            <span className="sr-only">Sort</span>
            <select className="input" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              {Object.entries(SORTS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {!items && !error && <Loading label="Loading recordings…" />}
      {items && items.length === 0 && (
        <div className="empty card">
          <IconPlay size={36} />
          <h2>Nothing here yet</h2>
          <p className="muted">Record your screen, camera or voice, or take a screenshot and highlight what matters. They appear here.</p>
          <div className="row">
            <Link to="/" className="btn primary">
              Start recording
            </Link>
            <button type="button" className="btn" onClick={takeShot} disabled={shotBusy}>
              <IconScreenshot /> Take a screenshot
            </button>
          </div>
        </div>
      )}
      {items && items.length > 0 && shown.length === 0 && <p className="muted">{query.trim() ? `Nothing matches “${query}”.` : `No ${kind === 'screenshots' ? 'screenshots' : 'recordings'} yet.`}</p>}
      <p className="sr-only" aria-live="polite">
        {items ? `${shown.length} item${shown.length === 1 ? '' : 's'}` : ''}
      </p>
      <ul className="rec-grid">
        {shown.map((i) =>
          i.kind === 'rec' ? (
            <RecordingCard key={`r:${i.m.id}:${i.m.updatedAt}`} m={i.m} onDelete={(m) => setPendingDelete({ kind: 'rec', m })} onError={setActionError} />
          ) : (
            <ScreenshotCard key={`s:${i.m.id}:${i.m.title}`} m={i.m} onDelete={(m) => setPendingDelete({ kind: 'shot', m })} onError={setActionError} onCopied={onCopied} />
          ),
        )}
      </ul>
      <StorageMeter refreshKey={items?.length} />
      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete?.kind === 'shot' ? 'Delete this screenshot?' : 'Delete this recording?'}
        confirmLabel="Delete"
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const p = pendingDelete;
          setPendingDelete(null);
          if (p?.kind === 'rec') void recordingStore().delete(p.m.id).then(notifyLibraryChanged);
          if (p?.kind === 'shot') void screenshotStore().delete(p.m.id).then(notifyLibraryChanged);
        }}
      >
        “{pendingDelete?.m.title}” will be removed from this browser. This can’t be undone.
      </ConfirmDialog>
    </div>
  );
}

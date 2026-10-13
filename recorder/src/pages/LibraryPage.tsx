import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Loading, Notice } from '../components/Feedback';
import { IconDownload, IconPlay, IconRecord, IconShare, IconTrash, IconWave } from '../components/Icons';
import { RecoveryBanner } from '../components/RecoveryBanner';
import { StorageMeter } from '../components/StorageMeter';
import { formatBytes, formatDate, formatDuration } from '../lib/format';
import { describeMime } from '../lib/mime';
import { recordingStore, type RecordingMeta } from '../lib/recordingStore';
import { downloadRecording, shareRecording, canShareRecordings } from '../media/files';
import { notifyLibraryChanged, useLibrary, useThumbnail } from '../store/library';

type SortKey = 'newest' | 'oldest' | 'longest' | 'largest' | 'title';

const SORTS: Record<SortKey, { label: string; cmp: (a: RecordingMeta, b: RecordingMeta) => number }> = {
  newest: { label: 'Newest first', cmp: (a, b) => b.createdAt - a.createdAt },
  oldest: { label: 'Oldest first', cmp: (a, b) => a.createdAt - b.createdAt },
  longest: { label: 'Longest', cmp: (a, b) => b.durationMs - a.durationMs },
  largest: { label: 'Largest', cmp: (a, b) => b.size - a.size },
  title: { label: 'Title A–Z', cmp: (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }) },
};

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

export function LibraryPage() {
  const { items, error } = useLibrary();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('newest');
  const [pendingDelete, setPendingDelete] = useState<RecordingMeta | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const shown = useMemo(() => {
    if (!items) return [];
    const q = query.trim().toLowerCase();
    return items.filter((m) => !q || m.title.toLowerCase().includes(q)).sort(SORTS[sort].cmp);
  }, [items, query, sort]);

  return (
    <div className="stack">
      <div className="page-head">
        <div className="grow">
          <h1>Library</h1>
          <p className="muted">Recordings are stored in this browser. Download them to keep a copy elsewhere.</p>
        </div>
        <Link to="/" className="btn primary">
          <IconRecord /> New recording
        </Link>
      </div>
      <RecoveryBanner />
      {error && <Notice kind="error">Couldn’t open the recordings database: {error}</Notice>}
      {actionError && (
        <Notice kind="error" onDismiss={() => setActionError(null)}>
          {actionError}
        </Notice>
      )}
      {items && items.length > 0 && (
        <div className="row library-tools">
          <label className="field grow">
            <span className="sr-only">Search recordings</span>
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
          <h2>No recordings yet</h2>
          <p className="muted">Record your screen, camera or voice. Recordings appear here.</p>
          <Link to="/" className="btn primary">
            Start recording
          </Link>
        </div>
      )}
      {items && items.length > 0 && shown.length === 0 && <p className="muted">No recordings match “{query}”.</p>}
      <p className="sr-only" aria-live="polite">
        {items ? `${shown.length} recording${shown.length === 1 ? '' : 's'}` : ''}
      </p>
      <ul className="rec-grid">
        {shown.map((m) => (
          <RecordingCard key={`${m.id}:${m.updatedAt}`} m={m} onDelete={setPendingDelete} onError={setActionError} />
        ))}
      </ul>
      <StorageMeter refreshKey={items?.length} />
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this recording?"
        confirmLabel="Delete"
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const m = pendingDelete;
          setPendingDelete(null);
          if (m) void recordingStore().delete(m.id).then(notifyLibraryChanged);
        }}
      >
        “{pendingDelete?.title}” will be removed from this browser. This can’t be undone.
      </ConfirmDialog>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EditPanel } from '../components/EditPanel';
import { Loading, Notice } from '../components/Feedback';
import { IconBack, IconDownload, IconEdit, IconShare, IconTrash } from '../components/Icons';
import { formatBytes, formatDate, formatDuration } from '../lib/format';
import { describeMime } from '../lib/mime';
import { recordingStore, type RecordingMeta } from '../lib/recordingStore';
import { canShareRecordings, downloadRecording, shareRecording } from '../media/files';
import { notifyLibraryChanged } from '../store/library';
import { useController } from '../store/RecorderContext';

export function PlayerPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const c = useController();
  const [meta, setMeta] = useState<RecordingMeta | null | undefined>(undefined);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [source, setSource] = useState<RecordingMeta | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);
  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);

  useEffect(() => {
    let cancelled = false;
    let u: string | null = null;
    setMeta(undefined);
    setBlob(null);
    setUrl(null);
    setMediaDuration(null);
    void (async () => {
      const store = recordingStore();
      const m = await store.get(id);
      if (cancelled) return;
      setMeta(m && m.status === 'complete' ? m : null);
      if (!m || m.status !== 'complete') return;
      setTitle(m.title);
      c.setBaseTitle(`${m.title} · Recorder`);
      const b = await store.getBlob(id);
      if (cancelled) return;
      u = URL.createObjectURL(b);
      setBlob(b);
      setUrl(u);
      setSource(m.sourceId ? ((await store.get(m.sourceId)) ?? null) : null);
    })().catch((e) => !cancelled && setError(String(e?.message ?? e)));
    return () => {
      cancelled = true;
      if (u) URL.revokeObjectURL(u);
    };
  }, [id, c]);

  if (meta === undefined && !error) return <Loading label="Loading recording…" />;
  if (!meta)
    return (
      <div className="stack">
        <Notice kind="warn">{error ?? 'This recording doesn’t exist (it may have been deleted).'}</Notice>
        <Link to="/library" className="btn">
          <IconBack /> Back to library
        </Link>
      </div>
    );

  const fmt = describeMime(meta.mimeType);
  const isVideo = fmt.isVideo;
  const duration = mediaDuration ?? meta.durationMs / 1000;

  const rename = async () => {
    setEditing(false);
    const t = title.trim();
    if (!t || t === meta.title) return setTitle(meta.title);
    await recordingStore().rename(meta.id, t);
    setMeta({ ...meta, title: t });
    c.setBaseTitle(`${t} · Recorder`);
    notifyLibraryChanged();
  };

  return (
    <div className="stack">
      <Link to="/library" className="back-link">
        <IconBack size={16} /> Library
      </Link>
      <div className="page-head">
        <div className="grow">
          {editing ? (
            <input
              className="input title-input"
              value={title}
              autoFocus
              maxLength={200}
              aria-label="Recording title"
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => void rename()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void rename();
                if (e.key === 'Escape') {
                  setTitle(meta.title);
                  setEditing(false);
                }
              }}
            />
          ) : (
            <h1>
              {meta.title}{' '}
              <button type="button" className="btn ghost small icon" onClick={() => setEditing(true)} aria-label="Rename">
                <IconEdit size={16} />
              </button>
            </h1>
          )}
          <p className="muted small">
            {formatDate(meta.createdAt)} · {formatDuration(duration * 1000)} · {formatBytes(meta.size)} · {fmt.label}
            {meta.width && meta.height ? ` · ${meta.width}×${meta.height}` : ''}
            {source && (
              <>
                {' '}
                · from <Link to={`/play/${source.id}`}>{source.title}</Link>
              </>
            )}
          </p>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={() => void downloadRecording(meta).catch((e) => setError(String(e?.message ?? e)))}>
            <IconDownload /> Download
          </button>
          {canShareRecordings() && (
            <button type="button" className="btn" onClick={() => void shareRecording(meta).catch((e) => e?.name !== 'AbortError' && setError(String(e?.message ?? e)))}>
              <IconShare /> Share
            </button>
          )}
          <button type="button" className="btn danger" onClick={() => setConfirmDelete(true)}>
            <IconTrash /> Delete
          </button>
        </div>
      </div>
      {error && (
        <Notice kind="error" onDismiss={() => setError(null)}>
          {error}
        </Notice>
      )}

      <div className="player">
        {url ? (
          isVideo ? (
            <video
              ref={mediaRef}
              src={url}
              controls
              playsInline
              preload="metadata"
              aria-label={`Video: ${meta.title}`}
              onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setMediaDuration(e.currentTarget.duration)}
            />
          ) : (
            <audio
              ref={mediaRef}
              src={url}
              controls
              preload="metadata"
              aria-label={`Audio: ${meta.title}`}
              onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setMediaDuration(e.currentTarget.duration)}
            />
          )
        ) : (
          <Loading label="Loading media…" />
        )}
      </div>

      {blob && <EditPanel meta={meta} blob={blob} duration={duration} mediaRef={mediaRef} />}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this recording?"
        confirmLabel="Delete"
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          void recordingStore()
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

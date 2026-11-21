import { useEffect, useState } from 'react';
import { formatBytes, formatDuration } from '../lib/format';
import { findRecoverable, heldRecordingIds, recordingStore, recoverRecording, type RecordingMeta } from '../lib/recordingStore';
import { isWebm, patchWebmHead } from '../lib/webmDuration';
import { videoThumbnail } from '../media/thumbnail';
import { notifyLibraryChanged } from '../store/library';
import { useRecorder } from '../store/RecorderContext';
import { Notice } from './Feedback';

/** Offers to recover recordings interrupted by a crash or a closed tab. */
export function RecoveryBanner() {
  const [items, setItems] = useState<RecordingMeta[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const { rec } = useRecorder();
  const ownId = rec.recordingId;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [all, held] = await Promise.all([recordingStore().list(), heldRecordingIds()]);
        const found = findRecoverable(all, { now: Date.now(), activeIds: held }).filter((m) => m.id !== ownId);
        if (!cancelled) setItems(found);
      } catch {
        /* IndexedDB unavailable */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ownId]);

  if (items.length === 0) return null;

  const recover = async (m: RecordingMeta) => {
    setBusy(m.id);
    try {
      const store = recordingStore();
      const done = await recoverRecording(store, m.id, isWebm(m.mimeType) ? patchWebmHead : undefined);
      if (done && done.mimeType.startsWith('video/')) {
        const thumb = await videoThumbnail(await store.getBlob(done.id));
        if (thumb) await store.setThumbnail(done.id, thumb);
      }
      notifyLibraryChanged();
    } finally {
      setBusy(null);
      setItems((list) => list.filter((x) => x.id !== m.id));
    }
  };
  const discard = async (m: RecordingMeta) => {
    if (!window.confirm(`Delete the unfinished recording “${m.title}”? This can’t be undone.`)) return;
    await recordingStore().delete(m.id);
    setItems((list) => list.filter((x) => x.id !== m.id));
  };

  return (
    <div className="stack-sm recovery">
      {items.map((m) => (
        <Notice
          key={m.id}
          kind="warn"
          actions={
            <>
              <button type="button" className="btn small primary" disabled={busy !== null} onClick={() => void recover(m)}>
                {busy === m.id ? 'Recovering…' : 'Recover'}
              </button>
              <button type="button" className="btn small danger" disabled={busy !== null} onClick={() => void discard(m)}>
                Delete
              </button>
            </>
          }
        >
          <strong>Unfinished recording found.</strong> “{m.title}” ({formatDuration(m.durationMs)}, {formatBytes(m.size)}) was interrupted, probably by a
          crash or a closed tab. Everything up to the last second was saved.
        </Notice>
      ))}
    </div>
  );
}

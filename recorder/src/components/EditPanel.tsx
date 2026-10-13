import { useEffect, useRef, useState, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { formatTimecode } from '../lib/format';
import { labelFor } from '../lib/mime';
import { recordingStore, type RecordingMeta } from '../lib/recordingStore';
import { moveHandle, validateTrim } from '../lib/trim';
import type { EditCapabilities, EditResult, ProbeInfo } from '../media/editor';
import { hasWebCodecs } from '../media/features';
import { videoThumbnail } from '../media/thumbnail';
import { notifyLibraryChanged } from '../store/library';
import { errorMessage, Loading, Notice, ProgressBar } from './Feedback';
import { IconConvert, IconPlay, IconScissors } from './Icons';

type Editor = typeof import('../media/editor');
type TrimMode = 'fast' | 'precise' | 'realtime';

const CODEC_NAME: Record<string, string> = { avc: 'H.264', hevc: 'HEVC', vp9: 'VP9', vp8: 'VP8', av1: 'AV1', aac: 'AAC', opus: 'Opus' };

async function saveCopy(source: RecordingMeta, title: string, r: { blob: Blob; mimeType: string; duration: number; cleanup?: () => Promise<void> }, size?: { width: number; height: number }) {
  const store = recordingStore();
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`;
  const meta = await store.saveFile(
    { id, title, createdAt: Date.now(), durationMs: Math.round(r.duration * 1000), mimeType: r.mimeType, mode: 'edit', sourceId: source.id, width: size?.width ?? source.width, height: size?.height ?? source.height },
    r.blob,
  );
  await r.cleanup?.(); // temp OPFS file: safe to delete once IndexedDB has its own copy
  if (r.mimeType.startsWith('video/')) {
    const thumb = await videoThumbnail(await store.getBlob(id));
    if (thumb) await store.setThumbnail(id, thumb);
  }
  notifyLibraryChanged();
  return meta;
}

export function EditPanel({ meta, blob, duration, mediaRef }: { meta: RecordingMeta; blob: Blob; duration: number; mediaRef: RefObject<HTMLMediaElement | null> }) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [info, setInfo] = useState<ProbeInfo | null>(null);
  const [caps, setCaps] = useState<EditCapabilities | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [range, setRange] = useState({ start: 0, end: duration });
  const [mode, setMode] = useState<TrimMode>('fast');
  const [keyStart, setKeyStart] = useState<number | null>(null);
  const [job, setJob] = useState<{ label: string; progress?: number } | null>(null);
  const [result, setResult] = useState<{ meta: RecordingMeta; note: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const webcodecs = hasWebCodecs();

  const durationRef = useRef(duration);
  durationRef.current = duration;

  // Load Mediabunny lazily (its own chunk) and probe the file.
  useEffect(() => {
    let cancelled = false;
    setRange({ start: 0, end: durationRef.current });
    import('../media/editor')
      .then(async (ed) => {
        const p = await ed.probe(blob);
        const c = await ed.capabilities(p);
        if (cancelled) return;
        setEditor(ed);
        setInfo(p);
        setCaps(c);
        if (Number.isFinite(p.duration) && p.duration > 0) setRange({ start: 0, end: p.duration });
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(errorMessage(e));
        setMode('realtime');
      });
    return () => {
      cancelled = true;
      abort.current?.abort();
    };
  }, [blob]);

  const total = info && Number.isFinite(info.duration) && info.duration > 0 ? info.duration : duration;
  const check = validateTrim(range.start, range.end, total);

  // Where a fast trim will really start (previous key frame).
  useEffect(() => {
    if (!editor || mode !== 'fast' || !info?.video) {
      setKeyStart(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      void editor
        .keyFrameBefore(blob, range.start)
        .then((k) => !cancelled && setKeyStart(k))
        .catch(() => !cancelled && setKeyStart(null));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [editor, mode, info, blob, range.start]);

  const scrub = (t: number) => {
    const m = mediaRef.current;
    if (m && Number.isFinite(t)) {
      m.pause();
      m.currentTime = t;
    }
  };
  const setHandle = (which: 'start' | 'end', v: number) => {
    const next = moveHandle(which, v, range, total);
    setRange(next);
    scrub(which === 'start' ? next.start : next.end);
  };
  const fromPlayhead = (which: 'start' | 'end') => {
    const m = mediaRef.current;
    if (m) setHandle(which, m.currentTime);
  };
  const previewSelection = () => {
    const m = mediaRef.current;
    if (!m) return;
    m.currentTime = range.start;
    void m.play();
    const stopAt = () => {
      if (m.currentTime >= range.end) {
        m.pause();
        m.removeEventListener('timeupdate', stopAt);
      }
    };
    m.addEventListener('timeupdate', stopAt);
    m.addEventListener('pause', () => m.removeEventListener('timeupdate', stopAt), { once: true });
  };

  const runJob = async (label: string, work: (signal: AbortSignal, onProgress: (p: number) => void) => Promise<{ meta: RecordingMeta; note: string }>) => {
    setError(null);
    setResult(null);
    const ac = new AbortController();
    abort.current = ac;
    setJob({ label, progress: 0 });
    try {
      const r = await work(ac.signal, (p) => setJob({ label, progress: p }));
      setResult(r);
    } catch (e) {
      if ((e as { name?: string })?.name !== 'AbortError') setError(errorMessage(e));
    } finally {
      abort.current = null;
      setJob(null);
    }
  };

  const doTrim = () => {
    if (!check.ok) return;
    const title = `${meta.title} (trimmed)`;
    void runJob(mode === 'realtime' ? 'Re-recording the selection in real time…' : 'Trimming…', async (signal, onProgress) => {
      if (mode === 'realtime') {
        const { realtimeTrim } = await import('../media/realtimeTrim');
        const r = await realtimeTrim(blob, check, { onProgress, signal });
        return { meta: await saveCopy(meta, title, r), note: 'Re-recorded in real time.' };
      }
      if (!editor) throw new Error('Editor not loaded');
      const r: EditResult & { cleanup: () => Promise<void> } = await editor.trim(blob, check, mode, { onProgress, signal });
      const shift = mode === 'fast' && keyStart !== null ? Math.max(0, check.start - keyStart) : 0;
      return {
        meta: await saveCopy(meta, title, r),
        note: r.transcoded || mode === 'precise' ? 'Re-encoded for a frame-accurate cut.' : shift > 0.05 ? `Copied without re-encoding; starts ${shift.toFixed(1)} s early at the previous key frame.` : 'Copied without re-encoding.',
      };
    });
  };

  const doConvert = (to: 'mp4' | 'webm') => {
    const codecs = to === 'mp4' ? caps?.toMp4 : caps?.toWebm;
    if (!editor || !codecs) return;
    void runJob(`Converting to ${to.toUpperCase()}…`, async (signal, onProgress) => {
      const r = await editor.convert(blob, to, codecs, { onProgress, signal });
      return { meta: await saveCopy(meta, `${meta.title} (${to.toUpperCase()})`, r), note: `Converted to ${to.toUpperCase()}.` };
    });
  };

  const convLabel = (to: 'mp4' | 'webm', c: { video: string | null; audio: string | null }) =>
    labelFor(to, c.video ? CODEC_NAME[c.video] ?? c.video : null, c.audio ? CODEC_NAME[c.audio] ?? c.audio : null);

  const pct = (v: number) => `${(total > 0 ? (v / total) * 100 : 0).toFixed(3)}%`;
  const loading = !editor && !loadError;

  return (
    <section className="card stack" aria-labelledby="edit-h">
      <h2 id="edit-h">
        <IconScissors size={18} /> Trim
      </h2>
      {!Number.isFinite(total) || total <= 0 ? (
        <p className="muted">The length of this recording is unknown, so it can’t be trimmed.</p>
      ) : (
        <>
          <div className="timeline" aria-hidden="true">
            <div className="timeline-sel" style={{ left: pct(range.start), width: pct(range.end - range.start) }} />
          </div>
          <div className="grid-2">
            <label className="field">
              <span>
                Start <span className="mono">{formatTimecode(range.start)}</span>
              </span>
              <input type="range" min={0} max={total} step={0.1} value={range.start} onChange={(e) => setHandle('start', Number(e.target.value))} aria-valuetext={formatTimecode(range.start)} disabled={!!job} />
            </label>
            <label className="field">
              <span>
                End <span className="mono">{formatTimecode(range.end)}</span>
              </span>
              <input type="range" min={0} max={total} step={0.1} value={range.end} onChange={(e) => setHandle('end', Number(e.target.value))} aria-valuetext={formatTimecode(range.end)} disabled={!!job} />
            </label>
          </div>
          <div className="row">
            <button type="button" className="btn small" onClick={() => fromPlayhead('start')} disabled={!!job}>
              Start at playhead
            </button>
            <button type="button" className="btn small" onClick={() => fromPlayhead('end')} disabled={!!job}>
              End at playhead
            </button>
            <button type="button" className="btn small" onClick={previewSelection} disabled={!!job}>
              <IconPlay size={14} /> Preview selection
            </button>
            <span className="muted small">Selected {formatTimecode(Math.max(0, range.end - range.start))}</span>
          </div>

          <fieldset className="fieldset" disabled={!!job}>
            <legend className="field-label">Method</legend>
            {!loadError && (
              <label className="check">
                <input type="radio" name="trim-mode" checked={mode === 'fast'} onChange={() => setMode('fast')} />
                <span>
                  Fast, no re-encoding <span className="muted tiny block">Cuts at the nearest key frame before your start. Original quality.</span>
                </span>
              </label>
            )}
            {!loadError && webcodecs && (
              <label className="check">
                <input type="radio" name="trim-mode" checked={mode === 'precise'} disabled={caps ? !caps.preciseTrim : true} onChange={() => setMode('precise')} />
                <span>
                  Frame-accurate (re-encode)
                  <span className="muted tiny block">{caps && !caps.preciseTrim ? 'This browser can’t encode this video codec.' : 'Exact cut. Slower; re-encodes the video.'}</span>
                </span>
              </label>
            )}
            {(!webcodecs || loadError) && (
              <label className="check">
                <input type="radio" name="trim-mode" checked={mode === 'realtime'} onChange={() => setMode('realtime')} />
                <span>
                  Real-time re-record
                  <span className="muted tiny block">Plays the selection and records it again. Takes as long as the clip; keep this tab open.</span>
                </span>
              </label>
            )}
          </fieldset>
          {mode === 'fast' && keyStart !== null && check.ok && check.start - keyStart > 0.05 && (
            <p className="muted small">Fast trim will start at {formatTimecode(keyStart)} (the previous key frame).</p>
          )}
          {loading && <Loading label="Loading the editor…" />}
          {loadError && <p className="muted small">Fast trimming isn’t available for this file here ({loadError}).</p>}
          {!check.ok && <p className="muted small">{check.error}</p>}
          <div className="row">
            <button type="button" className="btn primary" onClick={doTrim} disabled={!check.ok || !!job || (mode !== 'realtime' && !editor)}>
              <IconScissors size={16} /> Save trimmed copy
            </button>
          </div>
        </>
      )}

      {caps && (caps.toMp4 || caps.toWebm) && (
        <>
          <h2>
            <IconConvert size={18} /> Convert
          </h2>
          <div className="row">
            {caps.toMp4 && (
              <button type="button" className="btn" onClick={() => doConvert('mp4')} disabled={!!job}>
                Convert to {convLabel('mp4', caps.toMp4)}
              </button>
            )}
            {caps.toWebm && (
              <button type="button" className="btn" onClick={() => doConvert('webm')} disabled={!!job}>
                Convert to {convLabel('webm', caps.toWebm)}
              </button>
            )}
          </div>
          <p className="muted tiny">Re-encodes in your browser with WebCodecs and saves a new copy. MP4 with H.264 + AAC plays almost everywhere.</p>
        </>
      )}

      {job && (
        <div className="stack-sm" aria-live="polite">
          <div className="row">
            <span className="small">{job.label}</span>
            <span className="spacer" />
            <button type="button" className="btn small" onClick={() => abort.current?.abort()}>
              Cancel
            </button>
          </div>
          <ProgressBar value={job.progress} label={job.label} />
        </div>
      )}
      {error && (
        <Notice kind="error" onDismiss={() => setError(null)}>
          {error}
        </Notice>
      )}
      {result && (
        <Notice kind="success" onDismiss={() => setResult(null)} actions={<Link className="btn small primary" to={`/play/${result.meta.id}`}>Open copy</Link>}>
          Saved “{result.meta.title}”. {result.note}
        </Notice>
      )}
    </section>
  );
}

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Callout } from '../components/Callout';
import { IconBack, IconCopy, IconDownload, IconSearch, IconClose } from '../components/Icons';
import { exportFileName, exportTranscript, EXPORT_MIME, toTxt, type ExportFormat } from '../lib/exporters';
import { languageName } from '../lib/languages';
import { modelById } from '../lib/models';
import { activeSegmentIndex, highlightParts, searchSegments } from '../lib/search';
import { transcriptStore } from '../lib/storage';
import { formatClock, formatDuration, plural, spokenTime } from '../lib/time';
import type { Segment, Transcript } from '../types';

export function download(text: string, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function sourceLabel(t: Transcript): string {
  if (t.source === 'dictation') return 'Live dictation (Web Speech API)';
  const m = modelById(t.model);
  const model = m ? `Whisper ${m.label}` : t.model;
  return `${model}${t.backend ? ` · ${t.backend === 'webgpu' ? 'WebGPU' : 'WASM'}` : ''}`;
}

interface RowProps {
  seg: Segment;
  index: number;
  active: boolean;
  query: string;
  onSeek: (t: number) => void;
  onEdit: (index: number, text: string) => void;
}

/** One segment: a time button that seeks, and an auto-growing textarea over a highlight layer. */
const SegmentRow = memo(function SegmentRow({ seg, index, active, query, onSeek, onEdit }: RowProps) {
  const parts = useMemo(() => (query ? highlightParts(seg.text, query) : null), [seg.text, query]);
  return (
    <li className={active ? 'seg active' : 'seg'} data-index={index} aria-current={active ? 'true' : undefined}>
      <button type="button" className="ts-btn mono" onClick={() => onSeek(seg.start)} aria-label={`Play from ${spokenTime(seg.start)}`} title="Play from here">
        {formatClock(seg.start)}
      </button>
      <div className="seg-edit">
        <div className="seg-mirror" aria-hidden="true">
          {parts ? parts.map((p, i) => (p.match ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>)) : seg.text}
          {' '}
        </div>
        <textarea
          className="seg-text"
          value={seg.text}
          rows={1}
          spellCheck
          aria-label={`Segment at ${formatClock(seg.start)}`}
          onChange={(e) => onEdit(index, e.target.value)}
        />
      </div>
    </li>
  );
});

export function TranscriptPage() {
  const { id = '' } = useParams();
  const [t, setT] = useState<Transcript | null | undefined>(undefined);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [query, setQuery] = useState('');
  const [follow, setFollow] = useState(true);
  const [txtStamps, setTxtStamps] = useState(false);
  const [notice, setNotice] = useState('');
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const audio = useRef<HTMLAudioElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const latest = useRef<Transcript | null>(null);
  const searchId = useId();
  const rateId = useId();

  useEffect(() => {
    let live = true;
    let url: string | null = null;
    setT(undefined);
    void transcriptStore
      .get(id)
      .catch(() => null)
      .then(async (tr) => {
        if (!live) return;
        setT(tr);
        latest.current = tr;
        if (!tr?.hasAudio) return;
        try {
          const blob = await transcriptStore.getAudio(id);
          if (blob && live) {
            url = URL.createObjectURL(blob);
            setAudioUrl(url);
          }
        } catch {
          /* transcript still shows, without the player */
        }
      });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
      setAudioUrl(null);
    };
  }, [id]);

  useEffect(() => {
    document.title = t ? `${t.title} · Speech to Text` : 'Speech to Text';
  }, [t]);

  const flush = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    const cur = latest.current;
    if (!cur) return;
    try {
      await transcriptStore.put(cur);
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  }, []);

  // Save edits shortly after typing stops, and when leaving the page.
  useEffect(() => () => void (saveTimer.current !== undefined && flush()), [flush]);

  const update = useCallback(
    (fn: (t: Transcript) => Transcript) => {
      setT((prev) => {
        if (!prev) return prev;
        const next = { ...fn(prev), updatedAt: Date.now() };
        latest.current = next;
        return next;
      });
      setSaveState('saving');
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void flush(), 600);
    },
    [flush],
  );

  const onEdit = useCallback(
    (index: number, text: string) =>
      update((prev) => {
        const segments = prev.segments.slice();
        const { words, ...rest } = segments[index];
        void words; // word timings no longer match edited text
        segments[index] = { ...rest, text };
        return { ...prev, segments };
      }),
    [update],
  );

  const onSeek = useCallback((s: number) => {
    const a = audio.current;
    if (!a) return;
    a.currentTime = s;
    setTime(s);
    void a.play().catch(() => {});
  }, []);

  // Track playback position: timeupdate is ~4 Hz, so poll on frames while playing.
  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    let raf = 0;
    const tick = () => {
      setTime(a.currentTime);
      if (!a.paused) raf = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    const onSeeked = () => setTime(a.currentTime);
    a.addEventListener('play', onPlay);
    a.addEventListener('seeked', onSeeked);
    a.addEventListener('timeupdate', onSeeked);
    return () => {
      cancelAnimationFrame(raf);
      a.removeEventListener('play', onPlay);
      a.removeEventListener('seeked', onSeeked);
      a.removeEventListener('timeupdate', onSeeked);
    };
  }, [audioUrl]);

  const segments = t?.segments ?? [];
  const active = audioUrl ? activeSegmentIndex(segments, time) : -1;
  const matches = useMemo(() => (query.trim() ? searchSegments(segments, query) : null), [segments, query]);
  const shown = matches ?? segments.map((_, i) => i);

  useEffect(() => {
    if (!follow || active < 0 || !list.current) return;
    if (document.activeElement instanceof HTMLTextAreaElement && list.current.contains(document.activeElement)) return;
    const el = list.current.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active, follow]);

  if (t === undefined) return <div className="page muted">Loading…</div>;
  if (t === null) {
    return (
      <div className="page">
        <div className="card stack-sm">
          <h1>That transcript doesn’t exist</h1>
          <p className="muted">It may have been deleted, here or in another tab.</p>
          <Link to="/library" className="btn primary self-start">
            Library
          </Link>
        </div>
      </div>
    );
  }

  const exportAs = (fmt: ExportFormat) => {
    download(exportTranscript(latest.current ?? t, fmt, { timestamps: txtStamps }), exportFileName(t.title, fmt), EXPORT_MIME[fmt]);
    setNotice(`Downloaded ${fmt.toUpperCase()}`);
  };

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(toTxt(t.segments, { timestamps: txtStamps }));
      setNotice('Copied the transcript');
    } catch {
      setNotice('Copy failed: the browser blocked clipboard access');
    }
  };

  return (
    <div className="page wide">
      <Link to="/library" className="back-link">
        <IconBack size={16} /> Library
      </Link>
      <header className="stack-xs">
        <label className="sr-only" htmlFor="title-input">
          Title
        </label>
        <input id="title-input" className="title-input" value={t.title} onChange={(e) => update((p) => ({ ...p, title: e.target.value }))} onBlur={() => void flush()} />
        <p className="muted small">
          {new Date(t.createdAt).toLocaleString()} · {formatDuration(t.duration)} · {sourceLabel(t)} · {t.task === 'translate' ? 'Translated to English from ' : ''}
          {languageName(t.language)}
          {t.languageDetected ? ' (detected)' : ''} · {plural(t.segments.length, 'segment')} · {plural(t.wordCount, 'word')}{' '}
          <span className="save-state" aria-live="polite">
            · {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Couldn’t save' : 'Saved'}
          </span>
        </p>
        {t.partial && <Callout kind="warn" title="Partial transcript">The transcription was cancelled before the end.</Callout>}
      </header>

      <div className="player card">
        {audioUrl ? (
          <div className="row player-row">
            <audio ref={audio} src={audioUrl} controls preload="metadata" className="grow" aria-label="Audio" />
            <label className="sr-only" htmlFor={rateId}>
              Playback speed
            </label>
            <select id={rateId} className="input auto" defaultValue="1" onChange={(e) => audio.current && (audio.current.playbackRate = Number(e.target.value))}>
              {['0.75', '1', '1.25', '1.5', '2'].map((r) => (
                <option key={r} value={r}>
                  {r}×
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="muted small">{t.source === 'dictation' ? 'Dictation keeps no audio.' : 'No audio was kept for this transcript.'}</p>
        )}
        <div className="toolbar">
          <div className="search">
            <IconSearch size={16} />
            <label className="sr-only" htmlFor={searchId}>
              Search transcript
            </label>
            <input id={searchId} type="search" className="input" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
            {query && (
              <button type="button" className="btn ghost icon small" onClick={() => setQuery('')} aria-label="Clear search">
                <IconClose size={14} />
              </button>
            )}
          </div>
          {matches && (
            <span className="small muted" role="status">
              {matches.length} of {plural(segments.length, 'segment')} match
            </span>
          )}
          {audioUrl && (
            <label className="check small">
              <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow playback
            </label>
          )}
        </div>
      </div>

      <div className="row export-row">
        <button type="button" className="btn small" onClick={() => void copyAll()}>
          <IconCopy size={15} /> Copy all
        </button>
        <span className="muted small">Export:</span>
        {(['txt', 'srt', 'vtt', 'json'] as ExportFormat[]).map((f) => (
          <button key={f} type="button" className="btn small" onClick={() => exportAs(f)} aria-label={`Download ${f.toUpperCase()}`}>
            <IconDownload size={15} /> {f.toUpperCase()}
          </button>
        ))}
        <label className="check small">
          <input type="checkbox" checked={txtStamps} onChange={(e) => setTxtStamps(e.target.checked)} /> Timestamps in TXT and copy
        </label>
        <span className="sr-only" role="status" aria-live="polite">
          {notice}
        </span>
      </div>

      {segments.length === 0 ? (
        <p className="muted">No speech was found.</p>
      ) : matches && matches.length === 0 ? (
        <p className="muted">Nothing matches “{query.trim()}”.</p>
      ) : (
        <ol ref={list} className="seg-list" aria-label="Transcript segments">
          {shown.map((i) => (
            <SegmentRow key={segments[i].id} seg={segments[i]} index={i} active={i === active} query={query.trim()} onSeek={onSeek} onEdit={onEdit} />
          ))}
        </ol>
      )}
    </div>
  );
}

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Callout, ErrorCallout } from '../components/Callout';
import { DictationPanel } from '../components/DictationPanel';
import { DropZone } from '../components/DropZone';
import { IconMic, IconShield, IconUpload, IconBolt, IconClose } from '../components/Icons';
import { ProgressBar } from '../components/Progress';
import { RecordPanel } from '../components/RecordPanel';
import { SettingsPanel, useResolvedBackend } from '../components/Settings';
import { languageName } from '../lib/languages';
import { CHUNK_SECONDS, STRIDE_SECONDS } from '../lib/merge';
import { modelById } from '../lib/models';
import { formatBytes, formatClock, formatDuration } from '../lib/time';
import { jobStore, useJob, type JobState } from '../store/job';
import { usePrefs } from '../store/prefs';

type Tab = 'file' | 'mic' | 'dictation';
const TABS: [Tab, string, typeof IconUpload][] = [
  ['file', 'Upload', IconUpload],
  ['mic', 'Record', IconMic],
  ['dictation', 'Live dictation', IconBolt],
];

function titleFromFile(name: string): string {
  return name.replace(/\.[a-z0-9]{2,5}$/i, '') || name;
}

function JobProgress({ job }: { job: JobState }) {
  const model = modelById(job.prefs?.model ?? '');
  // Compressed JSON files arrive without a length, and files start one after another, so the
  // catalogue size is the floor for the total (the bar would otherwise jump backwards).
  const expected = model && job.backend ? model.mb[job.backend] * 1e6 : 0;
  const loaded = job.files.reduce((s, f) => s + Math.min(f.loaded, f.total), 0);
  const total = Math.max(expected, job.files.reduce((s, f) => s + f.total, 0));
  const duration = job.input?.duration ?? 0;
  const step = CHUNK_SECONDS - 2 * STRIDE_SECONDS;
  const covered = job.windowsTotal ? Math.min(duration, job.windowsDone >= job.windowsTotal ? duration : job.windowsDone * step) : 0;
  const announce =
    job.phase === 'loading'
      ? `Loading ${model?.label ?? ''} model`
      : job.phase === 'detecting'
        ? 'Detecting the language'
        : job.phase === 'transcribing'
          ? `Transcribed ${formatClock(covered)} of ${formatClock(duration)}`
          : job.message;
  return (
    <section className="card stack-sm" aria-labelledby="progress-h">
      <div className="row">
        <h2 id="progress-h">{job.phase === 'loading' ? 'Loading model' : job.phase === 'detecting' ? 'Detecting language' : 'Transcribing'}</h2>
        <span className="spacer" />
        {job.backend && <span className="badge">{job.backend === 'webgpu' ? 'WebGPU' : 'WASM · CPU, 1 thread'}</span>}
        <button type="button" className="btn small" onClick={() => jobStore.cancel()}>
          <IconClose size={14} /> Cancel
        </button>
      </div>
      {job.fallbackReason && <p className="muted small">{job.fallbackReason}</p>}
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      {job.phase === 'loading' && (
        <div className="stack-xs">
          <ProgressBar value={total ? loaded / total : null} label="Model download" />
          <p className="muted small">
            {total ? `${formatBytes(loaded)} of ${formatBytes(total)}` : 'Preparing…'} · {job.files.length} file{job.files.length === 1 ? '' : 's'}. The first run downloads the model; later runs load it from this device.
          </p>
        </div>
      )}
      {job.phase === 'detecting' && <ProgressBar value={null} label="Language detection" />}
      {job.phase === 'transcribing' && (
        <div className="stack-xs">
          <ProgressBar value={job.windowsTotal ? job.windowsDone / job.windowsTotal : null} label="Transcription progress" />
          <p className="muted small">
            {formatClock(covered)} of {formatClock(duration)} · part {Math.min(job.windowsDone + 1, job.windowsTotal)} of {job.windowsTotal} · {formatDuration(job.elapsedMs / 1000)} elapsed
          </p>
        </div>
      )}
      {job.language && (
        <p className="small">
          Detected language: <strong>{languageName(job.language.code)}</strong> <span className="muted">({Math.round(job.language.probability * 100)}% sure)</span>
        </p>
      )}
    </section>
  );
}

function LivePreview({ job }: { job: JobState }) {
  if (!job.segments.length && !job.partial) return null;
  return (
    <section className="card stack-sm" aria-labelledby="live-h">
      <h2 id="live-h">Transcript so far</h2>
      <ol className="live-list">
        {job.segments.map((s) => (
          <li key={s.id}>
            <span className="ts mono">{formatClock(s.start)}</span>
            <span>{s.text}</span>
          </li>
        ))}
        {job.partial && (
          <li className="partial">
            <span className="ts mono">…</span>
            <span>{job.partial}</span>
          </li>
        )}
      </ol>
    </section>
  );
}

export function TranscribePage() {
  const job = useJob();
  const [prefs, setPrefs] = usePrefs();
  const [tab, setTab] = useState<Tab>('file');
  const navigate = useNavigate();
  const { backend } = useResolvedBackend(prefs.backend);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Open the saved transcript when a run finishes while this page is showing.
  const prevStatus = useRef(job.status);
  useEffect(() => {
    if (prevStatus.current !== 'done' && job.status === 'done' && job.savedId) navigate(`/t/${job.savedId}`);
    prevStatus.current = job.status;
  }, [job.status, job.savedId, navigate]);

  useEffect(() => {
    document.title = job.status === 'running' ? `Transcribing… · Speech to Text` : 'Speech to Text';
  }, [job.status]);

  const running = job.status === 'running';
  const input = job.input;
  const model = modelById(prefs.model);

  const onTabKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = (i + d + TABS.length) % TABS.length;
    setTab(TABS[next][0]);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>Speech to text</h1>
        <p className="muted">
          <IconShield size={15} className="inline-icon" /> Whisper runs on this device. Your audio isn’t uploaded.
        </p>
      </header>

      <div className="tabs" role="tablist" aria-label="Input">
        {TABS.map(([id, label, Icon], i) => (
          <button
            key={id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            className={tab === id ? 'tab active' : 'tab'}
            onClick={() => setTab(id)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      <section className="card stack-sm" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'file' && <DropZone onFile={(f) => void jobStore.setInput(f, { source: 'file', title: titleFromFile(f.name), fileName: f.name })} disabled={running} />}
        {tab === 'mic' && <RecordPanel disabled={running} />}
        {tab === 'dictation' && <DictationPanel />}
      </section>

      {tab !== 'dictation' && (
        <>
          {job.status === 'decoding' && (
            <div className="card stack-xs" role="status">
              <p>{job.message}</p>
              <ProgressBar value={null} label="Reading the audio" />
            </div>
          )}
          {job.status === 'error' && job.error && <ErrorCallout error={job.error} onRetry={input ? () => void jobStore.start(prefs) : undefined} />}

          {input && (
            <section className="card stack-sm" aria-labelledby="input-h">
              <div className="row">
                <h2 id="input-h" className="grow ellipsis">
                  {input.fileName ?? input.title}
                </h2>
                {!running && (
                  <button type="button" className="btn small ghost" onClick={() => jobStore.reset()}>
                    Clear
                  </button>
                )}
              </div>
              <p className="muted small">
                {formatDuration(input.duration)} · {input.source === 'mic' ? 'microphone recording' : input.blob.type || 'file'} · {formatBytes(input.blob.size)}
              </p>
              <SettingsPanel prefs={prefs} onChange={setPrefs} disabled={running} cacheKey={job.status} />
              {!running && (
                <div className="row">
                  <button type="button" className="btn primary big" onClick={() => void jobStore.start(prefs)}>
                    {prefs.task === 'translate' ? 'Translate to English' : 'Transcribe'}
                  </button>
                  <span className="muted small">
                    {model?.label} model on {backend === 'webgpu' ? 'WebGPU' : 'CPU (WASM)'}
                  </span>
                </div>
              )}
            </section>
          )}

          {running && <JobProgress job={job} />}

          {job.status === 'cancelled' && (
            <Callout kind="info" title="Cancelled" role="status">
              <p>
                {job.segments.length
                  ? `${job.segments.length} segment${job.segments.length === 1 ? ' was' : 's were'} transcribed before you cancelled.`
                  : 'Nothing was transcribed yet.'}
              </p>
              {job.segments.length > 0 && (
                <button type="button" className="btn small mt-sm" onClick={() => void jobStore.save(true).then((id) => navigate(`/t/${id}`))}>
                  Save what’s done
                </button>
              )}
            </Callout>
          )}

          {job.status === 'done' && job.savedId && (
            <Callout kind="info" title="Saved to your library" role="status">
              <Link to={`/t/${job.savedId}`}>Open the transcript</Link>
            </Callout>
          )}

          {(running || job.status === 'cancelled') && <LivePreview job={job} />}

          {!input && job.status === 'idle' && (
            <section className="card stack-xs muted small" aria-label="How it works">
              <p>
                <strong className="text">How it works:</strong> pick a file or record, choose a model, press Transcribe. The first time, the model is downloaded from Hugging Face ({formatBytes((model?.mb[backend] ?? 0) * 1e6)} for{' '}
                {model?.label}) and kept in this browser, so later runs work offline. Long audio is processed in 30-second windows; results stream in as each one finishes.
              </p>
              <p>
                <Link to="/about">Privacy and limits</Link>
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}

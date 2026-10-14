import { useCallback, useEffect, useRef, useState } from 'react';
import { micErrorInfo, type ErrorInfo } from '../lib/errors';
import { formatClock } from '../lib/time';
import { micSupported } from '../media/features';
import { MicRecorder } from '../media/micRecorder';
import { jobStore } from '../store/job';
import { ErrorCallout } from './Callout';
import { IconPause, IconPlay, IconRecord, IconStop } from './Icons';
import { LevelMeter } from './LevelMeter';

type Phase = 'idle' | 'starting' | 'recording' | 'paused';

function recordingTitle(d = new Date()): string {
  return `Recording ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

export function RecordPanel({ disabled }: { disabled?: boolean }) {
  const rec = useRef<MicRecorder | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const read = useCallback(() => rec.current?.level() ?? 0, []);

  useEffect(() => {
    if (phase !== 'recording' && phase !== 'paused') return;
    const t = window.setInterval(() => setElapsed(rec.current?.elapsed() ?? 0), 250);
    return () => window.clearInterval(t);
  }, [phase]);

  useEffect(() => () => rec.current?.discard(), []);

  const start = async () => {
    setError(null);
    setPhase('starting');
    const r = new MicRecorder();
    rec.current = r;
    try {
      await r.start();
      setElapsed(0);
      setPhase('recording');
    } catch (e) {
      r.discard();
      rec.current = null;
      setError(micErrorInfo(e));
      setPhase('idle');
    }
  };

  const stop = async () => {
    const r = rec.current;
    if (!r) return;
    const blob = await r.stop();
    rec.current = null;
    setPhase('idle');
    if (blob.size) await jobStore.setInput(blob, { source: 'mic', title: recordingTitle() });
  };

  if (!micSupported()) {
    return <p className="muted">This browser can’t record from the microphone. Upload a file instead.</p>;
  }

  const live = phase === 'recording' || phase === 'paused';
  return (
    <div className="stack-sm">
      {error && <ErrorCallout error={error} onRetry={() => void start()} />}
      <div className="recorder">
        <div className="rec-time" aria-hidden={!live}>
          <span className={phase === 'recording' ? 'rec-dot on' : 'rec-dot'} aria-hidden="true" />
          <span className="mono">{formatClock(elapsed / 1000)}</span>
          <span className="muted small">{phase === 'paused' ? 'Paused' : phase === 'recording' ? 'Recording' : phase === 'starting' ? 'Starting…' : 'Ready'}</span>
        </div>
        <LevelMeter active={phase === 'recording'} read={read} />
        <div className="row">
          {!live ? (
            <button type="button" className="btn primary rec" onClick={() => void start()} disabled={disabled || phase === 'starting'}>
              <IconRecord /> Start recording
            </button>
          ) : (
            <>
              {phase === 'recording' ? (
                <button type="button" className="btn" onClick={() => { rec.current?.pause(); setPhase('paused'); }}>
                  <IconPause /> Pause
                </button>
              ) : (
                <button type="button" className="btn" onClick={() => { rec.current?.resume(); setPhase('recording'); }}>
                  <IconPlay /> Resume
                </button>
              )}
              <button type="button" className="btn primary" onClick={() => void stop()}>
                <IconStop /> Stop and use
              </button>
              <button type="button" className="btn ghost" onClick={() => { rec.current?.discard(); rec.current = null; setPhase('idle'); setElapsed(0); }}>
                Discard
              </button>
            </>
          )}
        </div>
        <p className="sr-only" aria-live="polite">
          {phase === 'recording' ? 'Recording started' : phase === 'paused' ? 'Recording paused' : ''}
        </p>
      </div>
      <p className="muted tiny">The recording stays in this browser. After you stop, Whisper transcribes it on this device.</p>
    </div>
  );
}

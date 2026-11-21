import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { dictationErrorInfo, type ErrorInfo } from '../lib/errors';
import { newId } from '../lib/id';
import { DICTATION_LANGS } from '../lib/languages';
import { countWords, transcriptStore } from '../lib/storage';
import { formatClock } from '../lib/time';
import { speechRecognitionCtor, startDictation } from '../media/dictation';
import { usePrefs } from '../store/prefs';
import type { Segment } from '../types';
import { Callout, ErrorCallout } from './Callout';
import { IconCloud, IconMic, IconStop } from './Icons';

function defaultLang(): string {
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'en-US';
  return DICTATION_LANGS.some(([t]) => t === nav) ? nav : 'en-US';
}

export function DictationPanel() {
  const supported = speechRecognitionCtor() !== null;
  const [prefs, setPrefs] = usePrefs();
  const lang = prefs.dictationLang || defaultLang();
  const [running, setRunning] = useState(false);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<ErrorInfo | null>(null);
  const handle = useRef<{ stop(): void } | null>(null);
  const navigate = useNavigate();
  const langId = useId();

  useEffect(() => () => handle.current?.stop(), []);

  if (!supported) {
    return (
      <Callout kind="info" title="Live dictation isn’t available in this browser">
        It uses the Web Speech API, which Firefox doesn’t provide. Record or upload instead: those run on this device with Whisper.
      </Callout>
    );
  }

  const start = () => {
    setError(null);
    try {
      handle.current = startDictation(lang, {
        onFinal: (text, start, end) => setSegments((s) => [...s, { id: `d${s.length}`, start, end, text }]),
        onInterim: setInterim,
        onError: (code) => setError(dictationErrorInfo(code)),
        onEnd: () => {
          setRunning(false);
          handle.current = null;
        },
      });
      setRunning(true);
    } catch (e) {
      setError({ title: 'Dictation couldn’t start', message: (e as Error).message, canRetry: true });
    }
  };

  const save = async () => {
    const now = Date.now();
    const id = newId();
    const d = new Date(now);
    await transcriptStore.put({
      version: 1,
      id,
      title: `Dictation ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`,
      createdAt: now,
      updatedAt: now,
      duration: segments.length ? segments[segments.length - 1].end : 0,
      source: 'dictation',
      model: 'web-speech',
      task: 'transcribe',
      language: lang,
      timestamps: 'segment',
      hasAudio: false,
      segmentCount: segments.length,
      wordCount: countWords(segments),
      segments,
    });
    navigate(`/t/${id}`);
  };

  return (
    <div className="stack-sm">
      <Callout kind="warn" title="Not on-device: audio goes to your browser’s speech service">
        Live dictation uses the browser’s Web Speech API. In Chrome and Edge that streams your microphone audio to Google or Microsoft servers, unlike the Whisper modes, which never upload anything. It
        needs a connection, isn’t available in Firefox, and timestamps are approximate.
      </Callout>
      {error && <ErrorCallout error={error} onRetry={start} />}
      <div className="row">
        <label className="label" htmlFor={langId}>
          Language
        </label>
        <select id={langId} className="input auto" value={lang} onChange={(e) => setPrefs({ dictationLang: e.target.value })} disabled={running}>
          {DICTATION_LANGS.map(([tag, name]) => (
            <option key={tag} value={tag}>
              {name}
            </option>
          ))}
        </select>
        {!running ? (
          <button type="button" className="btn primary" onClick={start}>
            <IconMic /> Start dictation
          </button>
        ) : (
          <button type="button" className="btn primary" onClick={() => handle.current?.stop()}>
            <IconStop /> Stop
          </button>
        )}
        {running && (
          <span className="badge warn">
            <IconCloud size={14} /> Sending audio to speech service
          </span>
        )}
      </div>
      <div className="dictation-out" aria-live="polite">
        {segments.map((s) => (
          <p key={s.id}>
            <span className="muted mono tiny">{formatClock(s.start)}</span> {s.text}
          </p>
        ))}
        {interim && <p className="muted interim">{interim}</p>}
        {!segments.length && !interim && <p className="muted small">{running ? 'Listening… start speaking.' : 'Dictated text appears here.'}</p>}
      </div>
      {segments.length > 0 && !running && (
        <div className="row">
          <button type="button" className="btn primary" onClick={() => void save()}>
            Save to library
          </button>
          <button type="button" className="btn ghost" onClick={() => setSegments([])}>
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

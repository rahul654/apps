/**
 * Live dictation with the Web Speech API (SpeechRecognition). This is NOT on-device in Chrome
 * and Edge: they stream the audio to their speech service. Firefox doesn't provide it.
 */

interface SpeechAlternative {
  transcript: string;
  confidence: number;
}
interface SpeechResult {
  isFinal: boolean;
  length: number;
  [i: number]: SpeechAlternative;
}
interface SpeechEvent extends Event {
  resultIndex: number;
  results: { length: number; [i: number]: SpeechResult };
}
interface SpeechErrorEvent extends Event {
  error: string;
}
export interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type Ctor = new () => SpeechRecognitionLike;

export function speechRecognitionCtor(): Ctor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface DictationCallbacks {
  /** A final phrase, with seconds since start (approximate: when the result arrived). */
  onFinal(text: string, start: number, end: number): void;
  onInterim(text: string): void;
  onError(code: string): void;
  onEnd(): void;
}

/**
 * Starts dictation. Chrome ends a session after a pause or about a minute, so it restarts
 * itself until stop() is called.
 */
export function startDictation(lang: string, cb: DictationCallbacks): { stop(): void } {
  const Ctor = speechRecognitionCtor();
  if (!Ctor) throw new Error('Live dictation isn’t available in this browser.');
  const t0 = performance.now();
  let stopped = false;
  let phraseStart: number | null = null;
  let rec: SpeechRecognitionLike;
  const begin = () => {
    rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = '';
      const now = (performance.now() - t0) / 1000;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0]?.transcript ?? '';
        if (phraseStart === null) phraseStart = Math.max(0, now - 1);
        if (r.isFinal) {
          if (text.trim()) cb.onFinal(text.trim(), phraseStart, now);
          phraseStart = null;
        } else interim += text;
      }
      cb.onInterim(interim);
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      stopped = true;
      cb.onError(e.error);
    };
    rec.onend = () => {
      if (!stopped) {
        try {
          begin();
          return;
        } catch {
          /* fall through */
        }
      }
      cb.onInterim('');
      cb.onEnd();
    };
    rec.start();
  };
  begin();
  return {
    stop() {
      stopped = true;
      try {
        rec.stop();
      } catch {
        cb.onEnd();
      }
    },
  };
}

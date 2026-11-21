/**
 * Microphone recording with a level meter, pause and resume. MediaRecorder collects compressed
 * chunks (1 s timeslice); the page decodes the result to 16 kHz for Whisper and keeps a WAV copy
 * (MediaRecorder WebM files have no duration in their header, so players can't seek them).
 * `?fake=1` swaps the mic for a pulsing tone.
 */
import { meterLevel } from '../lib/audio';
import { rms } from '../lib/merge';
import { isFakeMode } from '../lib/fake';

export type MicState = 'idle' | 'recording' | 'paused' | 'stopped';

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/ogg;codecs=opus'];

export function pickMime(isSupported: (t: string) => boolean): string {
  return MIME_CANDIDATES.find((t) => isSupported(t)) ?? '';
}

function fakeMicStream(ctx: AudioContext): MediaStream {
  const osc = ctx.createOscillator();
  osc.frequency.value = 440;
  const gain = ctx.createGain();
  gain.gain.value = 0.2;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.5;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.15;
  lfo.connect(lfoGain).connect(gain.gain);
  const dest = ctx.createMediaStreamDestination();
  osc.connect(gain).connect(dest);
  osc.start();
  lfo.start();
  return dest.stream;
}

export class MicRecorder {
  state: MicState = 'idle';
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private buf: Float32Array<ArrayBuffer> | null = null;
  private startedAt = 0;
  private accumulated = 0;
  mimeType = '';

  async start(deviceId?: string): Promise<void> {
    this.ctx = new AudioContext();
    void this.ctx.resume().catch(() => {});
    this.stream = isFakeMode()
      ? fakeMicStream(this.ctx)
      : await navigator.mediaDevices.getUserMedia({
          audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        });
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    src.connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);
    this.mimeType = pickMime((t) => MediaRecorder.isTypeSupported(t));
    this.rec = new MediaRecorder(this.stream, this.mimeType ? { mimeType: this.mimeType, audioBitsPerSecond: 64000 } : undefined);
    this.mimeType = this.rec.mimeType || this.mimeType;
    this.chunks = [];
    this.rec.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.rec.start(1000);
    this.startedAt = performance.now();
    this.accumulated = 0;
    this.state = 'recording';
  }

  /** Recorded time in ms, excluding pauses. */
  elapsed(): number {
    return this.accumulated + (this.state === 'recording' ? performance.now() - this.startedAt : 0);
  }

  /** 0..1 on a dB scale. */
  level(): number {
    if (!this.analyser || !this.buf || this.state !== 'recording') return 0;
    this.analyser.getFloatTimeDomainData(this.buf);
    return meterLevel(rms(this.buf));
  }

  pause(): void {
    if (this.state !== 'recording' || !this.rec) return;
    this.rec.pause();
    this.accumulated += performance.now() - this.startedAt;
    this.state = 'paused';
  }

  resume(): void {
    if (this.state !== 'paused' || !this.rec) return;
    this.rec.resume();
    this.startedAt = performance.now();
    this.state = 'recording';
  }

  /** Stops and returns the recording. */
  stop(): Promise<Blob> {
    const rec = this.rec;
    if (!rec || rec.state === 'inactive') {
      this.release();
      return Promise.resolve(new Blob(this.chunks, { type: this.mimeType }));
    }
    if (this.state === 'recording') this.accumulated += performance.now() - this.startedAt;
    return new Promise((resolve) => {
      rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mimeType || rec.mimeType });
        this.release();
        this.state = 'stopped';
        resolve(blob);
      };
      rec.stop();
    });
  }

  /** Stops everything and drops what was recorded. */
  discard(): void {
    try {
      if (this.rec && this.rec.state !== 'inactive') this.rec.stop();
    } catch {
      /* already stopped */
    }
    this.chunks = [];
    this.release();
    this.state = 'idle';
  }

  private release(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.analyser = null;
  }
}

/**
 * Mixes the microphone and system / tab audio into one track with Web Audio.
 *
 *   mic ──► micGain (slider × mute) ──┬──► destination (recorded track)
 *                                     └──► analyser (level meter)
 *   system/tab audio ──► systemGain ──┘
 *
 * The AudioContext renders on the audio thread, so it keeps running in background tabs.
 */
import { meterLevel, rms, smoothLevel } from '../lib/audioLevel';

export class AudioMixer {
  readonly ctx: AudioContext;
  private dest: MediaStreamAudioDestinationNode;
  private micGain: GainNode;
  private systemGain: GainNode;
  private analyser: AnalyserNode;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private systemSources: MediaStreamAudioSourceNode[] = [];
  private buf: Float32Array<ArrayBuffer>;
  private gain = 1;
  private muted = false;
  private level = 0;
  private closed = false;

  constructor(ctx?: AudioContext) {
    this.ctx = ctx ?? new AudioContext({ latencyHint: 'interactive' });
    this.dest = this.ctx.createMediaStreamDestination();
    this.micGain = this.ctx.createGain();
    this.systemGain = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.buf = new Float32Array(this.analyser.fftSize);
    this.micGain.connect(this.dest);
    this.micGain.connect(this.analyser);
    this.systemGain.connect(this.dest);
  }

  /** Resumes a suspended context (call from a user gesture). */
  async resume(): Promise<void> {
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
  }

  setMic(stream: MediaStream | null): void {
    this.micSource?.disconnect();
    this.micSource = null;
    const track = stream?.getAudioTracks()[0];
    if (track) {
      this.micSource = this.ctx.createMediaStreamSource(new MediaStream([track]));
      this.micSource.connect(this.micGain);
    }
  }

  get hasMic(): boolean {
    return this.micSource !== null;
  }

  addSystem(stream: MediaStream): boolean {
    const track = stream.getAudioTracks()[0];
    if (!track) return false;
    const src = this.ctx.createMediaStreamSource(new MediaStream([track]));
    src.connect(this.systemGain);
    this.systemSources.push(src);
    return true;
  }

  clearSystem(): void {
    for (const s of this.systemSources) s.disconnect();
    this.systemSources = [];
  }

  get sourceCount(): number {
    return (this.micSource ? 1 : 0) + this.systemSources.length;
  }

  setMicGain(v: number): void {
    this.gain = Math.max(0, Math.min(2, v));
    this.apply();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.apply();
  }

  private apply() {
    if (this.closed) return;
    const target = this.muted ? 0 : this.gain;
    this.micGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.015);
  }

  /** Smoothed 0..1 mic level (after gain / mute). Call ~30×/s. */
  readLevel(): number {
    if (this.closed || !this.micSource) return 0;
    this.analyser.getFloatTimeDomainData(this.buf);
    this.level = smoothLevel(this.level, meterLevel(rms(this.buf)));
    return this.level;
  }

  /** The mixed track to record. */
  get track(): MediaStreamTrack {
    return this.dest.stream.getAudioTracks()[0];
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.setMic(null);
    this.clearSystem();
    this.dest.stream.getTracks().forEach((t) => t.stop());
    void this.ctx.close().catch(() => {});
  }
}

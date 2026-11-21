/**
 * File/blob → 16 kHz mono Float32Array for Whisper.
 *
 * decodeAudioData resamples to its context's rate, so decoding in a 16 kHz OfflineAudioContext
 * gives 16 kHz directly (no audio device, no autoplay gesture needed). Browsers that refuse a
 * 16 kHz context decode at their default rate and use lib/audio.ts's resampler. Channels are
 * averaged to mono. Works for video files too: the browser decodes their audio track.
 */
import { WHISPER_RATE, downmix, toWhisperInput } from '../lib/audio';

export interface DecodedAudio {
  samples: Float32Array;
  duration: number;
}

type Ctor = typeof OfflineAudioContext;
const OfflineCtx = (): Ctor | undefined =>
  typeof OfflineAudioContext !== 'undefined' ? OfflineAudioContext : (globalThis as unknown as { webkitOfflineAudioContext?: Ctor }).webkitOfflineAudioContext;

function channelsOf(buf: AudioBuffer): Float32Array[] {
  const out: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) out.push(buf.getChannelData(c));
  return out;
}

export async function decodeForWhisper(blob: Blob): Promise<DecodedAudio> {
  const data = await blob.arrayBuffer();
  const Ctx = OfflineCtx();
  if (!Ctx) throw Object.assign(new Error('This browser can’t decode audio (no Web Audio API).'), { name: 'NotSupportedError' });
  let direct: OfflineAudioContext | null = null;
  try {
    direct = new Ctx(1, 1, WHISPER_RATE);
  } catch {
    direct = null;
  }
  if (direct) {
    const buf = await direct.decodeAudioData(data);
    const samples = downmix(channelsOf(buf));
    return { samples, duration: samples.length / WHISPER_RATE };
  }
  const ctx = new Ctx(1, 1, 44100);
  const buf = await ctx.decodeAudioData(data);
  const samples = toWhisperInput(channelsOf(buf), buf.sampleRate);
  return { samples, duration: samples.length / WHISPER_RATE };
}

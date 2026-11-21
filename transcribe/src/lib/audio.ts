/** Sample-level audio helpers: downmix, resample, WAV encode/decode. Pure. */

export const WHISPER_RATE = 16000;

/** Averages channels into one. A single channel is returned as a copy. */
export function downmix(channels: Float32Array[]): Float32Array {
  if (!channels.length) return new Float32Array(0);
  const len = Math.min(...channels.map((c) => c.length));
  const out = new Float32Array(len);
  if (channels.length === 1) {
    out.set(channels[0].subarray(0, len));
    return out;
  }
  const k = 1 / channels.length;
  for (const ch of channels) for (let i = 0; i < len; i++) out[i] += ch[i] * k;
  return out;
}

// Blackman-windowed sinc, tabulated: TABLE_RES points per input sample over ZEROS zero crossings.
const ZEROS = 16;
const TABLE_RES = 256;
let table: Float32Array | null = null;
function kernelTable(): Float32Array {
  if (table) return table;
  const n = ZEROS * TABLE_RES + 2;
  table = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / TABLE_RES;
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const t = Math.min(1, x / ZEROS); // 0 at centre, 1 at the edge
    const win = 0.42 + 0.5 * Math.cos(Math.PI * t) + 0.08 * Math.cos(2 * Math.PI * t);
    table[i] = sinc * win;
  }
  return table;
}

function kernelAt(x: number): number {
  const t = kernelTable();
  const p = Math.abs(x) * TABLE_RES;
  const i = Math.floor(p);
  if (i >= t.length - 1) return 0;
  const f = p - i;
  return t[i] + (t[i + 1] - t[i]) * f;
}

/**
 * Band-limited resampling (windowed sinc). When downsampling, the kernel is stretched so it
 * also low-passes below the new Nyquist frequency and high frequencies don't alias. Weights
 * are normalised per output sample, so DC is kept exactly and edges don't dip.
 */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (!(from > 0) || !(to > 0)) throw new Error('Sample rates must be positive.');
  if (from === to) return input.slice();
  const outLen = Math.round((input.length * to) / from);
  const out = new Float32Array(outLen);
  const ratio = from / to; // input samples per output sample
  const fc = Math.min(1, to / from); // cutoff relative to the input Nyquist
  const half = ZEROS / fc; // kernel half-width in input samples
  for (let i = 0; i < outLen; i++) {
    const centre = i * ratio;
    const lo = Math.max(0, Math.ceil(centre - half));
    const hi = Math.min(input.length - 1, Math.floor(centre + half));
    let acc = 0;
    let wsum = 0;
    for (let j = lo; j <= hi; j++) {
      const w = kernelAt((j - centre) * fc);
      acc += input[j] * w;
      wsum += w;
    }
    out[i] = wsum ? acc / wsum : 0;
  }
  return out;
}

/** Downmix then resample to 16 kHz, the rate Whisper expects. */
export function toWhisperInput(channels: Float32Array[], sampleRate: number): Float32Array {
  const mono = downmix(channels);
  return sampleRate === WHISPER_RATE ? mono : resample(mono, sampleRate, WHISPER_RATE);
}

/** 16-bit PCM mono WAV. Samples are clamped to [-1, 1]. */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0, o = 44; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
  }
  return buf;
}

/** Minimal decoder for 16-bit PCM WAV (what encodeWav writes). Returns channel 0. */
export function decodeWav16(buf: ArrayBuffer): { sampleRate: number; samples: Float32Array } {
  const v = new DataView(buf);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file.');
  let o = 12;
  let rate = 0;
  let channels = 1;
  while (o + 8 <= buf.byteLength) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    if (id === 'fmt ') {
      if (v.getUint16(o + 8, true) !== 1 || v.getUint16(o + 22, true) !== 16) throw new Error('Only 16-bit PCM WAV is supported.');
      channels = v.getUint16(o + 10, true);
      rate = v.getUint32(o + 12, true);
    } else if (id === 'data') {
      const frames = Math.floor(size / 2 / channels);
      const out = new Float32Array(frames);
      for (let i = 0; i < frames; i++) out[i] = v.getInt16(o + 8 + i * channels * 2, true) / 0x8000;
      return { sampleRate: rate, samples: out };
    }
    o += 8 + size + (size % 2);
  }
  throw new Error('WAV file has no audio data.');
}

/** Maps RMS to 0..1 on a dB scale (floor −60 dBFS) for a level meter. */
export function meterLevel(rmsValue: number, floorDb = -60): number {
  if (!(rmsValue > 0)) return 0;
  const db = 20 * Math.log10(rmsValue);
  return Math.min(1, Math.max(0, (db - floorDb) / -floorDb));
}

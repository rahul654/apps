import { describe, expect, it } from 'vitest';
import { decodeWav16, downmix, encodeWav, meterLevel, resample, toWhisperInput } from './audio';

const sine = (freq: number, rate: number, seconds: number, amp = 0.5) => Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / rate));

/** Amplitude of the tone at `freq` (single-bin DFT over the middle of the signal, away from edges). */
function toneAmplitude(x: Float32Array, rate: number, freq: number): number {
  const from = Math.floor(x.length * 0.25);
  const to = Math.floor(x.length * 0.75);
  let re = 0;
  let im = 0;
  for (let i = from; i < to; i++) {
    re += x[i] * Math.cos((2 * Math.PI * freq * i) / rate);
    im += x[i] * Math.sin((2 * Math.PI * freq * i) / rate);
  }
  return (2 * Math.hypot(re, im)) / (to - from);
}

describe('downmix', () => {
  it('averages channels and copies mono', () => {
    const l = Float32Array.from([1, 0.5, -1]);
    const r = Float32Array.from([0, 0.5, 1]);
    expect([...downmix([l, r])]).toEqual([0.5, 0.5, 0]);
    const m = downmix([l]);
    expect([...m]).toEqual([...l]);
    expect(m).not.toBe(l);
    expect(downmix([])).toHaveLength(0);
  });
  it('uses the shortest channel length', () => {
    expect(downmix([new Float32Array(5), new Float32Array(3)])).toHaveLength(3);
  });
});

describe('resample', () => {
  it('produces the right length', () => {
    expect(resample(new Float32Array(48000), 48000, 16000)).toHaveLength(16000);
    expect(resample(new Float32Array(44100), 44100, 16000)).toHaveLength(16000);
    expect(resample(new Float32Array(22050), 22050, 16000)).toHaveLength(16000);
    expect(resample(new Float32Array(8000), 8000, 16000)).toHaveLength(16000);
    expect(resample(new Float32Array(0), 48000, 16000)).toHaveLength(0);
  });

  it('keeps DC exactly, including at the edges', () => {
    const out = resample(new Float32Array(4410).fill(0.25), 44100, 16000);
    for (const v of out) expect(v).toBeCloseTo(0.25, 6);
  });

  it('keeps an in-band tone and its amplitude (48 k → 16 k and 44.1 k → 16 k)', () => {
    for (const rate of [48000, 44100]) {
      const out = resample(sine(1000, rate, 0.5), rate, 16000);
      expect(toneAmplitude(out, 16000, 1000)).toBeCloseTo(0.5, 2);
    }
  });

  it('removes tones above the new Nyquist instead of aliasing them', () => {
    // 11 kHz at 48 kHz would alias to 5 kHz at 16 kHz without a low-pass.
    const out = resample(sine(11000, 48000, 0.5), 48000, 16000);
    expect(toneAmplitude(out, 16000, 5000)).toBeLessThan(0.005);
    let peak = 0;
    for (let i = 1000; i < out.length - 1000; i++) peak = Math.max(peak, Math.abs(out[i]));
    expect(peak).toBeLessThan(0.01);
  });

  it('upsamples a tone', () => {
    const out = resample(sine(440, 8000, 0.5), 8000, 16000);
    expect(toneAmplitude(out, 16000, 440)).toBeCloseTo(0.5, 2);
  });

  it('same rate is a copy; bad rates throw', () => {
    const x = Float32Array.from([1, 2, 3]);
    const y = resample(x, 16000, 16000);
    expect([...y]).toEqual([1, 2, 3]);
    expect(y).not.toBe(x);
    expect(() => resample(x, 0, 16000)).toThrow();
  });

  it('toWhisperInput downmixes then resamples to 16 kHz', () => {
    const l = sine(500, 48000, 1);
    const r = sine(500, 48000, 1);
    const out = toWhisperInput([l, r], 48000);
    expect(out).toHaveLength(16000);
    expect(toneAmplitude(out, 16000, 500)).toBeCloseTo(0.5, 2);
    expect(toWhisperInput([new Float32Array(10)], 16000)).toHaveLength(10);
  });
});

describe('WAV', () => {
  it('writes a valid 16-bit mono header and round-trips samples', () => {
    const x = Float32Array.from([0, 0.5, -0.5, 1, -1, 2, -2]);
    const buf = encodeWav(x, 16000);
    expect(buf.byteLength).toBe(44 + x.length * 2);
    const v = new DataView(buf);
    expect(String.fromCharCode(...new Uint8Array(buf, 0, 4))).toBe('RIFF');
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint16(34, true)).toBe(16);
    const back = decodeWav16(buf);
    expect(back.sampleRate).toBe(16000);
    expect(back.samples[1]).toBeCloseTo(0.5, 3);
    expect(back.samples[3]).toBeCloseTo(1, 3);
    expect(back.samples[5]).toBeCloseTo(1, 3); // clamped
    expect(back.samples[6]).toBe(-1);
  });
  it('rejects non-WAV data', () => {
    expect(() => decodeWav16(new ArrayBuffer(64))).toThrow();
  });
});

describe('meter', () => {
  it('maps RMS to 0..1 on a dB scale', () => {
    expect(meterLevel(0)).toBe(0);
    expect(meterLevel(1)).toBe(1);
    expect(meterLevel(0.001)).toBeCloseTo(0, 6);
    expect(meterLevel(0.0316)).toBeCloseTo(0.5, 2);
  });
});

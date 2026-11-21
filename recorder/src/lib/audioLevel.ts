/** Mic level meter maths. Pure. */

/** RMS of time-domain samples (-1..1). */
export function rms(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/** Maps RMS to 0..1 on a dB scale (floor −60 dBFS), which matches how loud things sound. */
export function meterLevel(rmsValue: number, floorDb = -60): number {
  if (!(rmsValue > 0)) return 0;
  const db = 20 * Math.log10(rmsValue);
  return Math.min(1, Math.max(0, (db - floorDb) / -floorDb));
}

/** Fast attack, slow release, so the meter doesn't flicker. */
export function smoothLevel(prev: number, next: number, attack = 0.6, release = 0.12): number {
  const k = next > prev ? attack : release;
  return prev + (next - prev) * k;
}

/** Trim range validation (seconds). Pure. */

export const MIN_CLIP_SECONDS = 0.5;

export type TrimCheck = { ok: true; start: number; end: number; length: number } | { ok: false; error: string };

/** Rounds to milliseconds and checks the range against the clip duration. */
export function validateTrim(start: number, end: number, duration: number, minLength = MIN_CLIP_SECONDS): TrimCheck {
  if (!Number.isFinite(duration) || duration <= 0) return { ok: false, error: 'The recording length is unknown, so it can’t be trimmed yet.' };
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { ok: false, error: 'Start and end must be numbers.' };
  const r = (v: number) => Math.round(v * 1000) / 1000;
  const s = r(Math.max(0, start));
  const e = r(Math.min(duration, end));
  if (s >= e) return { ok: false, error: 'The end must be after the start.' };
  if (e - s < minLength - 1e-9) return { ok: false, error: `The trimmed clip must be at least ${minLength} s long.` };
  if (s <= 0.001 && e >= r(duration) - 0.001) return { ok: false, error: 'Move the start or end handle to choose a shorter clip.' };
  return { ok: true, start: s, end: e, length: r(e - s) };
}

/**
 * Moves one handle, keeping it inside [0, duration] and at least `minLength` from the other.
 */
export function moveHandle(which: 'start' | 'end', value: number, range: { start: number; end: number }, duration: number, minLength = MIN_CLIP_SECONDS): { start: number; end: number } {
  const v = Math.min(Math.max(0, value), duration);
  if (which === 'start') return { start: Math.max(0, Math.min(v, range.end - minLength)), end: range.end };
  return { start: range.start, end: Math.min(duration, Math.max(v, range.start + minLength)) };
}

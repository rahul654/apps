/** Transcript export formats. Pure. */
import type { Segment, Transcript } from '../types';
import { formatClock, srtTime, vttTime } from './time';

export type ExportFormat = 'txt' | 'srt' | 'vtt' | 'json';

export const EXPORT_MIME: Record<ExportFormat, string> = {
  txt: 'text/plain;charset=utf-8',
  srt: 'application/x-subrip;charset=utf-8',
  vtt: 'text/vtt;charset=utf-8',
  json: 'application/json;charset=utf-8',
};

/** Collapses whitespace runs and trims; cue text must not contain blank lines (they end a cue). */
export function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Segments with text, in time order, with end ≥ start. Empty segments are dropped. */
export function exportableSegments(segments: Segment[]): Segment[] {
  return segments
    .map((s) => ({ ...s, text: cleanText(s.text), end: Math.max(s.start, s.end) }))
    .filter((s) => s.text.length > 0)
    .sort((a, b) => a.start - b.start);
}

export function toTxt(segments: Segment[], opts: { timestamps?: boolean } = {}): string {
  const segs = exportableSegments(segments);
  if (!opts.timestamps) return segs.map((s) => s.text).join('\n') + (segs.length ? '\n' : '');
  return segs.map((s) => `[${formatClock(s.start)}] ${s.text}`).join('\n') + (segs.length ? '\n' : '');
}

/** SubRip: numbered cues, `HH:MM:SS,mmm --> HH:MM:SS,mmm`, blank line between cues. */
export function toSrt(segments: Segment[]): string {
  return exportableSegments(segments)
    .map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text}\n`)
    .join('\n');
}

/** WebVTT: `WEBVTT` header, `HH:MM:SS.mmm --> HH:MM:SS.mmm`. `-->` inside text is escaped. */
export function toVtt(segments: Segment[]): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const cues = exportableSegments(segments).map((s) => `${vttTime(s.start)} --> ${vttTime(s.end)}\n${esc(s.text)}\n`);
  return `WEBVTT\n\n${cues.join('\n')}`;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** JSON with the transcript metadata and segments (times rounded to ms). */
export function toJson(t: Transcript): string {
  const { segments, ...meta } = t;
  const out = {
    ...meta,
    app: 'transcribe',
    text: exportableSegments(segments).map((s) => s.text).join(' '),
    segments: segments.map((s) => ({
      id: s.id,
      start: round3(s.start),
      end: round3(s.end),
      text: cleanText(s.text),
      ...(s.words ? { words: s.words.map((w) => ({ text: w.text, start: round3(w.start), end: round3(w.end) })) } : {}),
    })),
  };
  return JSON.stringify(out, null, 2) + '\n';
}

export function exportTranscript(t: Transcript, format: ExportFormat, opts: { timestamps?: boolean } = {}): string {
  switch (format) {
    case 'txt':
      return toTxt(t.segments, opts);
    case 'srt':
      return toSrt(t.segments);
    case 'vtt':
      return toVtt(t.segments);
    case 'json':
      return toJson(t);
  }
}

/** Safe download name: keeps letters/digits from any script, collapses the rest to `-`. */
export function exportFileName(title: string, format: ExportFormat): string {
  const base = title
    .normalize('NFKC')
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${base || 'transcript'}.${format}`;
}

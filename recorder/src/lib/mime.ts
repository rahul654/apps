/**
 * Container / codec selection for MediaRecorder, by feature detection.
 *
 * Pure: the caller passes `MediaRecorder.isTypeSupported` (or a stub in tests).
 *
 * Order of preference
 *   video:  MP4 (H.264 + AAC)  →  WebM (VP9 + Opus)  →  WebM (VP8 + Opus)  →  plain WebM / MP4
 *   audio:  WebM (Opus)  →  Ogg (Opus)  →  MP4 (AAC)
 * `prefer: 'webm'` / `'mp4'` moves that container to the front when the browser supports it.
 */

export type Container = 'mp4' | 'webm' | 'ogg';
export type ContainerPref = 'auto' | 'mp4' | 'webm';
export type Quality = 'low' | 'medium' | 'high';

export interface FormatChoice {
  mimeType: string;
  container: Container;
  /** File extension without the dot. */
  ext: 'mp4' | 'm4a' | 'webm' | 'ogg';
  videoCodec: string | null;
  audioCodec: string | null;
  /** Human label, e.g. "MP4 (H.264 + AAC)". */
  label: string;
}

interface Candidate {
  mime: string;
  container: Container;
  video: string | null;
  audio: string | null;
}

const MP4_AV: Candidate[] = [
  { mime: 'video/mp4;codecs="avc1.640028,mp4a.40.2"', container: 'mp4', video: 'H.264', audio: 'AAC' },
  { mime: 'video/mp4;codecs="avc1.4d0028,mp4a.40.2"', container: 'mp4', video: 'H.264', audio: 'AAC' },
  { mime: 'video/mp4;codecs="avc1.42e01f,mp4a.40.2"', container: 'mp4', video: 'H.264', audio: 'AAC' },
  { mime: 'video/mp4;codecs=avc1,mp4a.40.2', container: 'mp4', video: 'H.264', audio: 'AAC' },
];
const WEBM_AV: Candidate[] = [
  { mime: 'video/webm;codecs=vp9,opus', container: 'webm', video: 'VP9', audio: 'Opus' },
  { mime: 'video/webm;codecs=vp8,opus', container: 'webm', video: 'VP8', audio: 'Opus' },
];
const MP4_V: Candidate[] = [
  { mime: 'video/mp4;codecs="avc1.640028"', container: 'mp4', video: 'H.264', audio: null },
  { mime: 'video/mp4;codecs="avc1.4d0028"', container: 'mp4', video: 'H.264', audio: null },
  { mime: 'video/mp4;codecs="avc1.42e01f"', container: 'mp4', video: 'H.264', audio: null },
  { mime: 'video/mp4;codecs=avc1', container: 'mp4', video: 'H.264', audio: null },
];
const WEBM_V: Candidate[] = [
  { mime: 'video/webm;codecs=vp9', container: 'webm', video: 'VP9', audio: null },
  { mime: 'video/webm;codecs=vp8', container: 'webm', video: 'VP8', audio: null },
];
/** Last resorts: let the browser pick codecs inside the container. */
const GENERIC_VIDEO: Candidate[] = [
  { mime: 'video/webm', container: 'webm', video: null, audio: null },
  { mime: 'video/mp4', container: 'mp4', video: null, audio: null },
];
const AUDIO_OPUS: Candidate[] = [
  { mime: 'audio/webm;codecs=opus', container: 'webm', video: null, audio: 'Opus' },
  { mime: 'audio/ogg;codecs=opus', container: 'ogg', video: null, audio: 'Opus' },
];
const AUDIO_AAC: Candidate[] = [
  { mime: 'audio/mp4;codecs=mp4a.40.2', container: 'mp4', video: null, audio: 'AAC' },
  { mime: 'audio/mp4', container: 'mp4', video: null, audio: null },
];
const GENERIC_AUDIO: Candidate[] = [{ mime: 'audio/webm', container: 'webm', video: null, audio: null }];

export function candidateList(video: boolean, audio: boolean, prefer: ContainerPref = 'auto'): Candidate[] {
  if (!video) {
    const list = prefer === 'mp4' ? [...AUDIO_AAC, ...AUDIO_OPUS] : [...AUDIO_OPUS, ...AUDIO_AAC];
    return [...list, ...GENERIC_AUDIO];
  }
  const mp4 = audio ? MP4_AV : MP4_V;
  const webm = audio ? WEBM_AV : WEBM_V;
  const list = prefer === 'webm' ? [...webm, ...mp4] : [...mp4, ...webm];
  return [...list, ...GENERIC_VIDEO];
}

function extFor(c: Candidate, video: boolean): FormatChoice['ext'] {
  if (c.container === 'mp4') return video ? 'mp4' : 'm4a';
  return c.container;
}

export function labelFor(container: Container, video: string | null, audio: string | null): string {
  const name = container === 'mp4' ? 'MP4' : container === 'ogg' ? 'Ogg' : 'WebM';
  const codecs = [video, audio].filter(Boolean).join(' + ');
  return codecs ? `${name} (${codecs})` : name;
}

export function pickFormat(opts: {
  video: boolean;
  audio: boolean;
  prefer?: ContainerPref;
  isTypeSupported: (type: string) => boolean;
}): FormatChoice | null {
  for (const c of candidateList(opts.video, opts.audio, opts.prefer)) {
    let ok = false;
    try {
      ok = opts.isTypeSupported(c.mime);
    } catch {
      ok = false;
    }
    if (ok) {
      return {
        mimeType: c.mime,
        container: c.container,
        ext: extFor(c, opts.video),
        videoCodec: c.video,
        audioCodec: c.audio,
        label: labelFor(c.container, c.video, c.audio),
      };
    }
  }
  return null;
}

/** Which container preferences are actually available (for the settings select). */
export function availableContainers(video: boolean, isTypeSupported: (t: string) => boolean): Array<'mp4' | 'webm'> {
  const out: Array<'mp4' | 'webm'> = [];
  for (const kind of ['mp4', 'webm'] as const) {
    const choice = pickFormat({ video, audio: true, prefer: kind, isTypeSupported });
    if (choice && choice.container === kind) out.push(kind);
  }
  return out;
}

/** Container, extension and label from a stored MIME type (MediaRecorder may report e.g. "video/x-matroska"). */
export function describeMime(mime: string): { container: Container | 'mkv' | 'unknown'; ext: string; label: string; isVideo: boolean } {
  const m = mime.toLowerCase();
  const isVideo = m.startsWith('video/');
  const codecs = /codecs="?([^";]+)/.exec(m)?.[1] ?? '';
  const vName = /avc1|h264/.test(codecs) ? 'H.264' : /vp09|vp9/.test(codecs) ? 'VP9' : /vp8/.test(codecs) ? 'VP8' : /av01/.test(codecs) ? 'AV1' : null;
  const aName = /mp4a|aac/.test(codecs) ? 'AAC' : /opus/.test(codecs) ? 'Opus' : null;
  if (m.includes('mp4')) return { container: 'mp4', ext: isVideo ? 'mp4' : 'm4a', label: labelFor('mp4', vName, aName), isVideo };
  if (m.includes('webm')) return { container: 'webm', ext: 'webm', label: labelFor('webm', vName, aName), isVideo };
  if (m.includes('ogg')) return { container: 'ogg', ext: 'ogg', label: labelFor('ogg', null, aName), isVideo: false };
  if (m.includes('matroska')) return { container: 'mkv', ext: 'mkv', label: 'Matroska', isVideo };
  return { container: 'unknown', ext: isVideo ? 'webm' : 'bin', label: mime || 'Unknown', isVideo };
}

const BITS_PER_PIXEL: Record<Quality, number> = { low: 0.04, medium: 0.08, high: 0.15 };

/** videoBitsPerSecond for a quality preset, scaled to resolution and frame rate (rounded to 100 kbps). */
export function videoBitrate(width: number, height: number, fps: number, quality: Quality): number {
  // Frame rate above 30 costs less than linearly (more temporal redundancy).
  const effFps = fps <= 30 ? fps : 30 + (fps - 30) * 0.5;
  const raw = width * height * effFps * BITS_PER_PIXEL[quality];
  const clamped = Math.min(40_000_000, Math.max(500_000, raw));
  return Math.round(clamped / 100_000) * 100_000;
}

export function audioBitrate(quality: Quality): number {
  return quality === 'low' ? 64_000 : quality === 'medium' ? 128_000 : 192_000;
}

/**
 * Trim fallback for browsers without WebCodecs: plays the selected segment and re-records it
 * in real time (canvas.captureStream for video, Web Audio for sound) with MediaRecorder.
 * Takes as long as the clip. Re-encodes, so quality drops slightly.
 */
import { pickFormat } from '../lib/mime';
import { patchWebmDuration, isWebm } from '../lib/webmDuration';
import { isTypeSupported } from './features';
import { every } from './ticker';

export async function realtimeTrim(
  blob: Blob,
  range: { start: number; end: number },
  opts: { onProgress?: (p: number) => void; signal?: AbortSignal; fps?: number } = {},
): Promise<{ blob: Blob; mimeType: string; duration: number }> {
  const isVideo = blob.type.startsWith('video/');
  const url = URL.createObjectURL(blob);
  const media = document.createElement(isVideo ? 'video' : 'audio');
  media.src = url;
  media.preload = 'auto';
  if (media instanceof HTMLVideoElement) media.playsInline = true;
  // Kept in the DOM off-screen: some browsers pause detached / invisible media.
  media.style.cssText = 'position:fixed;left:-10000px;top:0;width:4px;height:4px;opacity:0;pointer-events:none';
  media.setAttribute('aria-hidden', 'true');
  document.body.appendChild(media);

  const ac = new AudioContext();
  const cleanups: Array<() => void> = [
    () => {
      media.pause();
      media.removeAttribute('src');
      media.load();
      media.remove();
      URL.revokeObjectURL(url);
      void ac.close().catch(() => {});
    },
  ];
  const cleanup = () => cleanups.splice(0).reverse().forEach((f) => f());

  try {
    await new Promise<void>((resolve, reject) => {
      media.addEventListener('loadedmetadata', () => resolve(), { once: true });
      media.addEventListener('error', () => reject(new Error('This file can’t be played in this browser.')), { once: true });
    });

    const tracks: MediaStreamTrack[] = [];
    // Audio: element → Web Audio → stream (not to the speakers).
    const src = ac.createMediaElementSource(media);
    const dest = ac.createMediaStreamDestination();
    src.connect(dest);
    tracks.push(...dest.stream.getAudioTracks());

    let stopDraw: (() => void) | null = null;
    if (media instanceof HTMLVideoElement) {
      const canvas = document.createElement('canvas');
      canvas.width = media.videoWidth || 1280;
      canvas.height = media.videoHeight || 720;
      const ctx = canvas.getContext('2d', { alpha: false })!;
      const fps = opts.fps ?? 30;
      const stream = canvas.captureStream(fps);
      tracks.push(...stream.getVideoTracks());
      stopDraw = every(1000 / fps, () => ctx.drawImage(media, 0, 0, canvas.width, canvas.height));
      cleanups.push(() => {
        stopDraw?.();
        stream.getTracks().forEach((t) => t.stop());
      });
    }

    const format = pickFormat({ video: isVideo, audio: true, isTypeSupported });
    const rec = new MediaRecorder(new MediaStream(tracks), format ? { mimeType: format.mimeType } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

    media.currentTime = range.start;
    await new Promise((r) => media.addEventListener('seeked', r, { once: true }));
    await ac.resume().catch(() => {});

    const length = range.end - range.start;
    const t0 = performance.now();
    const done = new Promise<void>((resolve, reject) => {
      const stopTick = every(100, () => {
        const pos = media.currentTime - range.start;
        opts.onProgress?.(Math.min(1, Math.max(0, pos / length)));
        if (media.currentTime >= range.end || media.ended) finish();
      });
      const onAbort = () => {
        stopTick();
        reject(new DOMException('Cancelled', 'AbortError'));
      };
      const finish = () => {
        stopTick();
        opts.signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      cleanups.push(stopTick);
    });
    rec.start(1000);
    await media.play();
    try {
      await done;
    } finally {
      media.pause();
      await new Promise<void>((r) => {
        rec.addEventListener('stop', () => r(), { once: true });
        if (rec.state !== 'inactive') rec.stop();
        else r();
      });
    }
    const durationMs = Math.min(length * 1000, performance.now() - t0);
    const mimeType = rec.mimeType || format?.mimeType || blob.type;
    let out = new Blob(chunks, { type: mimeType });
    if (isWebm(mimeType)) out = (await patchWebmDuration(out, durationMs)) ?? out;
    return { blob: out, mimeType, duration: durationMs / 1000 };
  } finally {
    cleanup();
  }
}

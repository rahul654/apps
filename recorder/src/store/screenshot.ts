/**
 * Screenshot capture state (outside React, so a capture survives navigation and the keyboard
 * shortcut can start one from anywhere). Pages read it with `useShot()`.
 */
import { useSyncExternalStore } from 'react';
import { mediaErrorInfo } from '../lib/errors';
import { defaultTitle } from '../lib/format';
import type { RecError } from '../lib/recorderMachine';
import { screenshotStore, type ScreenshotMeta, type ShotSource } from '../lib/screenshotStore';
import { loadImage, renderThumbnail } from '../media/annotateRender';
import { stopStream } from '../media/capture';
import { canvasToPng, countdown, frameSource, grabFromTrack, pickDisplay, type CapturedImage } from '../media/screenshot';
import { notifyLibraryChanged } from './library';

export type ShotPhase = 'idle' | 'picking' | 'countdown' | 'grabbing';

export interface ShotState {
  phase: ShotPhase;
  secondsLeft: number;
  error: RecError | null;
  /** The last screenshot taken in this tab (for the "Saved" notice). */
  last: { id: string; title: string } | null;
}

let state: ShotState = { phase: 'idle', secondsLeft: 0, error: null, last: null };
const listeners = new Set<() => void>();
let abort: AbortController | null = null;
let skip: (() => void) | null = null;
let baseTitle: string | null = null;

function set(patch: Partial<ShotState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getState = () => state;

export function useShot(): ShotState {
  return useSyncExternalStore(subscribe, getState, getState);
}

export const shotBusy = () => state.phase !== 'idle';

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** Stores a captured or pasted image and makes its thumbnail. */
export async function saveScreenshot(img: CapturedImage, source: ShotSource): Promise<ScreenshotMeta> {
  const now = Date.now();
  const meta = await screenshotStore().create(
    { id: newId(), title: defaultTitle(new Date(now), 'Screenshot'), createdAt: now, width: img.width, height: img.height, source },
    img.blob,
  );
  notifyLibraryChanged();
  set({ last: { id: meta.id, title: meta.title } });
  void (async () => {
    const loaded = await loadImage(img.blob);
    try {
      await screenshotStore().setThumbnail(meta.id, await renderThumbnail(loaded, meta.scene));
      notifyLibraryChanged();
    } finally {
      loaded.close();
    }
  })().catch(() => {});
  return meta;
}

/** Tab title shows the countdown, since you're usually looking at another window. */
function showTitle(secondsLeft: number | null) {
  if (typeof document === 'undefined') return;
  if (secondsLeft === null) {
    if (baseTitle !== null) document.title = baseTitle;
    baseTitle = null;
    return;
  }
  baseTitle ??= document.title;
  document.title = `📸 ${secondsLeft}… · Screenshot`;
}

async function wait(delaySec: number, signal: AbortSignal) {
  if (delaySec <= 0) return;
  set({ phase: 'countdown', secondsLeft: delaySec });
  const skipped = new Promise<void>((resolve) => (skip = resolve));
  try {
    await Promise.race([
      countdown(delaySec * 1000, (s) => {
        set({ secondsLeft: s });
        showTitle(s);
      }, signal),
      skipped,
    ]);
  } finally {
    skip = null;
    showTitle(null);
  }
}

export interface TakeOptions {
  delaySec: number;
  /** The screen being recorded: grab from it instead of opening the picker. */
  recordingTrack?: MediaStreamTrack | null;
}

/**
 * Takes a screenshot and saves it. Resolves with the new screenshot, or null when cancelled
 * or failed (the error is in the state). Must be called straight from a user gesture.
 */
export async function takeScreenshot({ delaySec, recordingTrack }: TakeOptions): Promise<ScreenshotMeta | null> {
  if (shotBusy()) return null;
  const ac = new AbortController();
  abort = ac;
  set({ error: null, last: null });
  let stream: MediaStream | null = null;
  try {
    let img: CapturedImage;
    if (recordingTrack && recordingTrack.readyState === 'live') {
      await wait(delaySec, ac.signal);
      set({ phase: 'grabbing' });
      img = await grabFromTrack(recordingTrack);
    } else {
      set({ phase: 'picking' });
      try {
        stream = await pickDisplay(delaySec > 0);
      } catch (e) {
        if (ac.signal.aborted) return null;
        set({ error: mediaErrorInfo(e, 'screen') });
        return null;
      }
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error('The shared source has no video.');
      const ended = new Promise<never>((_, reject) =>
        track.addEventListener('ended', () => reject(new Error('Screen sharing stopped before the screenshot was taken.')), { once: true }),
      );
      // Start reading frames now, so the newest one is at hand when the countdown ends.
      const src = frameSource(track);
      try {
        await Promise.race([wait(delaySec, ac.signal), ended]);
        set({ phase: 'grabbing' });
        img = await canvasToPng(await Promise.race([src.grab(performance.now() - 50, delaySec > 0 ? 1000 : 2500), ended]));
      } finally {
        src.stop();
      }
    }
    stopStream(stream);
    stream = null;
    if (ac.signal.aborted) return null;
    return await saveScreenshot(img, recordingTrack ? 'recording' : 'display');
  } catch (e) {
    if ((e as { name?: string })?.name !== 'AbortError' && !ac.signal.aborted) {
      set({ error: { title: 'Couldn’t take the screenshot', message: (e as Error)?.message ?? String(e), canRetry: true } });
    }
    return null;
  } finally {
    stopStream(stream);
    if (abort === ac) abort = null;
    set({ phase: 'idle', secondsLeft: 0 });
  }
}

/** Ends the countdown early and captures now. */
export function captureNow() {
  skip?.();
}

export function cancelScreenshot() {
  abort?.abort();
}

export function dismissShotError() {
  set({ error: null });
}

export function reportShotError(title: string, e: unknown) {
  set({ error: { title, message: (e as Error)?.message ?? String(e), canRetry: false } });
}

export function dismissLastShot() {
  set({ last: null });
}

/** Saves a pasted / opened image as a screenshot to annotate. */
export async function importImage(file: Blob): Promise<ScreenshotMeta> {
  if (!/^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type)) throw new Error('That isn’t an image this app can open (PNG, JPEG, WebP, GIF or BMP).');
  const loaded = await loadImage(file);
  try {
    const blob = file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'image/webp' ? file : await toPng(loaded.source, loaded.width, loaded.height);
    return await saveScreenshot({ blob, width: loaded.width, height: loaded.height }, 'paste');
  } finally {
    loaded.close();
  }
}

async function toPng(src: CanvasImageSource, w: number, h: number): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.drawImage(src, 0, 0);
  return (await canvasToPng(c)).blob;
}

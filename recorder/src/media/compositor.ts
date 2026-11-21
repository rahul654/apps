/**
 * Screen + camera compositor with a fallback chain. Each path must keep producing frames
 * while the recorder tab is hidden (the user is recording other windows):
 *
 *  1. "worker-breakout" (Chrome / Edge / Opera):
 *     main-thread MediaStreamTrackProcessor → transferred ReadableStream → worker draws on an
 *     OffscreenCanvas → VideoFrame → transferred WritableStream → MediaStreamTrackGenerator.
 *     No main-thread rendering at all; rAF / timer throttling doesn't apply.
 *  2. "worker-spec" (browsers that expose the standard worker-only API, e.g. Safari 18+):
 *     MediaStreamTracks are transferred to the worker, which creates MediaStreamTrackProcessor
 *     and VideoTrackGenerator itself and transfers the output track back.
 *  3. "main-canvas" (Firefox, older Safari, anything else):
 *     <video> elements + a main-thread 2D canvas, redrawn from a worker timer (not throttled
 *     like main-thread timers / rAF), recorded through canvas.captureStream().
 *
 * Paths 1 and 2 must deliver their first frame within a few seconds, or the next path is tried.
 */
import type { BubbleLayout } from '../lib/geometry';
import { drawComposite } from './draw';
import { hasBreakoutBox } from './features';
import { every } from './ticker';

export type CompositorPath = 'worker-breakout' | 'worker-spec' | 'main-canvas';

export const PATH_LABEL: Record<CompositorPath, string> = {
  'worker-breakout': 'Worker (Insertable Streams): keeps full frame rate in background tabs',
  'worker-spec': 'Worker (VideoTrackGenerator): keeps full frame rate in background tabs',
  'main-canvas': 'Canvas with worker timer: background tabs may drop frames in some browsers',
};

export interface Compositor {
  readonly track: MediaStreamTrack;
  readonly path: CompositorPath;
  readonly width: number;
  readonly height: number;
  setLayout(layout: BubbleLayout | null): void;
  stop(): void;
}

export interface CompositorOptions {
  screen: MediaStreamTrack;
  camera: MediaStreamTrack | null;
  width: number;
  height: number;
  fps: number;
  layout: BubbleLayout | null;
  /** Force a path (debug: `?compositor=main-canvas`). */
  force?: CompositorPath;
  onError?: (message: string) => void;
}

const READY_TIMEOUT_MS = 4000;

function newWorker(): Worker {
  return new Worker(new URL('../workers/compositor.worker.ts', import.meta.url), { type: 'module', name: 'recorder-compositor' });
}

function waitFor<T>(worker: Worker, pick: (m: { type: string; [k: string]: unknown }) => T | undefined, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      cleanup();
      reject(new Error('timed out'));
    }, timeoutMs);
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'error') {
        cleanup();
        reject(new Error(String(e.data.message)));
        return;
      }
      const v = pick(e.data);
      if (v !== undefined) {
        cleanup();
        resolve(v);
      }
    };
    const onErr = (e: ErrorEvent) => {
      cleanup();
      reject(new Error(e.message || 'worker failed to load'));
    };
    const cleanup = () => {
      clearTimeout(t);
      worker.removeEventListener('message', onMsg);
      worker.removeEventListener('error', onErr);
    };
    worker.addEventListener('message', onMsg);
    worker.addEventListener('error', onErr);
  });
}

function watchErrors(worker: Worker, onError?: (m: string) => void) {
  worker.addEventListener('message', (e) => {
    if (e.data?.type === 'error') onError?.(String(e.data.message));
  });
}

async function breakoutPath(o: CompositorOptions): Promise<Compositor> {
  const worker = newWorker();
  // Clones: the processors own these, and stopping them never affects the caller's tracks.
  const screenClone = o.screen.clone();
  const cameraClone = o.camera?.clone() ?? null;
  let gen: MediaStreamVideoTrackGenerator | null = null;
  const cleanup = () => {
    worker.postMessage({ type: 'stop' });
    setTimeout(() => worker.terminate(), 200);
    screenClone.stop();
    cameraClone?.stop();
    gen?.stop();
  };
  try {
    gen = new MediaStreamTrackGenerator({ kind: 'video' });
    const screen = new MediaStreamTrackProcessor({ track: screenClone as MediaStreamVideoTrack }).readable;
    const camera = cameraClone ? new MediaStreamTrackProcessor({ track: cameraClone as MediaStreamVideoTrack }).readable : null;
    const transfer: Transferable[] = [screen as unknown as Transferable, gen.writable as unknown as Transferable];
    if (camera) transfer.push(camera as unknown as Transferable);
    const ready = waitFor(worker, (m) => (m.type === 'ready' ? true : undefined), READY_TIMEOUT_MS);
    worker.postMessage(
      { type: 'init-breakout', screen, camera, output: gen.writable, width: o.width, height: o.height, fps: o.fps, layout: o.layout },
      transfer,
    );
    await ready;
  } catch (e) {
    cleanup();
    throw e;
  }
  watchErrors(worker, o.onError);
  return {
    track: gen!,
    path: 'worker-breakout',
    width: o.width,
    height: o.height,
    setLayout: (layout) => worker.postMessage({ type: 'layout', layout }),
    stop: cleanup,
  };
}

async function specPath(o: CompositorOptions): Promise<Compositor> {
  const worker = newWorker();
  let clones: MediaStreamTrack[] = [];
  try {
    const probe = waitFor(worker, (m) => (m.type === 'probe' ? Boolean(m.spec) : undefined), 2000).catch(() => false);
    worker.postMessage({ type: 'probe' });
    const ok = await probe;
    if (!ok) throw new Error('worker has no MediaStreamTrackProcessor / VideoTrackGenerator');
    const screenTrack = o.screen.clone();
    const cameraTrack = o.camera?.clone() ?? null;
    clones = [screenTrack, ...(cameraTrack ? [cameraTrack] : [])];
    const transfer = clones as unknown as Transferable[];
    const trackP = waitFor(worker, (m) => (m.type === 'track' ? (m.track as MediaStreamTrack) : undefined), READY_TIMEOUT_MS);
    const readyP = waitFor(worker, (m) => (m.type === 'ready' ? true : undefined), READY_TIMEOUT_MS);
    // Throws DataCloneError where MediaStreamTrack isn't transferable.
    worker.postMessage({ type: 'init-spec', screenTrack, cameraTrack, width: o.width, height: o.height, fps: o.fps, layout: o.layout }, transfer);
    const [track] = await Promise.all([trackP, readyP]);
    watchErrors(worker, o.onError);
    return {
      track,
      path: 'worker-spec',
      width: o.width,
      height: o.height,
      setLayout: (layout) => worker.postMessage({ type: 'layout', layout }),
      stop: () => {
        worker.postMessage({ type: 'stop' });
        track.stop();
        setTimeout(() => worker.terminate(), 200);
      },
    };
  } catch (e) {
    worker.terminate();
    for (const t of clones) t.stop(); // no-op if they were transferred
    throw e;
  }
}

function hiddenVideo(track: MediaStreamTrack): HTMLVideoElement {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.autoplay = true;
  v.srcObject = new MediaStream([track]);
  // Kept in the DOM (off-screen) so Safari keeps decoding.
  v.setAttribute('aria-hidden', 'true');
  v.style.cssText = 'position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
  document.body.appendChild(v);
  void v.play().catch(() => {});
  return v;
}

async function mainCanvasPath(o: CompositorOptions): Promise<Compositor> {
  const canvas = document.createElement('canvas');
  canvas.width = o.width;
  canvas.height = o.height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D is not available');
  const sv = hiddenVideo(o.screen);
  const cv = o.camera ? hiddenVideo(o.camera) : null;
  let layout = o.layout;
  const stream = canvas.captureStream(0);
  let track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  let manual = typeof track.requestFrame === 'function';
  if (!manual) {
    // Safari without requestFrame: let the canvas push frames itself.
    track.stop();
    track = canvas.captureStream(o.fps).getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
    manual = false;
  }
  const draw = () => {
    const screen = sv.videoWidth ? { image: sv, width: sv.videoWidth, height: sv.videoHeight } : null;
    const cam = cv && cv.videoWidth ? { image: cv, width: cv.videoWidth, height: cv.videoHeight } : null;
    if (!screen) return;
    drawComposite(ctx, o.width, o.height, screen, cam, layout);
    if (manual) track.requestFrame();
  };
  const stopTick = every(1000 / o.fps, draw);
  return {
    track,
    path: 'main-canvas',
    width: o.width,
    height: o.height,
    setLayout: (l) => {
      layout = l;
    },
    stop: () => {
      stopTick();
      track.stop();
      for (const v of [sv, cv]) {
        if (!v) continue;
        v.pause();
        v.srcObject = null;
        v.remove();
      }
    },
  };
}

export async function createCompositor(o: CompositorOptions): Promise<Compositor> {
  const chain: CompositorPath[] = o.force ? [o.force] : [];
  if (!o.force) {
    if (hasBreakoutBox()) chain.push('worker-breakout');
    if (typeof Worker === 'function' && typeof OffscreenCanvas === 'function') chain.push('worker-spec');
    chain.push('main-canvas');
  }
  const errors: string[] = [];
  for (const path of chain) {
    try {
      if (path === 'worker-breakout') return await breakoutPath(o);
      if (path === 'worker-spec') return await specPath(o);
      return await mainCanvasPath(o);
    } catch (e) {
      errors.push(`${path}: ${(e as Error)?.message ?? e}`);
      console.warn('[recorder] compositor path failed, trying next', path, e);
    }
  }
  throw new Error(`Couldn’t combine screen and camera (${errors.join('; ')})`);
}

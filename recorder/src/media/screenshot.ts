/**
 * Screenshot capture: one frame from a getDisplayMedia stream (or from the screen that is
 * already being recorded), encoded as PNG.
 *
 * A page can't draw over other windows, so the flow is "freeze, then annotate": grab a frame,
 * stop sharing at once, and open the frozen image in the editor.
 *
 * Frames are read with MediaStreamTrackProcessor where available (Chromium): it keeps
 * delivering in background tabs, which matters with a delay because the user is usually in
 * another window by then. Elsewhere a <video> element plays the stream and is drawn to a canvas.
 */
import { fakeScreen, isFakeMode } from './fake';

export interface CapturedImage {
  blob: Blob;
  width: number;
  height: number;
}

/**
 * Opens the screen picker. Must be called straight from a user gesture (no awaits before it).
 * `focusCaptured` = bring a shared tab / window to the front (useful with a delay, so you can
 * set up the shot there); otherwise focus stays here and the editor opens right away.
 */
export function pickDisplay(focusCaptured: boolean): Promise<MediaStream> {
  if (isFakeMode()) return Promise.resolve(fakeScreen(false, 30));
  const Ctl = (globalThis as { CaptureController?: new () => CaptureController }).CaptureController;
  const controller = Ctl ? new Ctl() : undefined;
  const options: DisplayMediaStreamOptions = {
    video: true,
    audio: false,
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'exclude',
    monitorTypeSurfaces: 'include',
    systemAudio: 'exclude',
    ...(controller ? { controller } : {}),
  };
  const p = navigator.mediaDevices.getDisplayMedia(options);
  if (controller?.setFocusBehavior) {
    // Allowed until the promise settles (and in the task it resolves in); throws for screens.
    void p.then(
      () => {
        try {
          controller.setFocusBehavior!(focusCaptured ? 'focus-captured-surface' : 'no-focus-change');
        } catch {
          /* whole screen, or too late: nothing to change */
        }
      },
      () => {},
    );
  }
  return p;
}

interface FrameSource {
  /** Draws the newest frame that arrived at or after `notBefore` (performance.now()) into a canvas. */
  grab(notBefore: number, timeoutMs: number): Promise<HTMLCanvasElement>;
  stop(): void;
}

function canvasOf(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Chromium: keeps the latest VideoFrame from the track. */
function processorSource(track: MediaStreamTrack): FrameSource | null {
  const Proc = (globalThis as unknown as { MediaStreamTrackProcessor?: typeof MediaStreamTrackProcessor }).MediaStreamTrackProcessor;
  if (typeof Proc !== 'function' || typeof VideoFrame !== 'function') return null;
  let reader: ReadableStreamDefaultReader<VideoFrame>;
  try {
    reader = new Proc({ track: track as MediaStreamVideoTrack, maxBufferSize: 1 }).readable.getReader();
  } catch {
    return null;
  }
  let latest: { frame: VideoFrame; at: number } | null = null;
  let stopped = false;
  let ended: Error | null = null;
  const waiters = new Set<() => void>();
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done || stopped) {
          value?.close();
          break;
        }
        latest?.frame.close();
        latest = { frame: value, at: performance.now() };
        waiters.forEach((w) => w());
      }
    } catch (e) {
      ended = e instanceof Error ? e : new Error(String(e));
    }
    ended ??= new Error('Screen sharing ended before a frame arrived.');
    waiters.forEach((w) => w());
  })();
  return {
    async grab(notBefore, timeoutMs) {
      const deadline = performance.now() + timeoutMs;
      // A static screen may not send new frames: after the timeout, use the newest one we have.
      while (!latest || latest.at < notBefore) {
        if (ended && !latest) throw ended;
        if (ended) break;
        const left = deadline - performance.now();
        if (left <= 0) break;
        await new Promise<void>((resolve) => {
          const t = setTimeout(done, left);
          function done() {
            clearTimeout(t);
            waiters.delete(done);
            resolve();
          }
          waiters.add(done);
        });
      }
      if (!latest) throw new Error('No picture arrived from the shared screen.');
      const f = latest.frame;
      const c = canvasOf(f.displayWidth, f.displayHeight);
      c.getContext('2d')!.drawImage(f, 0, 0, c.width, c.height);
      return c;
    },
    stop() {
      stopped = true;
      void reader.cancel().catch(() => {});
      latest?.frame.close();
      latest = null;
    },
  };
}

/** Everywhere else: a muted <video> playing the stream. */
function videoSource(track: MediaStreamTrack): FrameSource {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([track]);
  const ready = new Promise<void>((resolve, reject) => {
    if (video.readyState >= 2 && video.videoWidth) return resolve();
    const ok = () => video.videoWidth && (cleanup(), resolve());
    const bad = () => (cleanup(), reject(new Error('The shared screen couldn’t be played.')));
    const cleanup = () => {
      video.removeEventListener('loadeddata', ok);
      video.removeEventListener('resize', ok);
      video.removeEventListener('error', bad);
    };
    video.addEventListener('loadeddata', ok);
    video.addEventListener('resize', ok);
    video.addEventListener('error', bad);
  });
  void video.play().catch(() => {});
  return {
    async grab(_notBefore, timeoutMs) {
      await Promise.race([ready, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('No picture arrived from the shared screen.')), Math.max(timeoutMs, 4000)))]);
      // Wait for one fresh frame when we can tell (capped: static screens send few frames).
      if (typeof video.requestVideoFrameCallback === 'function') {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, Math.min(timeoutMs, 400));
          video.requestVideoFrameCallback(() => {
            clearTimeout(t);
            resolve();
          });
        });
      }
      const c = canvasOf(video.videoWidth, video.videoHeight);
      c.getContext('2d')!.drawImage(video, 0, 0, c.width, c.height);
      return c;
    },
    stop() {
      video.pause();
      video.srcObject = null;
    },
  };
}

export function frameSource(track: MediaStreamTrack): FrameSource {
  return processorSource(track) ?? videoSource(track);
}

export function canvasToPng(c: HTMLCanvasElement): Promise<CapturedImage> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => {
      if (!b) return reject(new Error('The browser couldn’t encode the screenshot.'));
      resolve({ blob: b, width: c.width, height: c.height });
      c.width = c.height = 0;
    }, 'image/png'),
  );
}

/** Resolves after `ms`, calling `onTick` with the whole seconds left. Rejects on abort. */
export function countdown(ms: number, onTick: (secondsLeft: number) => void, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Cancelled', 'AbortError'));
    if (ms <= 0) return resolve();
    const end = performance.now() + ms;
    let last = -1;
    const tick = () => {
      const left = end - performance.now();
      if (left <= 0) {
        clearInterval(t);
        signal.removeEventListener('abort', abort);
        return resolve();
      }
      const s = Math.ceil(left / 1000);
      if (s !== last) onTick((last = s));
    };
    const abort = () => {
      clearInterval(t);
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    const t = setInterval(tick, 100);
    signal.addEventListener('abort', abort, { once: true });
    tick();
  });
}

/** Grabs one frame from a track without stopping it (for screenshots while recording). */
export async function grabFromTrack(track: MediaStreamTrack): Promise<CapturedImage> {
  // A clone, so the recording's own track and its consumers are untouched.
  const clone = track.clone();
  const src = frameSource(clone);
  try {
    return await canvasToPng(await src.grab(0, 1500));
  } finally {
    src.stop();
    clone.stop();
  }
}

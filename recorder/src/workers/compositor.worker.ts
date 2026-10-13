/**
 * Compositor worker: screen + camera bubble → one video track, entirely off the main thread,
 * so it keeps running at full rate when the recorder tab is hidden.
 *
 * Two ways in:
 *  - "breakout": Chromium. The main thread creates MediaStreamTrackProcessor (per source) and
 *    MediaStreamTrackGenerator (output), then transfers their ReadableStream / WritableStream here.
 *  - "spec": the standard shape (Safari 18+): MediaStreamTracks are transferred here, and this
 *    worker creates MediaStreamTrackProcessor + VideoTrackGenerator and sends the track back.
 *
 * Frames are pulled as they arrive (latest wins), and an output frame is produced on a worker
 * timer at the target fps whenever a source changed, plus a 1 fps keep-alive so a static screen
 * with no camera change still yields frames.
 */
import type { BubbleLayout } from '../lib/geometry';
import { drawComposite } from '../media/draw';

type InitBase = { width: number; height: number; fps: number; layout: BubbleLayout | null };
type InMsg =
  | { type: 'probe' }
  | (InitBase & { type: 'init-breakout'; screen: ReadableStream<VideoFrame>; camera: ReadableStream<VideoFrame> | null; output: WritableStream<VideoFrame> })
  | (InitBase & { type: 'init-spec'; screenTrack: MediaStreamTrack; cameraTrack: MediaStreamTrack | null })
  | { type: 'layout'; layout: BubbleLayout | null }
  | { type: 'stop' };

const scope = self as unknown as {
  postMessage(m: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<InMsg>) => void) | null;
  MediaStreamTrackProcessor?: typeof MediaStreamTrackProcessor;
  VideoTrackGenerator?: typeof VideoTrackGenerator;
};

let stopped = false;
let layout: BubbleLayout | null = null;
let screenFrame: VideoFrame | null = null;
let cameraFrame: VideoFrame | null = null;
let dirty = false;
let writer: WritableStreamDefaultWriter<VideoFrame> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let readers: ReadableStreamDefaultReader<VideoFrame>[] = [];
let lastTimestamp = 0;
let lastOutputAt = 0;
let framesOut = 0;
let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let specTrack: MediaStreamTrack | null = null;

function fail(message: string) {
  scope.postMessage({ type: 'error', message });
}

async function pump(stream: ReadableStream<VideoFrame>, which: 'screen' | 'camera') {
  const reader = stream.getReader();
  readers.push(reader);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done || stopped) {
        value?.close();
        break;
      }
      if (which === 'screen') {
        screenFrame?.close();
        screenFrame = value;
      } else {
        cameraFrame?.close();
        cameraFrame = value;
      }
      dirty = true;
    }
  } catch (e) {
    if (!stopped) fail(`${which} stream: ${(e as Error)?.message ?? e}`);
  }
  if (which === 'screen' && !stopped) scope.postMessage({ type: 'source-ended', which });
}

function src(f: VideoFrame | null) {
  return f ? { image: f as unknown as CanvasImageSource, width: f.displayWidth, height: f.displayHeight } : null;
}

async function render() {
  if (stopped || !ctx || !canvas || !writer) return;
  const now = performance.now();
  if (!dirty && now - lastOutputAt < 1000) return;
  if (!screenFrame) return; // nothing to show yet
  if (writer.desiredSize !== null && writer.desiredSize <= 0) return; // encoder busy: drop
  dirty = false;
  lastOutputAt = now;
  drawComposite(ctx, canvas.width, canvas.height, src(screenFrame), src(cameraFrame), layout);
  // Monotonic microsecond timestamps; MediaRecorder needs them strictly increasing.
  const ts = Math.max(lastTimestamp + 1, Math.round(now * 1000));
  lastTimestamp = ts;
  let frame: VideoFrame | null = null;
  try {
    frame = new VideoFrame(canvas, { timestamp: ts });
    await writer.write(frame); // the sink takes ownership of the frame
    framesOut++;
    if (framesOut === 1) scope.postMessage({ type: 'ready' });
    if (framesOut % 60 === 0) scope.postMessage({ type: 'stats', framesOut });
  } catch (e) {
    try {
      frame?.close();
    } catch {
      /* already consumed */
    }
    if (!stopped) fail(`output: ${(e as Error)?.message ?? e}`);
  }
}

function start(base: InitBase, screen: ReadableStream<VideoFrame>, camera: ReadableStream<VideoFrame> | null, output: WritableStream<VideoFrame>) {
  layout = base.layout;
  canvas = new OffscreenCanvas(base.width, base.height);
  ctx = canvas.getContext('2d', { alpha: false, desynchronized: true }) as OffscreenCanvasRenderingContext2D | null;
  if (!ctx) {
    fail('OffscreenCanvas 2D is not available');
    return;
  }
  writer = output.getWriter();
  void pump(screen, 'screen');
  if (camera) void pump(camera, 'camera');
  const interval = 1000 / Math.max(1, base.fps);
  let busy = false;
  timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void render().finally(() => {
      busy = false;
    });
  }, interval);
}

function stop() {
  stopped = true;
  if (timer) clearInterval(timer);
  for (const r of readers) r.cancel().catch(() => {});
  readers = [];
  screenFrame?.close();
  cameraFrame?.close();
  screenFrame = cameraFrame = null;
  writer?.close().catch(() => {});
  writer = null;
  specTrack?.stop();
  specTrack = null;
}

scope.onmessage = (e) => {
  const m = e.data;
  switch (m.type) {
    case 'probe':
      scope.postMessage({
        type: 'probe',
        spec: typeof scope.MediaStreamTrackProcessor === 'function' && typeof scope.VideoTrackGenerator === 'function' && typeof OffscreenCanvas === 'function',
      });
      break;
    case 'init-breakout':
      start(m, m.screen, m.camera, m.output);
      break;
    case 'init-spec': {
      try {
        const P = scope.MediaStreamTrackProcessor!;
        const G = scope.VideoTrackGenerator!;
        const gen = new G();
        specTrack = gen.track;
        const screen = new P({ track: m.screenTrack as MediaStreamVideoTrack }).readable;
        const camera = m.cameraTrack ? new P({ track: m.cameraTrack as MediaStreamVideoTrack }).readable : null;
        start(m, screen, camera, gen.writable);
        scope.postMessage({ type: 'track', track: gen.track }, [gen.track as unknown as Transferable]);
        specTrack = null; // transferred
      } catch (err) {
        fail(`spec init: ${(err as Error)?.message ?? err}`);
      }
      break;
    }
    case 'layout':
      layout = m.layout;
      dirty = true;
      break;
    case 'stop':
      stop();
      break;
  }
};

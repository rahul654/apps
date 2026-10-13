import { decodeBitmap, processDrawable, UnsupportedOutputError, type ImageJobOptions } from './process';

export interface WorkerRequest {
  id: number;
  blob: Blob;
  opts: ImageJobOptions;
}

export type WorkerResponse =
  | { id: number; ok: true; blob: Blob; width: number; height: number; srcWidth: number; srcHeight: number; clamped: boolean }
  | { id: number; ok: false; error: string; fatal: boolean; decodeFailed: boolean };

// Typed minimally so this file compiles with the DOM lib (the WebWorker lib conflicts with it).
const scope = self as unknown as {
  postMessage(message: WorkerResponse): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
};

scope.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, blob, opts } = e.data;
  let bitmap: ImageBitmap | null = null;
  try {
    try {
      bitmap = await decodeBitmap(blob);
    } catch (err) {
      scope.postMessage({ id, ok: false, error: String((err as Error)?.message ?? err), fatal: false, decodeFailed: true } satisfies WorkerResponse);
      return;
    }
    const res = await processDrawable(bitmap, opts, (w, h) => new OffscreenCanvas(w, h));
    scope.postMessage({ id, ok: true, ...res } satisfies WorkerResponse);
  } catch (err) {
    scope.postMessage({
      id,
      ok: false,
      error: String((err as Error)?.message ?? err),
      fatal: err instanceof UnsupportedOutputError,
      decodeFailed: false,
    } satisfies WorkerResponse);
  } finally {
    bitmap?.close();
  }
};

/// <reference lib="webworker" />
/**
 * Inference worker: decodes the image, resizes it into the model's input, runs ONNX Runtime
 * (WebGPU or single-threaded WASM) and scales the mask back to the image's full size.
 * Requests are handled one at a time.
 */
import type { InferenceSession } from 'onnxruntime-web';
import { fetchModel } from '../lib/modelCache';
import { getModel, modelUrl, type Backend, type ModelId, type Precision } from '../lib/models';
import { outputToMask, planInput, resizeMask, rgbaToTensor } from '../lib/preprocess';
import type { OrtBuild, WorkerRequest, WorkerResponse } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

type Ort = typeof import('onnxruntime-web');

let ort: Ort | null = null;
let current: { model: ModelId; precision: Precision; backend: Backend; session: InferenceSession } | null = null;

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

async function init(ortBase: string, build: OrtBuild) {
  if (ort) return;
  // Both builds are aliased in vite.config.ts to the variants that load their wasm from `wasmPaths`.
  const mod = (build === 'webgpu' ? await import('onnxruntime-web/webgpu') : await import('onnxruntime-web/wasm')) as unknown as Ort;
  mod.env.wasm.wasmPaths = ortBase;
  // GitHub Pages can't send COOP/COEP headers, so SharedArrayBuffer (and threads) are unavailable.
  mod.env.wasm.numThreads = 1;
  mod.env.wasm.proxy = false;
  mod.env.logLevel = 'error';
  ort = mod;
}

async function createSession(bytes: Uint8Array, backend: Backend): Promise<InferenceSession> {
  if (!ort) throw new Error('Runtime not initialised');
  return ort.InferenceSession.create(bytes, {
    executionProviders: [backend],
    graphOptimizationLevel: 'all',
  });
}

async function load(model: ModelId, backend: Backend, precision: Precision): Promise<{ backend: Backend; fellBack: boolean }> {
  if (current && current.model === model && current.precision === precision && current.backend === backend) return { backend, fellBack: false };
  const spec = getModel(model);
  const file = precision === 'fp16' && spec.files.fp16 ? spec.files.fp16 : spec.files.fp32;
  const bytes = await fetchModel(modelUrl(spec, file), file, (loaded, total) => post({ type: 'progress', phase: 'download', model, loaded, total }));
  post({ type: 'progress', phase: 'init', model, loaded: 0, total: 1 });
  if (current) {
    await current.session.release().catch(() => {});
    current = null;
  }
  let session: InferenceSession;
  let used = backend;
  let fellBack = false;
  try {
    session = await createSession(bytes, backend);
  } catch (e) {
    if (backend !== 'webgpu' || spec.webgpuOnly) throw e;
    // Some GPUs/drivers can't run every op; the CPU path always works for the small models.
    session = await createSession(bytes, 'wasm');
    used = 'wasm';
    fellBack = true;
  }
  current = { model, precision, backend: used, session };
  return { backend: used, fellBack };
}

async function decode(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This browser can’t decode this image. Try PNG, JPEG or WebP.');
  }
}

async function run(model: ModelId, file: Blob) {
  if (!current || current.model !== model) throw new Error('Model not loaded');
  const spec = getModel(model);
  const full = await decode(file);
  const width = full.width;
  const height = full.height;
  try {
    const plan = planInput(width, height, spec.input);
    const { content } = plan;
    const small = await createImageBitmap(full, { resizeWidth: content.w, resizeHeight: content.h, resizeQuality: 'high' });
    const canvas = new OffscreenCanvas(plan.width, plan.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('No 2D canvas in worker');
    ctx.drawImage(small, content.x, content.y);
    small.close();
    const rgba = ctx.getImageData(0, 0, plan.width, plan.height).data;
    const input = rgbaToTensor(rgba, plan.width, plan.height, spec.mean, spec.std, content);

    const t0 = performance.now();
    const session = current.session;
    const tensor = new ort!.Tensor('float32', input, [1, 3, plan.height, plan.width]);
    const out = await session.run({ [session.inputNames[0]]: tensor });
    const ms = performance.now() - t0;
    const first = out[session.outputNames[0]];
    const data = (await first.getData()) as Float32Array;
    const small8 = outputToMask(data, spec.output);
    for (const t of Object.values(out)) t.dispose();
    tensor.dispose();
    const mask = resizeMask(small8, plan.width, plan.height, content, width, height);
    const thumb = await makeThumb(full, small8, plan.width, plan.height, content).catch(() => null);
    return { mask, thumb, width, height, ms, backend: current.backend };
  } finally {
    full.close();
  }
}

const THUMB = 160;

/** Small PNG of the cut-out for the queue list. */
async function makeThumb(full: ImageBitmap, mask: Uint8Array, mw: number, mh: number, content: { x: number; y: number; w: number; h: number }): Promise<Blob> {
  const s = Math.min(1, THUMB / Math.max(full.width, full.height));
  const tw = Math.max(1, Math.round(full.width * s));
  const th = Math.max(1, Math.round(full.height * s));
  const canvas = new OffscreenCanvas(tw, th);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(full, 0, 0, tw, th);
  const img = ctx.getImageData(0, 0, tw, th);
  const alpha = resizeMask(mask, mw, mh, content, tw, th);
  for (let i = 0; i < alpha.length; i++) img.data[i * 4 + 3] = alpha[i];
  ctx.putImageData(img, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

let chain: Promise<unknown> = Promise.resolve();

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  chain = chain.then(async () => {
    try {
      if (req.type === 'init') {
        await init(req.ortBase, req.build);
        post({ type: 'ok', rid: req.rid });
      } else if (req.type === 'load') {
        const r = await load(req.model, req.backend, req.precision);
        post({ type: 'loaded', rid: req.rid, ...r });
      } else if (req.type === 'run') {
        const r = await run(req.model, req.file);
        post({ type: 'result', rid: req.rid, ...r }, [r.mask.buffer]);
      }
    } catch (err) {
      post({ type: 'error', rid: req.rid, message: friendlyError(err) });
    }
  });
};

function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/bad_alloc|out of memory|OOM|Aborted\(\)/i.test(msg)) return 'Ran out of memory running the model. Try a smaller image or the Fast model.';
  return msg || 'Something went wrong';
}

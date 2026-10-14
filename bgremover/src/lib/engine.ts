/**
 * Main-thread side of the inference worker. Owns the worker, picks the ONNX Runtime build and
 * backend for each model, and exposes load progress as a small observable status.
 */
import type { OrtBuild, WorkerRequest, WorkerResponse } from '../workers/protocol';
import { getModel, planRun, type Backend, type Capabilities, type ModelId, type RunPlan } from './models';

export type EnginePhase = 'idle' | 'downloading' | 'initialising' | 'ready' | 'error';

export interface EngineStatus {
  phase: EnginePhase;
  model: ModelId | null;
  backend: Backend | null;
  loaded: number;
  total: number;
  error: string | null;
  /** True when WebGPU failed for this model and it is running on the CPU instead. */
  fellBack: boolean;
}

export interface RunResult {
  mask: Uint8Array;
  thumb: Blob | null;
  width: number;
  height: number;
  ms: number;
  backend: Backend;
}

type RequestBody = WorkerRequest extends infer T ? (T extends unknown ? Omit<T, 'rid'> : never) : never;

const IDLE: EngineStatus = { phase: 'idle', model: null, backend: null, loaded: 0, total: 0, error: null, fellBack: false };

interface GPUAdapterLike {
  features: { has(name: string): boolean };
  info?: { vendor?: string; architecture?: string; description?: string; isFallbackAdapter?: boolean };
  isFallbackAdapter?: boolean;
}

/** Detects WebGPU. `?webgpu=0` in the page URL forces the CPU path (handy for testing). */
export async function detectCapabilities(): Promise<Capabilities> {
  const none: Capabilities = { webgpu: 'none', shaderF16: false };
  try {
    if (/[?&]webgpu=0\b/.test(location.search + location.hash)) return none;
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(o?: object): Promise<GPUAdapterLike | null> } }).gpu;
    if (!gpu) return none;
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return none;
    const info = adapter.info ?? {};
    const text = `${info.vendor ?? ''} ${info.architecture ?? ''} ${info.description ?? ''}`;
    const software = Boolean(info.isFallbackAdapter || adapter.isFallbackAdapter || /swiftshader|llvmpipe|lavapipe|software|basic render/i.test(text));
    return { webgpu: software ? 'software' : 'hardware', shaderF16: adapter.features.has('shader-f16') };
  } catch {
    return none;
  }
}

export class Engine {
  private worker: Worker | null = null;
  private build: OrtBuild | null = null;
  private rid = 0;
  private pending = new Map<number, { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void }>();
  private listeners = new Set<() => void>();
  private loading: Promise<RunPlan> | null = null;
  private loadingModel: ModelId | null = null;
  status: EngineStatus = IDLE;
  readonly caps: Promise<Capabilities>;

  constructor(caps?: Promise<Capabilities>) {
    this.caps = caps ?? detectCapabilities();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getStatus = () => this.status;

  private set(patch: Partial<EngineStatus>) {
    this.status = { ...this.status, ...patch };
    for (const fn of this.listeners) fn();
  }

  private spawn(build: OrtBuild): Worker {
    this.terminate();
    const w = new Worker(new URL('../workers/segment.worker.ts', import.meta.url), { type: 'module', name: 'bgremover-inference' });
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        if (msg.phase === 'download') this.set({ phase: 'downloading', loaded: msg.loaded, total: msg.total });
        else this.set({ phase: 'initialising' });
        return;
      }
      const p = this.pending.get(msg.rid);
      if (!p) return;
      this.pending.delete(msg.rid);
      if (msg.type === 'error') p.reject(new Error(msg.message));
      else p.resolve(msg);
    };
    w.onerror = (e) => {
      e.preventDefault();
      const err = new Error(e.message || 'The inference worker crashed (possibly out of memory).');
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      this.worker = null;
      this.build = null;
      this.set({ ...IDLE, phase: 'error', error: err.message });
    };
    this.worker = w;
    this.build = build;
    return w;
  }

  private request(req: RequestBody): Promise<WorkerResponse> {
    const w = this.worker;
    if (!w) return Promise.reject(new Error('Engine not started'));
    const rid = ++this.rid;
    return new Promise((resolve, reject) => {
      this.pending.set(rid, { resolve, reject });
      w.postMessage({ ...req, rid });
    });
  }

  /** How (and whether) a model would run here. */
  async plan(model: ModelId): Promise<RunPlan | null> {
    return planRun(getModel(model), await this.caps);
  }

  /** Downloads (if needed) and initialises a model. Concurrent calls for the same model share one load. */
  load(model: ModelId): Promise<RunPlan> {
    if (this.loading && this.loadingModel === model) return this.loading;
    if (this.status.phase === 'ready' && this.status.model === model && !this.loading) {
      return this.plan(model).then((p) => p!);
    }
    const run = (async () => {
      const plan = await this.plan(model);
      if (!plan) throw new Error(`${getModel(model).name} needs WebGPU, which this browser doesn’t offer.`);
      const build: OrtBuild = plan.backend === 'webgpu' ? 'webgpu' : 'wasm';
      this.set({ phase: 'initialising', model, backend: plan.backend, loaded: 0, total: plan.file.bytes, error: null, fellBack: false });
      if (!this.worker || this.build !== build) {
        this.spawn(build);
        const ortBase = new URL(`${__ORT_DIR__}/`, document.baseURI).href;
        await this.request({ type: 'init', ortBase, build });
      }
      const res = await this.request({ type: 'load', model, backend: plan.backend, precision: plan.precision });
      if (res.type !== 'loaded') throw new Error('Unexpected reply from worker');
      this.set({ phase: 'ready', model, backend: res.backend, fellBack: res.fellBack, error: null });
      return { ...plan, backend: res.backend };
    })();
    this.loading = run;
    this.loadingModel = model;
    run
      .catch((e: Error) => this.set({ phase: 'error', model, error: e.message }))
      .finally(() => {
        if (this.loading === run) {
          this.loading = null;
          this.loadingModel = null;
        }
      });
    return run;
  }

  async run(model: ModelId, file: Blob): Promise<RunResult> {
    await this.load(model);
    const res = await this.request({ type: 'run', model, file });
    if (res.type !== 'result') throw new Error('Unexpected reply from worker');
    return { mask: res.mask, thumb: res.thumb, width: res.width, height: res.height, ms: res.ms, backend: res.backend };
  }

  terminate() {
    this.worker?.terminate();
    this.worker = null;
    this.build = null;
    for (const p of this.pending.values()) p.reject(new Error('Stopped'));
    this.pending.clear();
  }
}

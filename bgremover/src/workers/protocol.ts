import type { Backend, ModelId, Precision } from '../lib/models';

/** Which ONNX Runtime build a worker runs. One per worker; switching builds means a new worker. */
export type OrtBuild = 'wasm' | 'webgpu';

export type WorkerRequest =
  | { type: 'init'; rid: number; ortBase: string; build: OrtBuild }
  | { type: 'load'; rid: number; model: ModelId; backend: Backend; precision: Precision }
  | { type: 'run'; rid: number; model: ModelId; file: Blob };

export type WorkerResponse =
  | { type: 'ok'; rid: number }
  | { type: 'loaded'; rid: number; backend: Backend; fellBack: boolean }
  | { type: 'result'; rid: number; mask: Uint8Array; thumb: Blob | null; width: number; height: number; ms: number; backend: Backend }
  | { type: 'error'; rid: number; message: string }
  | { type: 'progress'; phase: 'download' | 'init'; model: ModelId; loaded: number; total: number };

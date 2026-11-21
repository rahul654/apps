/**
 * Whisper models. Weights: OpenAI Whisper (code and weights MIT; the Hugging Face model cards
 * say Apache-2.0). ONNX exports: Xenova/whisper-* on Hugging Face, Apache-2.0, exported with
 * cross-attention outputs, so word timestamps work.
 *
 * Sizes (MB, 10^6 bytes) are the files transformers.js downloads for each backend, taken from
 * the Hugging Face file listing:
 *   WASM:   encoder q8 + merged decoder q8
 *   WebGPU: encoder fp32 + merged decoder q4 (quantised q8 kernels are slow on WebGPU)
 * plus ~2.8 MB of tokenizer/config files.
 */
import type { Backend } from '../types';

export type ModelSize = 'tiny' | 'base' | 'small';

export interface ModelInfo {
  size: ModelSize;
  id: string;
  label: string;
  params: string;
  /** Download size in MB by backend. */
  mb: Record<Backend, number>;
  note: string;
}

export const MODEL_LICENCE = 'Apache-2.0 (Xenova ONNX export of OpenAI Whisper, MIT)';

const TOKENIZER_FILES = ['config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json'];

export const MODELS: ModelInfo[] = [
  { size: 'tiny', id: 'Xenova/whisper-tiny', label: 'Tiny', params: '39 M', mb: { wasm: 43.6, webgpu: 122.4 }, note: 'Fastest. Fine for clear speech; makes more mistakes.' },
  { size: 'base', id: 'Xenova/whisper-base', label: 'Base', params: '74 M', mb: { wasm: 79.7, webgpu: 208.9 }, note: 'A good balance of speed and accuracy.' },
  { size: 'small', id: 'Xenova/whisper-small', label: 'Small', params: '244 M', mb: { wasm: 251.9, webgpu: 588.8 }, note: 'Most accurate here. Slow without WebGPU; needs a lot of memory.' },
];

export function modelById(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id);
}

/** dtype per model part, as passed to transformers.js `pipeline(..., { dtype })`. */
export function dtypeFor(backend: Backend): { encoder_model: string; decoder_model_merged: string } {
  return backend === 'webgpu' ? { encoder_model: 'fp32', decoder_model_merged: 'q4' } : { encoder_model: 'q8', decoder_model_merged: 'q8' };
}

const SUFFIX: Record<string, string> = { fp32: '', q8: '_quantized', q4: '_q4', fp16: '_fp16' };

/** Repo-relative paths of every file a model needs on a backend. */
export function modelFiles(backend: Backend): string[] {
  const d = dtypeFor(backend);
  return [...TOKENIZER_FILES, `onnx/encoder_model${SUFFIX[d.encoder_model]}.onnx`, `onnx/decoder_model_merged${SUFFIX[d.decoder_model_merged]}.onnx`];
}

/** Cache Storage name for model files (namespaced; the origin is shared with other apps). */
export const MODEL_CACHE = 'transcribe:models';

export const HF_HOST = 'https://huggingface.co';

/** The URL transformers.js fetches (and uses as the cache key) for a repo file. */
export function fileUrl(modelId: string, path: string): string {
  return `${HF_HOST}/${modelId}/resolve/main/${path}`;
}

/** Parses a cache key back to model id and file path, or null if it isn't a model file. */
export function parseFileUrl(url: string): { modelId: string; path: string } | null {
  const m = url.match(/^https:\/\/huggingface\.co\/([^/]+\/[^/]+)\/resolve\/[^/]+\/(.+)$/);
  return m ? { modelId: m[1], path: decodeURIComponent(m[2]) } : null;
}

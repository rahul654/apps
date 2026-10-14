/**
 * The segmentation models the app can run. Weights are downloaded on demand from Hugging Face,
 * pinned to a commit so the bytes (and the SHA-256 below) never change under us.
 * All three are permissively licensed (checked on each model card).
 */
export type ModelId = 'fast' | 'portrait' | 'quality';

/** How an image is resized into the model's input tensor. */
export type InputPlanSpec =
  | { mode: 'fixed'; width: number; height: number; fit: 'stretch' | 'letterbox' }
  /** Shortest edge scaled to `short`, both sides rounded to a multiple of `multiple`, longest capped at `maxLong`. */
  | { mode: 'shortEdge'; short: number; multiple: number; maxLong: number };

/** What the model's first output contains. */
export type OutputKind = 'probability' | 'logits' | 'minmax';

export interface ModelFile {
  path: string;
  bytes: number;
  sha256: string;
}

export interface ModelSpec {
  id: ModelId;
  name: string;
  summary: string;
  bestFor: string;
  /** Upstream model name and licence as shown on the model card. */
  upstream: string;
  licence: 'MIT' | 'Apache-2.0';
  repo: string;
  revision: string;
  /** fp32 runs everywhere; fp16 is used on WebGPU adapters with `shader-f16`. */
  files: { fp32: ModelFile; fp16?: ModelFile };
  input: InputPlanSpec;
  mean: [number, number, number];
  std: [number, number, number];
  output: OutputKind;
  /** The WASM build of ONNX Runtime is 32-bit (4 GB heap); this model runs out of memory there. */
  webgpuOnly: boolean;
  /** Not confirmed end-to-end on real hardware yet; shown with an "Experimental" badge. */
  experimental?: boolean;
}

const IMAGENET_MEAN: [number, number, number] = [0.485, 0.456, 0.406];
const IMAGENET_STD: [number, number, number] = [0.229, 0.224, 0.225];

export const MODELS: readonly ModelSpec[] = [
  {
    id: 'fast',
    name: 'Fast',
    summary: 'Small general model. Good on products and clear subjects; rough on hair and busy scenes.',
    bestFor: 'Objects, products, quick batches',
    upstream: 'U²-Net-p (salient object detection)',
    licence: 'Apache-2.0',
    repo: 'BritishWerewolf/U-2-Netp',
    revision: '7112208dbac3a3642496c8d54e2f0f9bb3dc1dc8',
    files: { fp32: { path: 'onnx/model.onnx', bytes: 4_574_861, sha256: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8' } },
    input: { mode: 'fixed', width: 320, height: 320, fit: 'stretch' },
    mean: IMAGENET_MEAN,
    std: IMAGENET_STD,
    output: 'minmax',
    webgpuOnly: false,
  },
  {
    id: 'portrait',
    name: 'People',
    summary: 'Portrait matting model with soft edges around hair. Only finds people.',
    bestFor: 'Portraits, selfies, people',
    upstream: 'MODNet (trimap-free portrait matting)',
    licence: 'Apache-2.0',
    repo: 'Xenova/modnet',
    revision: 'fa2fa546052fba4c08921230a26cc69a333fca12',
    files: { fp32: { path: 'onnx/model.onnx', bytes: 25_888_640, sha256: '07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9' } },
    input: { mode: 'shortEdge', short: 512, multiple: 32, maxLong: 1024 },
    mean: [0.5, 0.5, 0.5],
    std: [0.5, 0.5, 0.5],
    output: 'probability',
    webgpuOnly: false,
  },
  {
    id: 'quality',
    name: 'Best quality',
    summary: 'High-resolution (1024 px) segmentation with fine detail on any subject. Needs WebGPU.',
    bestFor: 'Anything, including thin structures',
    upstream: 'BiRefNet lite (dichotomous image segmentation)',
    licence: 'MIT',
    repo: 'onnx-community/BiRefNet_lite-ONNX',
    revision: 'de15b22ba131738a16dff04aab8bdf8dc32e3ac1',
    files: {
      fp32: { path: 'onnx/model.onnx', bytes: 224_005_088, sha256: '5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333' },
      fp16: { path: 'onnx/model_fp16.onnx', bytes: 114_538_221, sha256: 'd39b897ceb16ae654c1731f3dba0cf9b368d9cae74b5a57459b455cc8bfec402' },
    },
    input: { mode: 'fixed', width: 1024, height: 1024, fit: 'stretch' },
    mean: IMAGENET_MEAN,
    std: IMAGENET_STD,
    output: 'logits',
    webgpuOnly: true,
    experimental: true,
  },
];

export const DEFAULT_MODEL: ModelId = 'fast';

export function getModel(id: ModelId): ModelSpec {
  const m = MODELS.find((x) => x.id === id);
  if (!m) throw new Error(`Unknown model ${id}`);
  return m;
}

export const isModelId = (x: unknown): x is ModelId => MODELS.some((m) => m.id === x);

/** What the browser offers for running models. */
export interface Capabilities {
  /** 'hardware' = a real GPU adapter; 'software' = a CPU fallback adapter (works, but slow). */
  webgpu: 'hardware' | 'software' | 'none';
  shaderF16: boolean;
}

export type Backend = 'webgpu' | 'wasm';
export type Precision = 'fp32' | 'fp16';

export interface RunPlan {
  backend: Backend;
  precision: Precision;
  file: ModelFile;
  url: string;
}

export const modelUrl = (spec: ModelSpec, file: ModelFile) => `https://huggingface.co/${spec.repo}/resolve/${spec.revision}/${file.path}`;

/**
 * Picks backend and weights for a model. Small models stay on WASM when the only WebGPU adapter
 * is a software fallback (it's slower than WASM for them). Returns null when the model can't run here.
 */
export function planRun(spec: ModelSpec, caps: Capabilities): RunPlan | null {
  const gpu = caps.webgpu !== 'none' && (spec.webgpuOnly || caps.webgpu === 'hardware');
  if (spec.webgpuOnly && !gpu) return null;
  const precision: Precision = gpu && caps.shaderF16 && spec.files.fp16 ? 'fp16' : 'fp32';
  const file = precision === 'fp16' ? spec.files.fp16! : spec.files.fp32;
  return { backend: gpu ? 'webgpu' : 'wasm', precision, file, url: modelUrl(spec, file) };
}

export function modelLicenceUrl(spec: ModelSpec) {
  return `https://huggingface.co/${spec.repo}`;
}

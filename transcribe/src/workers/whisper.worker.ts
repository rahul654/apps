/**
 * Whisper in a module worker (transformers.js v3 + ONNX Runtime Web).
 *
 *  - ORT's WASM files are self-hosted (vite.config.ts copies them to dist/ort/); the page passes
 *    their absolute URL, because transformers.js would otherwise point ORT at jsDelivr.
 *  - Single-threaded WASM: GitHub Pages can't send COOP/COEP, so SharedArrayBuffer (and ORT's
 *    threads) aren't available. WebGPU is used when an adapter exists, falling back to WASM.
 *  - Model files come from Hugging Face on first use and are kept in Cache Storage under
 *    "transcribe:models" (a custom cache, so this app's files are separate from any other
 *    app on the same origin). Later runs load from there, offline too.
 *  - Long audio is cut into 30 s windows with a 5 s stride and merged in lib/merge.ts.
 *  - Cancel = the page terminates this worker. Nothing here needs to clean up.
 */
import { env, pipeline, Tensor, WhisperTextStreamer } from '@huggingface/transformers';
import { CHUNK_SECONDS, STRIDE_SECONDS, collapseLoops, hasLoop, isSilent, splitIntoWords, itemsToSegments, mergeWindow, planWindows, wordsToSegments, type RawChunk, type TimedItem } from '../lib/merge';
import { dtypeFor, MODEL_CACHE } from '../lib/models';
import type { Backend, Segment } from '../types';
import type { FileProgress, FromWorker, LoadOptions, ToWorker, TranscribeOptions } from './protocol';

const RATE = 16000;
/** Generation settings for the second attempt at a window that came out as a repetition loop. */
const RETRY_ON_LOOP = { no_repeat_ngram_size: 5 };

interface Scope {
  postMessage(msg: FromWorker): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
}
const scope = self as unknown as Scope;
const post = (m: FromWorker) => scope.postMessage(m);

env.allowLocalModels = false;
env.useBrowserCache = false;
try {
  if (typeof caches !== 'undefined') {
    env.useCustomCache = true;
    env.customCache = {
      match: async (key: RequestInfo | URL) => (await caches.open(MODEL_CACHE)).match(key),
      put: async (key: RequestInfo | URL, res: Response) => (await caches.open(MODEL_CACHE)).put(key, res),
    };
  }
} catch {
  /* no cache: models are downloaded each time */
}

interface AsrOutput {
  text: string;
  chunks?: RawChunk[];
}
type AsrFn = ((audio: Float32Array, opts: Record<string, unknown>) => Promise<AsrOutput>) & {
  model: ((inputs: Record<string, unknown>) => Promise<{ logits: Tensor }>) & { generation_config: { lang_to_id?: Record<string, number>; decoder_start_token_id?: number } };
  processor: (audio: Float32Array) => Promise<{ input_features: Tensor }>;
  tokenizer: unknown;
  dispose(): Promise<void>;
};

let loaded: { key: string; asr: AsrFn; backend: Backend } | null = null;

function configureOrt(ortBase: string) {
  const wasm = env.backends.onnx.wasm!;
  wasm.wasmPaths = ortBase;
  wasm.numThreads = 1;
  wasm.proxy = false;
  // ORT logs benign warnings (e.g. shape ops placed on the CPU under WebGPU) as console errors.
  (env.backends.onnx as { logLevel?: string }).logLevel = 'error';
}

async function hasWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!gpu && !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

async function create(model: string, backend: Backend): Promise<AsrFn> {
  const files = new Map<string, FileProgress>();
  let last = 0;
  const flush = (force = false) => {
    const now = performance.now();
    if (!force && now - last < 120) return;
    last = now;
    post({ type: 'download', files: [...files.values()] });
  };
  const asr = await pipeline('automatic-speech-recognition', model, {
    device: backend,
    dtype: dtypeFor(backend) as never,
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (!p.file) return;
      const f = files.get(p.file) ?? { file: p.file, loaded: 0, total: 0, cached: false };
      if (p.status === 'progress') {
        f.loaded = p.loaded ?? f.loaded;
        f.total = p.total ?? f.total;
      } else if (p.status === 'done') {
        f.loaded = Math.max(f.loaded, f.total);
      }
      files.set(p.file, f);
      flush(p.status === 'done');
    },
  });
  flush(true);
  return asr as unknown as AsrFn;
}

async function ensure(opts: LoadOptions): Promise<{ asr: AsrFn; backend: Backend }> {
  configureOrt(opts.ortBase);
  let backend: Backend = opts.backend === 'auto' ? ((await hasWebGpu()) ? 'webgpu' : 'wasm') : opts.backend;
  if (opts.backend === 'webgpu' && !(await hasWebGpu())) backend = 'wasm';
  const key = `${opts.model}|${backend}`;
  if (loaded?.key === key) {
    post({ type: 'backend', backend });
    return loaded;
  }
  if (loaded) {
    await loaded.asr.dispose().catch(() => {});
    loaded = null;
  }
  post({ type: 'backend', backend });
  post({ type: 'status', phase: 'loading', message: 'Loading model…' });
  let fallbackReason: string | undefined;
  let asr: AsrFn;
  try {
    asr = await create(opts.model, backend);
  } catch (e) {
    if (backend !== 'webgpu') throw e;
    fallbackReason = `WebGPU failed (${(e as Error)?.message ?? e}); using WASM.`;
    backend = 'wasm';
    asr = await create(opts.model, backend);
  }
  if (opts.backend === 'webgpu' && backend === 'wasm' && !fallbackReason) fallbackReason = 'WebGPU isn’t available in this browser; using WASM.';
  loaded = { key: `${opts.model}|${backend}`, asr, backend };
  post({ type: 'backend', backend, fallbackReason });
  post({ type: 'status', phase: 'ready', message: 'Model ready' });
  return loaded;
}

/**
 * Language identification. transformers.js v3 doesn't implement it (it defaults to English),
 * so run one decoder step after <|startoftranscript|> and take the most likely language token,
 * as OpenAI's `detect_language` does.
 */
async function detectLanguage(asr: AsrFn, audio: Float32Array): Promise<{ code: string; probability: number } | null> {
  const cfg = asr.model.generation_config;
  const langToId = cfg.lang_to_id;
  const sot = cfg.decoder_start_token_id ?? 50258;
  if (!langToId) return null;
  const { input_features } = await asr.processor(audio);
  const decoder_input_ids = new Tensor('int64', BigInt64Array.from([BigInt(sot)]), [1, 1]);
  const { logits } = await asr.model({ input_features, decoder_input_ids });
  const data = logits.data as Float32Array;
  const vocab = logits.dims[logits.dims.length - 1];
  const row = data.subarray(data.length - vocab);
  let best = '';
  let bestLogit = -Infinity;
  let max = -Infinity;
  for (const id of Object.values(langToId)) max = Math.max(max, row[id]);
  let sum = 0;
  for (const [tok, id] of Object.entries(langToId)) {
    sum += Math.exp(row[id] - max);
    if (row[id] > bestLogit) {
      bestLogit = row[id];
      best = tok;
    }
  }
  const code = best.replace(/^<\||\|>$/g, '');
  return code ? { code, probability: Math.exp(bestLogit - max) / sum } : null;
}

/** The loudest 30 s of the first few minutes, so detection doesn't run on a silent intro. */
function detectionSample(audio: Float32Array): Float32Array {
  const len = CHUNK_SECONDS * RATE;
  if (audio.length <= len) return audio;
  let bestStart = 0;
  let bestEnergy = -1;
  const limit = Math.min(audio.length - len, 5 * 60 * RATE);
  for (let start = 0; start <= limit; start += 10 * RATE) {
    let e = 0;
    for (let i = start; i < start + len; i += 16) e += audio[i] * audio[i];
    if (e > bestEnergy) {
      bestEnergy = e;
      bestStart = start;
    }
  }
  return audio.subarray(bestStart, bestStart + len);
}

async function transcribe(audio: Float32Array, opts: TranscribeOptions) {
  const t0 = performance.now();
  const { asr, backend } = await ensure(opts);
  let language = opts.language || undefined;
  let languageDetected = false;
  if (!language) {
    post({ type: 'status', phase: 'detecting', message: 'Detecting the language…' });
    const sample = detectionSample(audio);
    if (!isSilent(sample)) {
      const found = await detectLanguage(asr, sample).catch(() => null);
      if (found) {
        language = found.code;
        languageDetected = true;
        post({ type: 'language', ...found });
      }
    }
  }

  const duration = audio.length / RATE;
  const windows = planWindows(duration, CHUNK_SECONDS, STRIDE_SECONDS);
  const word = opts.timestamps === 'word';
  let items: TimedItem[] = [];
  const toSegments = (): Segment[] =>
    word ? wordsToSegments(items.map((i) => ({ text: i.text, start: i.start, end: i.end }))) : itemsToSegments(items);

  post({ type: 'status', phase: 'transcribing', message: 'Transcribing…' });
  post({ type: 'progress', done: 0, total: windows.length, segments: [] });
  for (const w of windows) {
    const from = Math.floor(w.start * RATE);
    const to = Math.min(audio.length, Math.ceil(w.end * RATE));
    if (!isSilent(audio, from, to)) {
      let partial = '';
      const streamer = new WhisperTextStreamer(asr.tokenizer as never, {
        skip_prompt: true,
        callback_function: (text: string) => {
          partial += text;
          post({ type: 'partial', window: w.index, text: partial });
        },
      });
      const run = async (extra: Record<string, unknown> = {}) => {
        const out = await asr(audio.subarray(from, to), {
          language: language ?? 'en',
          task: opts.task,
          return_timestamps: word ? 'word' : true,
          streamer,
          ...extra,
        });
        return out.chunks?.length ? out.chunks : out.text.trim() ? [{ text: out.text, timestamp: [0, null] as [number, null] }] : [];
      };
      let chunks: RawChunk[] = await run();
      if (hasLoop(chunks)) {
        // Stuck repeating a phrase. Decode this window again: in word mode with timestamp tokens
        // (which keep Whisper on track far better; word times are then interpolated), otherwise
        // forbidding repeated 5-grams. If that loops too, keep one copy of the phrase.
        if (opts.debug) console.log('transcribe:loop', JSON.stringify({ start: w.start, text: chunks.map((c) => c.text).join('') }));
        partial = '';
        const retry = word ? splitIntoWords(await run({ return_timestamps: true })) : await run(RETRY_ON_LOOP);
        if (opts.debug) console.log('transcribe:retry', JSON.stringify({ start: w.start, text: retry.map((c) => c.text).join('') }));
        chunks = collapseLoops(hasLoop(retry) || !retry.length ? chunks : retry);
      }
      items = mergeWindow(items, chunks, w, word ? 'word' : 'segment');
    }
    post({ type: 'partial', window: w.index, text: '' });
    post({ type: 'progress', done: w.index + 1, total: windows.length, segments: toSegments() });
  }
  post({ type: 'done', segments: toSegments(), language, languageDetected, backend, elapsedMs: performance.now() - t0 });
}

let queue: Promise<void> = Promise.resolve();
scope.onmessage = (e) => {
  const msg = e.data;
  queue = queue.then(async () => {
    try {
      if (msg.type === 'load') await ensure(msg);
      else if (msg.type === 'transcribe') await transcribe(msg.audio, msg);
    } catch (err) {
      const m = (err as Error)?.message ?? String(err);
      post({ type: 'error', message: /fetch|network|Failed to fetch/i.test(m) ? `Couldn’t download the model. Check your connection and try again. (${m})` : m });
    }
  });
};

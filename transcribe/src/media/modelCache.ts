/** What's in the model cache (Cache Storage "transcribe:models"), and removing it. */
import { MODEL_CACHE, MODELS, fileUrl, modelFiles, parseFileUrl } from '../lib/models';
import type { Backend } from '../types';

export interface CachedModel {
  modelId: string;
  bytes: number;
  files: number;
  /** Backends whose complete file set is cached. */
  ready: Backend[];
}

async function sizeOf(res: Response): Promise<number> {
  const len = Number(res.headers.get('content-length'));
  if (len > 0) return len;
  try {
    return (await res.blob()).size;
  } catch {
    return 0;
  }
}

export async function listCachedModels(): Promise<CachedModel[]> {
  if (typeof caches === 'undefined') return [];
  let cache: Cache;
  try {
    if (!(await caches.has(MODEL_CACHE))) return [];
    cache = await caches.open(MODEL_CACHE);
  } catch {
    return [];
  }
  const byModel = new Map<string, { bytes: number; paths: Set<string> }>();
  for (const req of await cache.keys()) {
    const parsed = parseFileUrl(req.url);
    if (!parsed) continue;
    const res = await cache.match(req);
    const entry = byModel.get(parsed.modelId) ?? { bytes: 0, paths: new Set<string>() };
    entry.bytes += res ? await sizeOf(res) : 0;
    entry.paths.add(parsed.path);
    byModel.set(parsed.modelId, entry);
  }
  return [...byModel.entries()].map(([modelId, e]) => ({
    modelId,
    bytes: e.bytes,
    files: e.paths.size,
    ready: (['wasm', 'webgpu'] as Backend[]).filter((b) => modelFiles(b).every((p) => e.paths.has(p))),
  }));
}

export async function deleteCachedModel(modelId: string): Promise<void> {
  if (typeof caches === 'undefined') return;
  const cache = await caches.open(MODEL_CACHE);
  for (const req of await cache.keys()) {
    if (parseFileUrl(req.url)?.modelId === modelId) await cache.delete(req);
  }
}

export async function isModelReady(modelId: string, backend: Backend): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  try {
    const cache = await caches.open(MODEL_CACHE);
    for (const p of modelFiles(backend)) if (!(await cache.match(fileUrl(modelId, p)))) return false;
    return true;
  } catch {
    return false;
  }
}

export const KNOWN_MODEL_IDS = MODELS.map((m) => m.id);

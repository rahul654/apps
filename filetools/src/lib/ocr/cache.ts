/**
 * Language data storage (browser). Files live in tesseract.js's own IndexedDB cache
 * (idb-keyval's default "keyval-store"), under keys `<model>/<lang>.traineddata`, so its
 * workers read them directly (cachePath = model, cacheMethod = 'readOnly'). We download
 * them ourselves to show progress and sizes, and to list/clear what's cached.
 */
import { del, get, keys, set } from 'idb-keyval';
import { BUNDLED_FAST, parseCacheKey, resolveLangAssets, type LangAsset, type OcrModel } from './langs';

/** Bundled files are copied by vite.config.ts to ./ocr/tessdata_fast/<lang>.traineddata.gz. */
export const BUNDLED_DIR = './ocr/tessdata_fast';

export function bundledLangUrls(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const code of BUNDLED_FAST) out[code] = `${BUNDLED_DIR}/${code}.traineddata.gz`;
  return out;
}

export function assetsFor(codes: string[], model: OcrModel): LangAsset[] {
  return resolveLangAssets(codes, model, bundledLangUrls());
}

export interface CachedLang {
  key: string;
  code: string;
  model: OcrModel;
  bytes: number;
}

export async function listCached(): Promise<CachedLang[]> {
  const out: CachedLang[] = [];
  for (const k of await keys()) {
    if (typeof k !== 'string') continue;
    const p = parseCacheKey(k);
    if (!p) continue;
    const v = (await get(k)) as Uint8Array | undefined;
    out.push({ key: k, code: p.code, model: p.model, bytes: v?.byteLength ?? 0 });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

export async function clearCached(): Promise<number> {
  const list = await listCached();
  for (const c of list) await del(c.key);
  return list.length;
}

export async function isCached(asset: LangAsset): Promise<boolean> {
  try {
    return (await get(asset.cacheKey)) !== undefined;
  } catch {
    return false;
  }
}

function looksLikeTraineddata(b: Uint8Array): boolean {
  // gzip, or a raw traineddata header (little-endian entry count, then offsets).
  return b.length > 1000 && ((b[0] === 0x1f && b[1] === 0x8b) || (b[1] === 0 && b[2] === 0 && b[3] === 0));
}

/** Download (if needed) and store every asset. Progress is 0–1 over all bytes. */
export async function ensureLanguageData(assets: LangAsset[], onProgress?: (fraction: number, label: string) => void, signal?: AbortSignal): Promise<void> {
  const missing: LangAsset[] = [];
  for (const a of assets) if (!(await isCached(a))) missing.push(a);
  if (!missing.length) return;
  const total = missing.reduce((s, a) => s + a.bytes, 0);
  let done = 0;
  for (const a of missing) {
    const res = await fetch(new URL(a.url, document.baseURI).href, { signal });
    if (!res.ok) throw new Error(`Couldn’t download ${a.code} language data (${res.status}).`);
    const len = Number(res.headers.get('content-length')) || a.bytes;
    const chunks: Uint8Array[] = [];
    let got = 0;
    const reader = res.body?.getReader();
    if (reader) {
      for (;;) {
        const { done: end, value } = await reader.read();
        if (end) break;
        chunks.push(value);
        got += value.byteLength;
        onProgress?.(Math.min(1, (done + (got / len) * a.bytes) / total), `Downloading ${a.code} (${Math.round((got / len) * 100)}%)`);
      }
    } else chunks.push(new Uint8Array(await res.arrayBuffer()));
    const bytes = new Uint8Array(chunks.reduce((s, c) => s + c.byteLength, 0));
    let off = 0;
    for (const c of chunks) {
      bytes.set(c, off);
      off += c.byteLength;
    }
    if (!looksLikeTraineddata(bytes)) throw new Error(`The ${a.code} language file looks damaged; try again.`);
    try {
      await set(a.cacheKey, bytes);
    } catch {
      throw new Error('Language data can’t be stored in this browser (private browsing or storage full).');
    }
    done += a.bytes;
    onProgress?.(done / total, `Stored ${a.code}`);
  }
}

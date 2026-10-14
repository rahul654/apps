/**
 * Model weights are stored in Cache Storage (bucket `bgremover-models-v1`), keyed by their pinned
 * Hugging Face URL, so the second visit works offline. Used from both the worker and the page.
 */
export const MODEL_CACHE = 'bgremover-models-v1';

const hasCaches = () => typeof caches !== 'undefined';

export async function isCached(url: string): Promise<boolean> {
  if (!hasCaches()) return false;
  try {
    const c = await caches.open(MODEL_CACHE);
    return Boolean(await c.match(url));
  } catch {
    return false;
  }
}

export async function cachedUrls(): Promise<string[]> {
  if (!hasCaches()) return [];
  try {
    const c = await caches.open(MODEL_CACHE);
    return (await c.keys()).map((r) => r.url);
  } catch {
    return [];
  }
}

export async function deleteCachedModels(): Promise<void> {
  if (hasCaches()) await caches.delete(MODEL_CACHE);
}

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Returns the model bytes, from the cache or by downloading them (reporting progress). Downloads are
 * checked against the expected size and SHA-256 before they're cached or used.
 */
export async function fetchModel(url: string, expected: { bytes: number; sha256: string }, onProgress: (loaded: number, total: number) => void): Promise<Uint8Array> {
  const cache = hasCaches() ? await caches.open(MODEL_CACHE).catch(() => null) : null;
  const hit = await cache?.match(url);
  if (hit) {
    const buf = new Uint8Array(await hit.arrayBuffer());
    if (buf.byteLength === expected.bytes) return buf;
    await cache?.delete(url);
  }

  let res: Response;
  try {
    res = await fetch(url, { mode: 'cors', credentials: 'omit' });
  } catch {
    throw new Error('Couldn’t download the model. Check your connection and try again.');
  }
  if (!res.ok || !res.body) throw new Error(`Model download failed (HTTP ${res.status}).`);
  const buf = new Uint8Array(expected.bytes);
  const reader = res.body.getReader();
  let off = 0;
  let lastReport = 0;
  onProgress(0, expected.bytes);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (off + value.byteLength > buf.byteLength) {
      await reader.cancel();
      throw new Error('The downloaded model is larger than expected; not using it.');
    }
    buf.set(value, off);
    off += value.byteLength;
    const now = Date.now();
    if (now - lastReport > 100) {
      lastReport = now;
      onProgress(off, expected.bytes);
    }
  }
  onProgress(off, expected.bytes);
  if (off !== expected.bytes) throw new Error('The model download was cut short. Try again.');
  const digest = toHex(await crypto.subtle.digest('SHA-256', buf));
  if (digest !== expected.sha256) throw new Error('The downloaded model failed its integrity check; not using it.');
  try {
    await cache?.put(url, new Response(buf, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(buf.byteLength) } }));
  } catch {
    /* storage full or blocked: it works now, it just won't be offline next time */
  }
  return buf;
}

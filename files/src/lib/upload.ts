// Pure helpers for chunked uploads: chunk sizes, queue order, space checks, retry timing, base64.

/** Drive needs every chunk except the last to be a multiple of 256 KiB. */
export const CHUNK_UNIT = 256 * 1024;
/** What the script accepts at most; 8 MiB is ~11 MB of base64 per request. */
export const MAX_CHUNK = 8 * 1024 * 1024;

/** The chunk size to use: the script's, if it's a sane multiple of 256 KiB, else 8 MiB. */
export function chunkSizeFrom(server: unknown): number {
  const n = Number(server);
  if (Number.isInteger(n) && n > 0 && n % CHUNK_UNIT === 0 && n <= MAX_CHUNK) return n;
  return MAX_CHUNK;
}

/** Byte range [start, end) of the chunk that starts at `offset`. */
export function chunkAt(offset: number, size: number, chunkBytes: number): { start: number; end: number } {
  return { start: offset, end: Math.min(size, offset + chunkBytes) };
}

export type Queued = { id: string; size: number; seq: number };

/** Smallest first; equal sizes keep the order they were added in. */
export function bySizeAscending<T extends Queued>(jobs: readonly T[]): T[] {
  return [...jobs].sort((a, b) => a.size - b.size || a.seq - b.seq);
}

/** Whether `size` more bytes fit. */
export function fits(size: number, used: number, limit: number): boolean {
  return limit <= 0 || used + size <= limit;
}

const RETRY_DELAYS = [2_000, 5_000, 10_000, 20_000];
/** Wait before retry number `attempt` (1-based); null = give up and pause. */
export function retryDelay(attempt: number): number | null {
  return RETRY_DELAYS[attempt - 1] ?? null;
}

/** Base64 of bytes, using the built-in when the browser has one. */
export function bytesToBase64(bytes: Uint8Array): string {
  const native = (bytes as Uint8Array & { toBase64?: () => string }).toBase64;
  if (typeof native === 'function') return native.call(bytes);
  let binary = '';
  const STEP = 0x8000; // keeps fromCharCode's argument list small
  for (let i = 0; i < bytes.length; i += STEP) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + STEP) as unknown as number[]);
  return btoa(binary);
}

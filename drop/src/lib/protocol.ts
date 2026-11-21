/**
 * What travels over the single data channel (reliable + ordered, so no sequence numbers needed):
 *   - text frames = JSON control messages (`Ctl`)
 *   - binary frames = file bytes, always belonging to the file opened by the last `file` message
 *
 * A file is `file` → binary chunks → `end`. Files go one at a time. Either side can cancel:
 * the receiver sends `cancel`, the sender stops and sends `end` with `cancelled: true`, and the
 * receiver drops bytes until that `end` arrives. The receiver confirms a complete file with `ack`.
 */

export const PROTOCOL_VERSION = 1;
/** Bytes per message when the peer's limit is unknown: every browser accepts 64 KiB. */
export const DEFAULT_CHUNK = 64 * 1024;
/** Upper bound when both sides allow more (Chrome ⇄ Chrome: 256 KiB); fewer messages = faster. */
export const MAX_CHUNK = 256 * 1024;
/** Read the file in larger slices than we send, to cut per-read overhead. */
const READ_SLICE = 1024 * 1024;
/** Pause sending above this much queued data, resume below LOW. */
export const HIGH_WATER = 8 * 1024 * 1024;
export const LOW_WATER = 1024 * 1024;
/** The receiver turns buffered chunks into a Blob every this many bytes, so the browser can
 * move them out of the JS heap (Chrome pages large blobs to disk). */
export const BLOB_BATCH = 16 * 1024 * 1024;
export const MAX_NAME = 255;
export const MAX_TEXT = 1024 * 1024;

export type Ctl =
  | { t: 'hello'; v: number; name: string }
  | { t: 'file'; id: string; name: string; size: number; mime: string }
  | { t: 'end'; id: string; cancelled?: boolean }
  | { t: 'cancel'; id: string }
  | { t: 'ack'; id: string }
  | { t: 'text'; id: string; text: string }
  | { t: 'bye' };

const isStr = (v: unknown, max = MAX_NAME): v is string => typeof v === 'string' && v.length <= max;
const isId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v);

/** Parse and validate a control message from the other device. Unknown or malformed → null. */
export function parseCtl(text: string): Ctl | null {
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(text);
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object') return null;
  switch (m.t) {
    case 'hello':
      return typeof m.v === 'number' && isStr(m.name, 80) ? { t: 'hello', v: m.v, name: m.name } : null;
    case 'file':
      return isId(m.id) && isStr(m.name) && Number.isSafeInteger(m.size) && (m.size as number) >= 0 && isStr(m.mime, 200)
        ? { t: 'file', id: m.id, name: m.name, size: m.size as number, mime: m.mime }
        : null;
    case 'end':
      return isId(m.id) ? { t: 'end', id: m.id, ...(m.cancelled === true ? { cancelled: true } : {}) } : null;
    case 'cancel':
    case 'ack':
      return isId(m.id) ? { t: m.t, id: m.id } : null;
    case 'text':
      return isId(m.id) && isStr(m.text, MAX_TEXT) ? { t: 'text', id: m.id, text: m.text } : null;
    case 'bye':
      return { t: 'bye' };
    default:
      return null;
  }
}

/** The parts of RTCDataChannel the sender needs (a fake implements it in tests). */
export interface ChannelLike {
  readonly readyState: string;
  readonly bufferedAmount: number;
  bufferedAmountLowThreshold: number;
  send(data: string | ArrayBuffer): void;
  addEventListener(type: 'bufferedamountlow' | 'close', fn: () => void): void;
  removeEventListener(type: 'bufferedamountlow' | 'close', fn: () => void): void;
}

export function sendCtl(ch: ChannelLike, msg: Ctl): void {
  ch.send(JSON.stringify(msg));
}

class ChannelClosed extends Error {}

function waitForDrain(ch: ChannelLike): Promise<void> {
  // A closed channel never fires either event again, so check first or we'd wait forever.
  if (ch.readyState !== 'open') return Promise.reject(new ChannelClosed('Connection closed'));
  if (ch.bufferedAmount <= LOW_WATER) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => {
      ch.removeEventListener('bufferedamountlow', done);
      ch.removeEventListener('close', closed);
      resolve();
    };
    const closed = () => {
      ch.removeEventListener('bufferedamountlow', done);
      ch.removeEventListener('close', closed);
      reject(new ChannelClosed('Connection closed'));
    };
    ch.addEventListener('bufferedamountlow', done);
    ch.addEventListener('close', closed);
  });
}

export interface SendOptions {
  chunkSize?: number;
  /** Checked before every chunk; true stops the transfer and tells the receiver. */
  isCancelled?: () => boolean;
  onProgress?: (sentBytes: number) => void;
}

/**
 * Send one file. Resolves 'done' when every byte is handed to the channel (the receiver's `ack`
 * confirms arrival) or 'cancelled'. Rejects if the channel closes.
 */
export async function sendFile(ch: ChannelLike, file: Blob, meta: { id: string; name: string }, opts: SendOptions = {}): Promise<'done' | 'cancelled'> {
  const chunk = opts.chunkSize ?? DEFAULT_CHUNK;
  ch.bufferedAmountLowThreshold = LOW_WATER;
  const ensureOpen = () => {
    if (ch.readyState !== 'open') throw new ChannelClosed('Connection closed');
  };
  ensureOpen();
  sendCtl(ch, { t: 'file', id: meta.id, name: meta.name.slice(0, MAX_NAME), size: file.size, mime: (file.type || 'application/octet-stream').slice(0, 200) });
  let sent = 0;
  for (let start = 0; start < file.size; start += READ_SLICE) {
    const slice = new Uint8Array(await file.slice(start, Math.min(file.size, start + READ_SLICE)).arrayBuffer());
    for (let off = 0; off < slice.length; off += chunk) {
      if (opts.isCancelled?.()) {
        ensureOpen();
        sendCtl(ch, { t: 'end', id: meta.id, cancelled: true });
        return 'cancelled';
      }
      if (ch.bufferedAmount > HIGH_WATER) await waitForDrain(ch);
      ensureOpen();
      const part = slice.subarray(off, Math.min(slice.length, off + chunk));
      // Send an exact-size ArrayBuffer copy: a view's .buffer would send the whole slice.
      ch.send(part.slice().buffer);
      sent += part.length;
      opts.onProgress?.(sent);
    }
  }
  ensureOpen();
  sendCtl(ch, { t: 'end', id: meta.id });
  return 'done';
}

// ---------- receiving ----------

export interface ReceiverEvents {
  onHello?(name: string, version: number): void;
  onFileStart?(meta: { id: string; name: string; size: number; mime: string }): void;
  onProgress?(id: string, receivedBytes: number): void;
  onFileDone?(id: string, blob: Blob): void;
  /** The sender cancelled, or we did (see `Receiver.cancel`). */
  onFileCancelled?(id: string): void;
  /** Size mismatch or a protocol error. */
  onFileFailed?(id: string, reason: string): void;
  onText?(id: string, text: string): void;
  /** The other side asked us to stop sending this file. */
  onCancelRequest?(id: string): void;
  onAck?(id: string): void;
  onBye?(): void;
}

interface Incoming {
  id: string;
  name: string;
  size: number;
  mime: string;
  received: number;
  batch: ArrayBuffer[];
  batchBytes: number;
  blobs: Blob[];
  /** We asked the sender to stop; drop bytes until its `end`. */
  dropping: boolean;
}

/** Feeds channel messages in, emits file/text events out. Pure: no DOM besides Blob. */
export class Receiver {
  private current: Incoming | null = null;
  constructor(private readonly events: ReceiverEvents) {}

  get currentId(): string | null {
    return this.current?.id ?? null;
  }

  handle(data: string | ArrayBuffer): void {
    if (typeof data !== 'string') return this.chunk(data);
    const msg = parseCtl(data);
    if (!msg) return;
    const ev = this.events;
    switch (msg.t) {
      case 'hello':
        return ev.onHello?.(msg.name, msg.v);
      case 'file':
        if (this.current) this.fail('A new file started before the previous one ended.');
        this.current = { ...msg, received: 0, batch: [], batchBytes: 0, blobs: [], dropping: false };
        ev.onFileStart?.(msg);
        ev.onProgress?.(msg.id, 0);
        return;
      case 'end': {
        const cur = this.current;
        if (!cur || cur.id !== msg.id) return;
        this.current = null;
        if (msg.cancelled || cur.dropping) return ev.onFileCancelled?.(cur.id);
        if (cur.received !== cur.size) return ev.onFileFailed?.(cur.id, `Received ${cur.received} of ${cur.size} bytes.`);
        const blob = new Blob([...cur.blobs, ...cur.batch], { type: cur.mime });
        return ev.onFileDone?.(cur.id, blob);
      }
      case 'cancel':
        return ev.onCancelRequest?.(msg.id);
      case 'ack':
        return ev.onAck?.(msg.id);
      case 'text':
        return ev.onText?.(msg.id, msg.text);
      case 'bye':
        return ev.onBye?.();
    }
  }

  /** Stop receiving `id`. Returns true if it was in progress (the caller then sends `cancel`). */
  cancel(id: string): boolean {
    const cur = this.current;
    if (!cur || cur.id !== id || cur.dropping) return false;
    cur.dropping = true;
    cur.batch = [];
    cur.blobs = [];
    return true;
  }

  /** The connection went away mid-file. */
  abort(reason: string): void {
    if (this.current) this.fail(reason);
  }

  private chunk(buf: ArrayBuffer): void {
    const cur = this.current;
    if (!cur || cur.dropping) return;
    cur.received += buf.byteLength;
    if (cur.received > cur.size) return this.fail('Received more data than announced.');
    cur.batch.push(buf);
    cur.batchBytes += buf.byteLength;
    if (cur.batchBytes >= BLOB_BATCH) {
      cur.blobs.push(new Blob(cur.batch));
      cur.batch = [];
      cur.batchBytes = 0;
    }
    this.events.onProgress?.(cur.id, cur.received);
  }

  private fail(reason: string): void {
    const cur = this.current!;
    this.current = null;
    this.events.onFileFailed?.(cur.id, reason);
  }
}

/**
 * The one pairing/transfer session, kept outside React so page changes don't drop the
 * connection. Components read it with `useSession()` (useSyncExternalStore).
 *
 * Received files live only in memory (Blobs) for this page visit: nothing is written to
 * storage, and closing the page discards them.
 */
import { useSyncExternalStore } from 'react';
import { deviceName } from '../lib/device';
import { newId } from '../lib/format';
import { answerOffer, applyAnswer, createOfferCode, createPeer, describeRoute, iceReport, type IceReport, type Peer, type RouteInfo } from '../lib/peer';
import { DEFAULT_CHUNK, MAX_CHUNK, MAX_TEXT, PROTOCOL_VERSION, Receiver, sendCtl, sendFile } from '../lib/protocol';
import { codeToSignal, joinLink, SignalError } from '../lib/signal';

export type Phase = 'idle' | 'preparing' | 'waiting' | 'connecting' | 'connected' | 'closed' | 'failed';
export type Role = 'host' | 'guest';
export type TransferStatus = 'queued' | 'active' | 'done' | 'cancelled' | 'failed';

export interface Transfer {
  id: string;
  direction: 'out' | 'in';
  kind: 'file' | 'text';
  name: string;
  size: number;
  mime: string;
  bytes: number;
  status: TransferStatus;
  error?: string;
  text?: string;
  /** Received files: the data and an object URL for preview/save. */
  blob?: Blob;
  url?: string;
  /** Sent files: the receiver confirmed every byte arrived. */
  delivered?: boolean;
  startedAt?: number;
  finishedAt?: number;
  /** Smoothed bytes per second while active. */
  speed?: number;
}

export interface SessionState {
  phase: Phase;
  role: Role | null;
  /** Host: the offer code. Guest: the reply code to show back. */
  code: string | null;
  /** Host: the link the other device opens. */
  link: string | null;
  error: string | null;
  /** Why a connection attempt failed (ICE candidates and check results), when known. */
  diagnostics: IceReport | null;
  peerName: string | null;
  route: RouteInfo | null;
  transfers: Transfer[];
}

const INITIAL: SessionState = { phase: 'idle', role: null, code: null, link: null, error: null, diagnostics: null, peerName: null, route: null, transfers: [] };

/** Give up if the connection doesn't come up this long after both codes are exchanged. */
export const CONNECT_TIMEOUT_MS = 25_000;

export const CONNECT_FAILED_MESSAGE =
  'Couldn’t connect the two devices directly.';

let state: SessionState = INITIAL;
const listeners = new Set<() => void>();
let emitTimer: ReturnType<typeof setTimeout> | null = null;

function emit() {
  if (emitTimer) {
    clearTimeout(emitTimer);
    emitTimer = null;
  }
  listeners.forEach((l) => l());
}

/** Progress updates arrive per 64 KB chunk; repaint at most ~8×/s. */
function emitSoon() {
  emitTimer ??= setTimeout(emit, 120);
}

function set(patch: Partial<SessionState>, soon = false) {
  state = { ...state, ...patch };
  if (soon) emitSoon();
  else emit();
}

function updateTransfer(id: string, patch: Partial<Transfer> | ((t: Transfer) => Partial<Transfer>), soon = false) {
  let changed = false;
  const transfers = state.transfers.map((t) => {
    if (t.id !== id) return t;
    changed = true;
    return { ...t, ...(typeof patch === 'function' ? patch(t) : patch) };
  });
  if (changed) set({ transfers }, soon);
}

function addTransfer(t: Transfer) {
  set({ transfers: [t, ...state.transfers] });
}

// ---------- connection internals (not part of the snapshot) ----------

let peer: Peer | null = null;
let receiver: Receiver | null = null;
let generation = 0;
let connectTimer: ReturnType<typeof setTimeout> | null = null;
const outgoing = new Map<string, File>();
const cancelledOut = new Set<string>();
let pumping = false;
let wakeLock: { release(): Promise<void> } | null = null;
const speedProbe = new Map<string, { t: number; bytes: number }>();

function measure(id: string, bytes: number): Partial<Transfer> {
  const now = performance.now();
  const last = speedProbe.get(id);
  if (!last) {
    speedProbe.set(id, { t: now, bytes });
    return { bytes };
  }
  const dt = (now - last.t) / 1000;
  if (dt < 0.5) return { bytes };
  speedProbe.set(id, { t: now, bytes });
  const instant = (bytes - last.bytes) / dt;
  const prev = state.transfers.find((t) => t.id === id)?.speed;
  return { bytes, speed: prev ? prev * 0.6 + instant * 0.4 : instant };
}

async function keepAwake(on: boolean) {
  const wl = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
  if (!on) {
    await wakeLock?.release().catch(() => {});
    wakeLock = null;
    return;
  }
  if (!wl || wakeLock || document.visibilityState !== 'visible') return;
  try {
    wakeLock = await wl.request('screen');
    (wakeLock as unknown as EventTarget).addEventListener?.('release', () => (wakeLock = null));
  } catch {
    /* not allowed (battery saver, iframe…): the transfer still works while the screen is on */
  }
}

if (typeof document !== 'undefined') {
  // The wake lock is dropped whenever the page is hidden; take it again on return.
  document.addEventListener('visibilitychange', () => {
    if (state.phase === 'connected') void keepAwake(true);
  });
  window.addEventListener('beforeunload', (e) => {
    if (state.phase === 'connected' && state.transfers.some((t) => t.status === 'active' || t.status === 'queued')) e.preventDefault();
  });
}

function clearConnectTimer() {
  if (connectTimer) clearTimeout(connectTimer);
  connectTimer = null;
}

function fail(message: string, diagnostics: IceReport | null = null) {
  clearConnectTimer();
  closePeer();
  set({ phase: 'failed', error: message, diagnostics });
}

/** The connection didn't come up: read the ICE stats before closing, so the UI can say why. */
async function failToConnect(gen: number) {
  const p = peer;
  let report: IceReport | null = null;
  if (p) {
    try {
      report = await iceReport(p.pc);
    } catch {
      /* stats unavailable */
    }
  }
  if (gen === generation) fail(CONNECT_FAILED_MESSAGE, report);
}

function closePeer() {
  const p = peer;
  peer = null;
  receiver?.abort('Connection lost');
  receiver = null;
  pumping = false;
  for (const t of state.transfers) {
    if (t.status === 'active' || t.status === 'queued') updateTransfer(t.id, { status: 'failed', error: 'Connection lost', finishedAt: Date.now() });
  }
  outgoing.clear();
  cancelledOut.clear();
  void keepAwake(false);
  if (p) {
    try {
      p.channel.close();
    } catch {
      /* already closed */
    }
    p.pc.close();
  }
}

function wire(p: Peer, gen: number) {
  const live = () => gen === generation;
  const { pc, channel } = p;

  receiver = new Receiver({
    onHello: (name) => live() && set({ peerName: name.trim().slice(0, 60) || 'Other device' }),
    onFileStart: (m) => {
      speedProbe.delete(m.id);
      addTransfer({ id: m.id, direction: 'in', kind: 'file', name: m.name, size: m.size, mime: m.mime, bytes: 0, status: 'active', startedAt: Date.now() });
    },
    onProgress: (id, bytes) => updateTransfer(id, measure(id, bytes), true),
    onFileDone: (id, blob) => {
      updateTransfer(id, { status: 'done', bytes: blob.size, blob, url: URL.createObjectURL(blob), finishedAt: Date.now(), speed: undefined });
      if (channel.readyState === 'open') sendCtl(channel, { t: 'ack', id });
    },
    onFileCancelled: (id) => updateTransfer(id, { status: 'cancelled', finishedAt: Date.now(), speed: undefined }),
    onFileFailed: (id, reason) => updateTransfer(id, { status: 'failed', error: reason, finishedAt: Date.now(), speed: undefined }),
    onText: (id, text) => addTransfer({ id, direction: 'in', kind: 'text', name: 'Text', size: text.length, mime: 'text/plain', bytes: text.length, status: 'done', text, finishedAt: Date.now() }),
    onCancelRequest: (id) => {
      cancelledOut.add(id);
      if (outgoing.has(id)) {
        outgoing.delete(id);
        updateTransfer(id, { status: 'cancelled', finishedAt: Date.now() });
      }
    },
    onAck: (id) => updateTransfer(id, { delivered: true }),
    onBye: () => {
      if (!live()) return;
      closePeer();
      set({ phase: 'closed', error: null });
    },
  });

  channel.onopen = () => {
    if (!live()) return;
    clearConnectTimer();
    set({ phase: 'connected', error: null });
    sendCtl(channel, { t: 'hello', v: PROTOCOL_VERSION, name: deviceName() });
    void keepAwake(true);
    setTimeout(() => {
      if (live() && peer) void describeRoute(pc).then((route) => live() && set({ route }));
    }, 300);
    void pump();
  };
  channel.onmessage = (e) => live() && receiver?.handle(e.data as string | ArrayBuffer);
  channel.onclose = () => {
    if (!live() || state.phase !== 'connected') return;
    closePeer();
    set({ phase: 'closed', error: 'The connection was closed.' });
  };
  pc.onconnectionstatechange = () => {
    if (!live()) return;
    // Only the guest: the host's connection can report 'connecting' as soon as the guest's
    // first checks arrive, before the reply code was entered. The host's phase moves to
    // 'connecting' in submitAnswer instead.
    if (pc.connectionState === 'connecting' && state.role === 'guest' && (state.phase === 'waiting' || state.phase === 'preparing')) set({ phase: 'connecting' });
    if (pc.connectionState === 'failed') {
      if (state.phase === 'connected') {
        closePeer();
        set({ phase: 'closed', error: 'Lost the connection to the other device.' });
      } else void failToConnect(gen);
    }
  };
}

function begin(role: Role): number {
  closePeer();
  revokeUrls();
  clearConnectTimer();
  generation++;
  state = { ...INITIAL, role, phase: 'preparing' };
  emit();
  return generation;
}

function errorText(e: unknown): string {
  if (e instanceof SignalError) return e.message;
  if (e instanceof Error) return `Something went wrong: ${e.message}`;
  return 'Something went wrong.';
}

// ---------- public actions ----------

/** Device A: create a pairing; `state.link` becomes the QR link for the other device. */
export async function startHost(pageUrl: string): Promise<void> {
  const gen = begin('host');
  try {
    const p = createPeer();
    peer = p;
    wire(p, gen);
    const code = await createOfferCode(p.pc);
    if (gen !== generation) return;
    set({ phase: 'waiting', code, link: joinLink(pageUrl, code) });
  } catch (e) {
    if (gen === generation) fail(errorText(e));
  }
}

/** Device A: the reply code scanned or pasted from device B. */
export async function submitAnswer(text: string): Promise<void> {
  if (!peer || state.role !== 'host' || state.phase !== 'waiting') return;
  const gen = generation;
  try {
    await applyAnswer(peer.pc, codeToSignal(text));
    if (gen !== generation) return;
    set({ phase: 'connecting', error: null });
    clearConnectTimer();
    connectTimer = setTimeout(() => gen === generation && state.phase === 'connecting' && void failToConnect(gen), CONNECT_TIMEOUT_MS);
  } catch (e) {
    // A wrong code (e.g. the pairing QR itself) shouldn't kill the pairing: show it and keep waiting.
    if (gen === generation) set({ error: errorText(e) });
  }
}

/** Device B: opened the link (or scanned/pasted the code); creates the reply code. */
export async function startGuest(codeText: string): Promise<void> {
  const gen = begin('guest');
  try {
    const offer = codeToSignal(codeText);
    const p = createPeer();
    peer = p;
    wire(p, gen);
    const code = await answerOffer(p.pc, offer);
    if (gen !== generation) return;
    // Leave 'connecting' to the connection state: B starts checking right away.
    set({ phase: state.phase === 'preparing' ? 'waiting' : state.phase, code });
  } catch (e) {
    if (gen === generation) fail(errorText(e));
  }
}

export function sendFiles(files: Iterable<File>): void {
  for (const file of files) {
    const id = newId();
    outgoing.set(id, file);
    addTransfer({ id, direction: 'out', kind: 'file', name: file.name || 'file', size: file.size, mime: file.type, bytes: 0, status: 'queued' });
  }
  void pump();
}

export function sendText(text: string): boolean {
  const value = text.slice(0, MAX_TEXT);
  if (!value.trim() || !peer || peer.channel.readyState !== 'open') return false;
  const id = newId();
  sendCtl(peer.channel, { t: 'text', id, text: value });
  addTransfer({ id, direction: 'out', kind: 'text', name: 'Text', size: value.length, mime: 'text/plain', bytes: value.length, status: 'done', text: value, finishedAt: Date.now() });
  return true;
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const p = peer;
      if (!p || p.channel.readyState !== 'open') return;
      const next = [...state.transfers].reverse().find((t) => t.direction === 'out' && t.status === 'queued' && outgoing.has(t.id));
      if (!next) return;
      const file = outgoing.get(next.id)!;
      updateTransfer(next.id, { status: 'active', startedAt: Date.now() });
      speedProbe.delete(next.id);
      // pc.sctp.maxMessageSize is already the smaller of both sides' limits.
      const chunkSize = Math.min(MAX_CHUNK, p.pc.sctp?.maxMessageSize || DEFAULT_CHUNK);
      try {
        const result = await sendFile(p.channel, file, { id: next.id, name: next.name }, {
          chunkSize,
          isCancelled: () => cancelledOut.has(next.id),
          onProgress: (bytes) => updateTransfer(next.id, measure(next.id, bytes), true),
        });
        updateTransfer(next.id, { status: result === 'done' ? 'done' : 'cancelled', finishedAt: Date.now(), speed: undefined });
      } catch {
        updateTransfer(next.id, { status: 'failed', error: 'Connection lost', finishedAt: Date.now(), speed: undefined });
      } finally {
        outgoing.delete(next.id);
        cancelledOut.delete(next.id);
      }
    }
  } finally {
    pumping = false;
  }
}

export function cancelTransfer(id: string): void {
  const t = state.transfers.find((x) => x.id === id);
  if (!t || (t.status !== 'queued' && t.status !== 'active')) return;
  if (t.direction === 'out') {
    if (t.status === 'queued') {
      outgoing.delete(id);
      updateTransfer(id, { status: 'cancelled', finishedAt: Date.now() });
    } else cancelledOut.add(id);
  } else if (receiver?.cancel(id) && peer?.channel.readyState === 'open') {
    sendCtl(peer.channel, { t: 'cancel', id });
  }
}

export function removeTransfer(id: string): void {
  const t = state.transfers.find((x) => x.id === id);
  if (!t || t.status === 'active' || t.status === 'queued') return;
  if (t.url) URL.revokeObjectURL(t.url);
  set({ transfers: state.transfers.filter((x) => x.id !== id) });
}

/** End the session politely (tells the other side) and go back to idle. */
export function disconnect(): void {
  if (peer?.channel.readyState === 'open') {
    try {
      sendCtl(peer.channel, { t: 'bye' });
    } catch {
      /* closing anyway */
    }
  }
  generation++;
  clearConnectTimer();
  closePeer();
  set({ phase: 'closed', error: null });
}

function revokeUrls() {
  for (const t of state.transfers) if (t.url) URL.revokeObjectURL(t.url);
}

/** Forget everything, including received files. */
export function resetSession(): void {
  disconnect();
  revokeUrls();
  state = INITIAL;
  emit();
}

export function getSession(): SessionState {
  return state;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useSession(): SessionState {
  return useSyncExternalStore(subscribe, getSession, getSession);
}

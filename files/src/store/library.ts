// The list everyone sees, plus the writes that change it (text items, delete).
// Refreshed on load, every 30 s while the tab is visible, and when it becomes visible again.
import { ApiError, callScript } from '../lib/api';
import { SCRIPT_URL } from '../lib/env';
import { parseItem, parseLibrary, type Item } from '../lib/items';
import { currentToken, endSession, openLogin } from './auth';
import { createStore } from './createStore';

export const REFRESH_MS = 30_000;

type LibraryState = {
  status: 'loading' | 'ready' | 'error';
  items: Item[];
  used: number;
  limit: number;
  error?: string;
  updatedAt: number;
};

export const library = createStore<LibraryState>({ status: 'loading', items: [], used: 0, limit: 0, updatedAt: 0 });

let generation = 0;
let changes = 0; // local adds/deletes; a list that started before one is out of date

export async function refresh(): Promise<void> {
  const gen = ++generation;
  const changesAtStart = changes;
  try {
    const reply = await callScript({ action: 'list' }, { url: SCRIPT_URL });
    if (gen !== generation) return;
    if (changes !== changesAtStart) return refresh();
    const lib = parseLibrary(reply);
    library.set({ status: 'ready', ...lib, updatedAt: Date.now() });
  } catch (err) {
    if (gen !== generation) return;
    const message = err instanceof ApiError ? err.message : 'Couldn’t load the files.';
    library.set((s) => ({ ...s, status: s.updatedAt ? 'ready' : 'error', error: message }));
  }
}

export function addItem(item: Item) {
  changes++;
  library.set((s) => {
    const old = s.items.find((i) => i.id === item.id);
    return { ...s, items: [item, ...s.items.filter((i) => i.id !== item.id)], used: s.used - (old?.size ?? 0) + item.size };
  });
}

export function removeItems(ids: readonly string[]) {
  changes++;
  const gone = new Set(ids);
  library.set((s) => {
    const freed = s.items.filter((i) => gone.has(i.id)).reduce((n, i) => n + i.size, 0);
    return { ...s, items: s.items.filter((i) => !gone.has(i.id)), used: Math.max(0, s.used - freed) };
  });
}

/** Needs the upload login; opens the password dialog (and throws) when there isn't one. */
function tokenOrAsk(): string {
  const token = currentToken();
  if (token) return token;
  openLogin('Enter the upload password first.');
  throw new ApiError('invalid');
}

/** Runs a write; an auth error ends the login and opens the password dialog. */
async function write<T extends object>(body: Record<string, unknown>): Promise<T & { ok: true }> {
  const token = tokenOrAsk();
  try {
    return await callScript<T>({ ...body, token }, { url: SCRIPT_URL, timeoutMs: 60_000 });
  } catch (err) {
    if (err instanceof ApiError && err.isAuth) openLogin(endSession(err.code));
    throw err;
  }
}

export async function addText(text: string): Promise<Item> {
  const reply = await write<{ item: unknown }>({ action: 'addText', text });
  const item = parseItem(reply.item);
  if (!item) throw new ApiError('server');
  addItem(item);
  return item;
}

/** Deletes permanently. Resolves with how many went; missing ones count as gone. */
export async function deleteItems(ids: readonly string[]): Promise<{ deleted: number; refused: number }> {
  let deleted = 0;
  let refused = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const reply = await write<{ deleted: string[]; missing: string[]; refused: string[] }>({ action: 'delete', ids: ids.slice(i, i + 200) });
    const gone = [...(reply.deleted ?? []), ...(reply.missing ?? [])];
    removeItems(gone);
    deleted += gone.length;
    refused += reply.refused?.length ?? 0;
  }
  return { deleted, refused };
}

const texts = new Map<string, string>();
/** Full text of a text item (cached). */
export async function loadText(id: string): Promise<string> {
  const cached = texts.get(id);
  if (cached !== undefined) return cached;
  const reply = await callScript<{ text: string }>({ action: 'text', id }, { url: SCRIPT_URL });
  const text = typeof reply.text === 'string' ? reply.text : '';
  texts.set(id, text);
  return text;
}

let watching = false;
export function startLibraryWatch() {
  if (watching) return;
  watching = true;
  void refresh();
  setInterval(() => {
    if (document.visibilityState === 'visible') void refresh();
  }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - library.get().updatedAt > 10_000) void refresh();
  });
}

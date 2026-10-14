import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Engine, type EngineStatus } from '../lib/engine';
import { History } from '../lib/history';
import type { EditPatch } from '../lib/mask';
import { cachedUrls } from '../lib/modelCache';
import { MODELS, planRun, type Capabilities, type ModelId } from '../lib/models';
import { loadPrefs, savePrefs, type Prefs } from '../lib/prefs';
import { emptyQueue, nextToProcess, queueReducer, type QueueAction, type QueueState } from '../lib/queue';

/** Binary data per image. Kept outside React state: it's large and changes in place while painting. */
export interface ItemData {
  file: File;
  /** Object URL of the original file (for the "before" view and the queue thumbnail). */
  url: string;
  mask: Uint8Array | null;
  edits: Int8Array | null;
  thumbUrl: string | null;
  history: History<EditPatch>;
}

const patchBytes = (p: EditPatch) => p.before.byteLength + p.after.byteLength;
const newHistory = () => new History<EditPatch>(60, 256 * 1024 * 1024, patchBytes);

export const ACCEPT = 'image/png,image/jpeg,image/webp,image/heic,image/heif,image/avif,image/gif,image/bmp,.heic,.heif';
const IMAGE_EXT = /\.(png|jpe?g|webp|heic|heif|avif|gif|bmp)$/i;
export const isImageFile = (f: File) => f.type.startsWith('image/') || IMAGE_EXT.test(f.name);

interface Store {
  queue: QueueState;
  dispatch: (a: QueueAction) => void;
  prefs: Prefs;
  setPrefs: (patch: Partial<Prefs>) => void;
  engine: Engine;
  status: EngineStatus;
  caps: Capabilities | null;
  /** Which models' weights are already in the cache. */
  cached: Partial<Record<ModelId, boolean>>;
  /** Models the user agreed to download this session. */
  allowed: ReadonlySet<ModelId>;
  allowModel: (m: ModelId) => void;
  addFiles: (files: File[]) => void;
  data: (id: string) => ItemData | undefined;
  removeItem: (id: string) => void;
  clearAll: () => void;
  rerun: (ids: string[], model: ModelId) => void;
  bgImage: { bitmap: ImageBitmap; name: string; url: string } | null;
  setBgImage: (file: File | null) => Promise<void>;
  refreshCache: () => void;
}

const Ctx = createContext<Store | null>(null);

let seq = 0;
const newId = () => `${Date.now().toString(36)}-${(++seq).toString(36)}`;

export function AppProvider({ children, engine: injected, initialQueue }: { children: ReactNode; engine?: Engine; initialQueue?: QueueState }) {
  const [queue, dispatch] = useReducer(queueReducer, initialQueue ?? emptyQueue());
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
  const [engine] = useState(() => injected ?? new Engine());
  const status = useSyncExternalStore(engine.subscribe, engine.getStatus, engine.getStatus);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [cached, setCached] = useState<Partial<Record<ModelId, boolean>>>({});
  const [allowed, setAllowed] = useState<ReadonlySet<ModelId>>(new Set());
  const [bgImage, setBg] = useState<Store['bgImage']>(null);
  const dataRef = useRef(new Map<string, ItemData>());
  const running = useRef<string | null>(null);
  const [tick, kick] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    let live = true;
    engine.caps.then((c) => live && setCaps(c));
    return () => {
      live = false;
    };
  }, [engine]);

  const refreshCache = useCallback(() => {
    if (!caps) return;
    cachedUrls().then((urls) => {
      const set = new Set(urls);
      const next: Partial<Record<ModelId, boolean>> = {};
      for (const m of MODELS) {
        const plan = planRun(m, caps);
        next[m.id] = Boolean(plan && set.has(plan.url));
      }
      setCached(next);
    });
  }, [caps]);
  useEffect(refreshCache, [refreshCache]);

  const setPrefs = useCallback((patch: Partial<Prefs>) => {
    setPrefsState((p) => {
      const next = { ...p, ...patch };
      savePrefs(next);
      return next;
    });
  }, []);

  // Items still waiting in the queue follow the selected model.
  const prevModel = useRef(prefs.model);
  useEffect(() => {
    if (prevModel.current === prefs.model) return;
    prevModel.current = prefs.model;
    const waiting = queue.items.filter((i) => i.status === 'queued' && i.model !== prefs.model).map((i) => i.id);
    if (waiting.length) dispatch({ type: 'requeue', ids: waiting, model: prefs.model });
  }, [prefs.model, queue.items]);

  const allowModel = useCallback((m: ModelId) => setAllowed((s) => new Set([...s, m])), []);

  const addFiles = useCallback(
    (files: File[]) => {
      const items = files.filter(isImageFile).map((file) => {
        const id = newId();
        dataRef.current.set(id, { file, url: URL.createObjectURL(file), mask: null, edits: null, thumbUrl: null, history: newHistory() });
        return { id, name: file.name || 'pasted image', bytes: file.size };
      });
      if (items.length) dispatch({ type: 'add', items, model: prefs.model });
    },
    [prefs.model],
  );

  const disposeData = (d: ItemData) => {
    URL.revokeObjectURL(d.url);
    if (d.thumbUrl) URL.revokeObjectURL(d.thumbUrl);
  };

  const removeItem = useCallback((id: string) => {
    const d = dataRef.current.get(id);
    if (d) disposeData(d);
    dataRef.current.delete(id);
    dispatch({ type: 'remove', id });
  }, []);

  const clearAll = useCallback(() => {
    for (const d of dataRef.current.values()) disposeData(d);
    dataRef.current.clear();
    dispatch({ type: 'clear' });
  }, []);

  const rerun = useCallback((ids: string[], model: ModelId) => dispatch({ type: 'requeue', ids, model }), []);

  const setBgImage = useCallback(async (file: File | null) => {
    setBg((old) => {
      if (old) {
        old.bitmap.close();
        URL.revokeObjectURL(old.url);
      }
      return null;
    });
    if (!file) return;
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    setBg({ bitmap, name: file.name, url: URL.createObjectURL(file) });
  }, []);

  // The processing loop: one image at a time, in queue order.
  useEffect(() => {
    if (running.current || !caps) return;
    const next = nextToProcess(queue);
    if (!next) return;
    const model = next.model;
    const spec = MODELS.find((m) => m.id === model)!;
    const d = dataRef.current.get(next.id);
    if (!d) return;
    if (!planRun(spec, caps)) {
      running.current = next.id;
      dispatch({ type: 'start', id: next.id });
      dispatch({ type: 'fail', id: next.id, error: `${spec.name} needs WebGPU, which this browser doesn’t offer. Pick another model.` });
      running.current = null;
      return;
    }
    if (!cached[model] && !allowed.has(model)) return; // waiting for the user to agree to the download
    running.current = next.id;
    dispatch({ type: 'start', id: next.id });
    engine
      .run(model, d.file)
      .then((res) => {
        running.current = null;
        const cur = dataRef.current.get(next.id);
        if (cur) {
          cur.mask = res.mask;
          cur.edits = null;
          cur.history.clear();
          if (cur.thumbUrl) URL.revokeObjectURL(cur.thumbUrl);
          cur.thumbUrl = res.thumb ? URL.createObjectURL(res.thumb) : null;
          dispatch({ type: 'done', id: next.id, width: res.width, height: res.height, backend: res.backend, ms: res.ms });
        }
        if (!cached[model]) refreshCache();
      })
      .catch((e: Error) => {
        running.current = null;
        dispatch({ type: 'fail', id: next.id, error: e.message });
      })
      // Re-run this effect even if the item vanished meanwhile (nothing else would trigger it).
      .finally(kick);
  }, [queue, caps, cached, allowed, engine, refreshCache, tick]);

  useEffect(
    () => () => {
      engine.terminate();
    },
    [engine],
  );

  const data = useCallback((id: string) => dataRef.current.get(id), []);

  const value = useMemo<Store>(
    () => ({ queue, dispatch, prefs, setPrefs, engine, status, caps, cached, allowed, allowModel, addFiles, data, removeItem, clearAll, rerun, bgImage, setBgImage, refreshCache }),
    [queue, prefs, setPrefs, engine, status, caps, cached, allowed, allowModel, addFiles, data, removeItem, clearAll, rerun, bgImage, setBgImage, refreshCache],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useApp outside AppProvider');
  return s;
}

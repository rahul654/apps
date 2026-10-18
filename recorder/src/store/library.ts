import { useCallback, useEffect, useState } from 'react';
import { recordingStore, type RecordingMeta } from '../lib/recordingStore';
import { screenshotStore, type ScreenshotMeta } from '../lib/screenshotStore';

const events = new EventTarget();
let channel: BroadcastChannel | null = null;
try {
  channel = new BroadcastChannel('recorder:library');
  channel.onmessage = () => events.dispatchEvent(new Event('change'));
} catch {
  channel = null;
}

/** Tell every open view (this tab and others) that recordings changed. */
export function notifyLibraryChanged(): void {
  events.dispatchEvent(new Event('change'));
  channel?.postMessage('change');
}

export function useLibrary(): { items: RecordingMeta[] | null; error: string | null; reload: () => void } {
  const [items, setItems] = useState<RecordingMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    recordingStore()
      .list()
      .then((list) => {
        setItems(list.filter((m) => m.status === 'complete'));
        setError(null);
      })
      .catch((e) => setError((e as Error)?.message ?? String(e)));
  }, []);
  useEffect(() => {
    reload();
    const on = () => reload();
    events.addEventListener('change', on);
    return () => events.removeEventListener('change', on);
  }, [reload]);
  return { items, error, reload };
}

export function useScreenshots(): { items: ScreenshotMeta[] | null; error: string | null } {
  const [items, setItems] = useState<ScreenshotMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const reload = () =>
      screenshotStore()
        .list()
        .then((list) => {
          if (!alive) return;
          setItems(list);
          setError(null);
        })
        .catch((e) => alive && setError((e as Error)?.message ?? String(e)));
    void reload();
    events.addEventListener('change', reload);
    return () => {
      alive = false;
      events.removeEventListener('change', reload);
    };
  }, []);
  return { items, error };
}

/** Object URL for a recording's or screenshot's thumbnail; revoked on unmount / change. */
export function useThumbnail(id: string, hasThumb: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!hasThumb) {
      setUrl(null);
      return;
    }
    let u: string | null = null;
    let cancelled = false;
    void recordingStore()
      .getThumbnail(id)
      .then((b) => {
        if (cancelled || !b) return;
        u = URL.createObjectURL(b);
        setUrl(u);
      });
    return () => {
      cancelled = true;
      if (u) URL.revokeObjectURL(u);
    };
  }, [id, hasThumb]);
  return url;
}

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { isBusy } from '../lib/recorderMachine';
import { matchShortcut } from '../lib/shortcuts';
import { RecorderController, type Snapshot } from '../media/controller';
import { notifyLibraryChanged } from './library';

const Ctx = createContext<RecorderController | null>(null);

/** One controller for the whole app, so a recording survives navigating to the library. */
export function RecorderProvider({ children }: { children: ReactNode }) {
  const [controller] = useState(() => new RecorderController());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const action = matchShortcut(
        { code: e.code, key: e.key, altKey: e.altKey, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, repeat: e.repeat, targetTag: t?.tagName, targetEditable: t?.isContentEditable },
        { countdown: controller.getSnapshot().rec.phase === 'countdown' },
      );
      if (!action) return;
      e.preventDefault();
      if (action === 'toggle-record') controller.toggleRecord();
      else if (action === 'toggle-pause') controller.togglePause();
      else if (action === 'skip-countdown') controller.skipCountdown();
      else if (action === 'cancel-countdown') controller.cancel();
    };
    // Warn before closing mid-recording (the chunks so far are safe and recoverable anyway).
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isBusy(controller.getSnapshot().rec.phase)) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const onPageHide = (e: PageTransitionEvent) => {
      if (!e.persisted) controller.dispose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);
    // A saved recording (and later its thumbnail) shows up in open library views.
    let prevSaved = controller.getSnapshot().lastSaved;
    const unsub = controller.subscribe(() => {
      const saved = controller.getSnapshot().lastSaved;
      if (saved !== prevSaved) {
        prevSaved = saved;
        if (saved) notifyLibraryChanged();
      }
    });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
      unsub();
    };
  }, [controller]);

  return <Ctx.Provider value={controller}>{children}</Ctx.Provider>;
}

export function useController(): RecorderController {
  const c = useContext(Ctx);
  if (!c) throw new Error('useController outside RecorderProvider');
  return c;
}

export function useRecorder(): Snapshot {
  const c = useController();
  return useSyncExternalStore(c.subscribe, c.getSnapshot, c.getSnapshot);
}

import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { isBusy } from '../lib/recorderMachine';
import { matchShortcut } from '../lib/shortcuts';
import { RecorderController, type Snapshot } from '../media/controller';
import { notifyLibraryChanged } from './library';
import { cancelScreenshot, captureNow, importImage, reportShotError, takeScreenshot, useShot } from './screenshot';

const Ctx = createContext<RecorderController | null>(null);

/** One controller for the whole app, so a recording survives navigating to the library. */
export function RecorderProvider({ children }: { children: ReactNode }) {
  const [controller] = useState(() => new RecorderController());

  useEffect(() => {
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
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
      unsub();
    };
  }, [controller]);

  return (
    <Ctx.Provider value={controller}>
      <Shortcuts controller={controller} />
      {children}
    </Ctx.Provider>
  );
}

/** Screenshot from a click or the shortcut: grabs from the recorded screen when there is one. */
export function useTakeScreenshot(): () => void {
  const c = useController();
  const navigate = useNavigate();
  return () => {
    const s = c.getSnapshot();
    const track = s.screen?.getVideoTracks()[0] ?? null;
    void takeScreenshot({ delaySec: s.prefs.shotDelay, recordingTrack: track }).then((shot) => {
      // While recording, stay put; the record page shows a notice for the new screenshot.
      if (shot && !track) navigate(`/shot/${shot.id}`);
    });
  };
}

/** Opens an image file (or pasted image) in the screenshot editor. */
export function useOpenImage(): (file: Blob) => void {
  const navigate = useNavigate();
  return (file) => {
    importImage(file)
      .then((m) => navigate(`/shot/${m.id}`))
      .catch((e) => reportShotError('Couldn’t open the image', e));
  };
}

function Shortcuts({ controller }: { controller: RecorderController }) {
  const takeShot = useTakeScreenshot();
  const openImage = useOpenImage();
  const shotCountdown = useShot().phase === 'countdown';
  const latest = useRef({ takeShot, shotCountdown, openImage });
  latest.current = { takeShot, shotCountdown, openImage };

  // Pasting an image anywhere (outside text fields) opens it for annotation.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (!file) return;
      e.preventDefault();
      latest.current.openImage(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const { takeShot, shotCountdown } = latest.current;
      const action = matchShortcut(
        { code: e.code, key: e.key, altKey: e.altKey, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, repeat: e.repeat, targetTag: t?.tagName, targetEditable: t?.isContentEditable },
        { countdown: shotCountdown || controller.getSnapshot().rec.phase === 'countdown' },
      );
      if (!action) return;
      e.preventDefault();
      if (action === 'toggle-record') controller.toggleRecord();
      else if (action === 'toggle-pause') controller.togglePause();
      else if (action === 'screenshot') takeShot();
      else if (action === 'skip-countdown') {
        if (shotCountdown) captureNow();
        else controller.skipCountdown();
      } else if (action === 'cancel-countdown') {
        if (shotCountdown) cancelScreenshot();
        else controller.cancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller]);
  return null;
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

import { useLocation } from 'react-router-dom';
import { useTakeScreenshot } from '../store/RecorderContext';
import { cancelScreenshot, captureNow, dismissShotError, useShot } from '../store/screenshot';
import { Notice } from './Feedback';

/** Screenshot countdown and errors on every page (the shortcut works anywhere). */
export function ShotStatus() {
  const shot = useShot();
  const takeShot = useTakeScreenshot();
  const { pathname } = useLocation();
  // The record page shows the countdown over its preview instead.
  const showBar = pathname !== '/' && (shot.phase === 'countdown' || shot.phase === 'picking');
  return (
    <>
      {showBar && (
        <Notice
          kind="info"
          actions={
            shot.phase === 'countdown' ? (
              <>
                <button type="button" className="btn small primary" onClick={() => captureNow()}>
                  Take it now
                </button>
                <button type="button" className="btn small" onClick={() => cancelScreenshot()}>
                  Cancel
                </button>
              </>
            ) : undefined
          }
        >
          {shot.phase === 'countdown' ? (
            <>
              <strong>Screenshot in {shot.secondsLeft} s</strong> · switch to the window you want to capture.
            </>
          ) : (
            'Pick a screen, window or tab to capture…'
          )}
        </Notice>
      )}
      {shot.error && (
        <Notice
          kind="error"
          onDismiss={() => dismissShotError()}
          actions={
            shot.error.canRetry ? (
              <button type="button" className="btn small primary" onClick={takeShot}>
                Try again
              </button>
            ) : undefined
          }
        >
          <strong>{shot.error.title}.</strong> {shot.error.message}
        </Notice>
      )}
    </>
  );
}

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CopyButton } from '../components/CopyButton';
import { FailureCard } from '../components/FailureCard';
import { QrCode } from '../components/QrCode';
import { startGuest, useSession } from '../store/session';

let lastOffer = '';

type Step = 'checking' | 'ask' | 'go';

/**
 * Browsers hide a page's local IP (behind a random `.local` name) until the site has camera or
 * microphone permission. A granted permission is enough, the camera needn't be running. Without
 * the real IP, a laptop whose firewall drops incoming traffic (Ubuntu's ufw default) can't be
 * reached and can't reach us either, so ask once before making the reply code.
 */
async function cameraPermission(): Promise<PermissionState | 'unknown'> {
  try {
    return (await navigator.permissions.query({ name: 'camera' as PermissionName })).state;
  } catch {
    return 'unknown';
  }
}

async function grantCameraOnce(): Promise<void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    stream.getTracks().forEach((t) => t.stop());
  } catch {
    /* refused or no camera: continue with the hidden address */
  }
}

/** Device B: opened the pairing link. Shows the reply code for device A to scan. */
export function GuestPage() {
  const { code = '' } = useParams();
  const s = useSession();
  const alreadyRunning = s.role === 'guest' && lastOffer === code && s.phase !== 'idle';
  const [step, setStep] = useState<Step>(alreadyRunning ? 'go' : 'checking');
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (step !== 'checking') return;
    let cancelled = false;
    void cameraPermission().then((state) => {
      // Ask only when the browser would show the prompt; 'granted' needs nothing, 'denied' can't be helped.
      if (!cancelled) setStep((state === 'prompt' || state === 'unknown') && typeof navigator.mediaDevices?.getUserMedia === 'function' ? 'ask' : 'go');
    });
    return () => {
      cancelled = true;
    };
  }, [step]);

  useEffect(() => {
    if (step !== 'go') return;
    // One pairing per link: StrictMode's double effect or re-renders must not start over.
    if (s.role === 'guest' && lastOffer === code && s.phase !== 'idle') return;
    lastOffer = code;
    void startGuest(code);
  }, [step, code, s.role, s.phase]);

  const allow = async () => {
    setAsking(true);
    await grantCameraOnce();
    setStep('go');
  };

  const ours = s.role === 'guest' && lastOffer === code;
  if (ours && s.phase === 'failed') {
    return (
      <div className="stack-lg narrow">
        <h1>Couldn’t connect</h1>
        <FailureCard error={s.error} diagnostics={s.diagnostics}>
          <p className="small muted">On the other device, choose <b>Start again</b> and scan the new code.</p>
          <Link to="/" className="btn">Home</Link>
        </FailureCard>
      </div>
    );
  }

  if (step === 'ask') {
    return (
      <div className="stack-lg narrow">
        <h1>One quick step</h1>
        <section className="card stack">
          <p>
            Allow the camera once so the other device can find this one on your Wi-Fi. Browsers hide a device’s Wi-Fi
            address from websites until they may use the camera.
          </p>
          <p className="small muted">The camera turns off straight away. Nothing is recorded or sent.</p>
          <div className="row wrap">
            <button type="button" className="btn primary" onClick={() => void allow()} disabled={asking}>
              {asking ? 'Waiting for permission…' : 'Allow camera and continue'}
            </button>
            <button type="button" className="btn ghost" onClick={() => setStep('go')} disabled={asking}>Continue without</button>
          </div>
          <p className="tiny muted">Without it, connecting can fail when the laptop has a firewall.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="stack-lg narrow">
      <h1>Almost there</h1>
      <section className="card stack center">
        <h2>Show this to the other device’s camera</h2>
        {ours && s.code ? (
          <>
            <QrCode value={s.code} label="Reply QR code" size={260} />
            <details className="small">
              <summary>No camera on the other device?</summary>
              <p className="muted">Copy this code and paste it there:</p>
              <div className="code-box mono tiny">{s.code}</div>
              <CopyButton text={s.code} label="Copy code" />
            </details>
            <p className="status small" role="status">
              <span className="spinner" aria-hidden="true" /> {s.phase === 'connecting' ? 'Connecting…' : 'Waiting for the other device to scan this…'}
            </p>
          </>
        ) : (
          <div className="qr placeholder"><span className="muted small">Preparing…</span></div>
        )}
      </section>
    </div>
  );
}

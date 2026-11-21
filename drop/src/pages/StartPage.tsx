import { useCallback, useEffect, useRef, useState } from 'react';
import { CopyButton } from '../components/CopyButton';
import { FailureCard } from '../components/FailureCard';
import { QrCode } from '../components/QrCode';
import { Scanner } from '../components/Scanner';
import { getSession, startHost, submitAnswer, useSession } from '../store/session';

/**
 * Device A. The camera starts *before* the pairing code is made: once a page has camera access,
 * Chrome lists its real local IP instead of a random `.local` name, so the other device can
 * reach it on the same Wi-Fi without relying on mDNS.
 */
export function StartPage() {
  const s = useSession();
  const [pasted, setPasted] = useState('');
  const [attempt, setAttempt] = useState(0);
  const started = useRef(-1);

  const begin = useCallback(() => {
    if (started.current === attempt) return;
    started.current = attempt;
    // Coming back to this page must not throw away a pairing that is still in progress or live.
    const cur = getSession();
    if (attempt === 0 && cur.role === 'host' && ['preparing', 'waiting', 'connecting', 'connected'].includes(cur.phase)) return;
    void startHost(window.location.href);
  }, [attempt]);

  // If the camera never answers (no device, permission prompt ignored), start anyway.
  useEffect(() => {
    const t = setTimeout(begin, 6000);
    return () => clearTimeout(t);
  }, [begin]);

  const ours = s.role === 'host';
  const waiting = ours && s.phase === 'waiting';
  const restart = () => setAttempt((a) => a + 1);

  return (
    <div className="stack-lg">
      <h1>Show a code</h1>
      {ours && s.phase === 'failed' ? (
        <FailureCard error={s.error} diagnostics={s.diagnostics}>
          <button type="button" className="btn primary" onClick={restart}>Start again</button>
        </FailureCard>
      ) : (
        <div className="pair-grid">
          <section className="card stack center">
            <h2><span className="num">1</span> Scan this with your phone</h2>
            {ours && s.link ? (
              <>
                <QrCode value={s.link} label="QR code with the pairing link" />
                <div className="row center">
                  <CopyButton text={s.link} label="Copy link" />
                </div>
                <p className="tiny muted">Use the phone’s normal camera app. The link holds the pairing code; it never reaches a server.</p>
              </>
            ) : (
              <div className="qr placeholder"><span className="muted small">Preparing…</span></div>
            )}
          </section>

          <section className="card stack">
            <h2><span className="num">2</span> Show the phone’s reply code here</h2>
            <Scanner key={attempt} onReady={begin} onCode={(text) => waiting && void submitAnswer(text)} paused={!waiting} />
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                void submitAnswer(pasted);
              }}
            >
              <input className="input grow mono" placeholder="…or paste the reply code" value={pasted} onChange={(e) => setPasted(e.target.value)} disabled={!waiting} aria-label="Reply code" />
              <button type="submit" className="btn primary" disabled={!waiting || !pasted.trim()}>Connect</button>
            </form>
            {ours && s.error && s.phase === 'waiting' && <p className="error-text small" role="alert">{s.error}</p>}
            {ours && s.phase === 'connecting' && <p className="status small" role="status"><span className="spinner" aria-hidden="true" /> Connecting…</p>}
          </section>
        </div>
      )}
    </div>
  );
}

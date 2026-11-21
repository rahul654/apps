import { Link } from 'react-router-dom';
import { useSession } from '../store/session';

export function HomePage() {
  const s = useSession();
  return (
    <div className="stack-lg">
      <section className="hero">
        <h1>Send files between your phone and laptop</h1>
        <p className="lead">Directly from one device to the other, end-to-end encrypted. No app, no account, no upload.</p>
      </section>

      {s.phase === 'connected' && (
        <Link to="/share" className="card card-link ok-card">
          <strong>Connected{s.peerName ? ` to ${s.peerName}` : ''}</strong>
          <span className="small muted">Back to sending files →</span>
        </Link>
      )}

      <div className="choices">
        <Link to="/start" className="card card-link choice">
          <span className="choice-icon" aria-hidden="true">▦</span>
          <strong>Show a code</strong>
          <span className="small muted">Start here on your laptop. It shows a QR code for your phone to scan.</span>
        </Link>
        <Link to="/join" className="card card-link choice">
          <span className="choice-icon" aria-hidden="true">⌖</span>
          <strong>Scan a code</strong>
          <span className="small muted">Use this device’s camera to scan the code on the other screen, or paste its link.</span>
        </Link>
      </div>

      <section className="card stack">
        <h2>How it works</h2>
        <ol className="steps">
          <li>Open Drop on your laptop and choose <b>Show a code</b>.</li>
          <li>Scan the QR code with your phone’s camera app. Drop opens and shows a reply code.</li>
          <li>Hold the phone up to the laptop’s camera (or copy the reply code across). You’re connected.</li>
        </ol>
        <p className="small muted">
          Works best on the same Wi-Fi. Different networks (e.g. phone on mobile data) usually work too. Some office and carrier
          networks block direct connections; then connect the laptop to your phone’s hotspot.
        </p>
        <p className="tiny muted">
          To find each other, both devices ask a public STUN server (Google, Cloudflare) for their own internet address. It
          sees only that address, never your files.
        </p>
      </section>
    </div>
  );
}

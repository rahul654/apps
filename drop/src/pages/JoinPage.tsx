import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Scanner } from '../components/Scanner';
import { codeToSignal, JOIN_ROUTE, signalToCode, SignalError } from '../lib/signal';

/** Scan (or paste) the pairing code from device A, then continue as device B. */
export function JoinPage() {
  const navigate = useNavigate();
  const [pasted, setPasted] = useState('');
  const [error, setError] = useState<string | null>(null);

  const use = (text: string) => {
    try {
      const signal = codeToSignal(text);
      if (signal.kind !== 'offer') throw new SignalError('That’s a reply code. Scan it on the device that shows the first QR code.');
      navigate(`${JOIN_ROUTE}${signalToCode(signal)}`);
    } catch (e) {
      setError(e instanceof SignalError ? e.message : 'That isn’t a Drop code.');
    }
  };

  return (
    <div className="stack-lg narrow">
      <h1>Scan a code</h1>
      <section className="card stack">
        <p className="small muted">Point this camera at the QR code on the other device.</p>
        <Scanner onCode={use} />
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            use(pasted);
          }}
        >
          <input className="input grow mono" placeholder="…or paste the link" value={pasted} onChange={(e) => setPasted(e.target.value)} aria-label="Pairing link or code" />
          <button type="submit" className="btn primary" disabled={!pasted.trim()}>Join</button>
        </form>
        {error && <p className="error-text small" role="alert">{error}</p>}
      </section>
    </div>
  );
}

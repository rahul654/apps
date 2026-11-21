import type { ReactNode } from 'react';
import type { IceReport } from '../lib/peer';
import { CopyButton } from './CopyButton';

/** A failed pairing: the message, the likely cause, what to try, and copyable details. */
export function FailureCard({ error, diagnostics, children }: { error: string | null; diagnostics: IceReport | null; children?: ReactNode }) {
  return (
    <div className="card stack">
      <p className="error-text" role="alert">{error ?? 'Couldn’t connect.'}</p>
      {diagnostics && <p className="small">{diagnostics.hint}</p>}
      <p className="small muted">
        Other things to try: connect the laptop to the phone’s hotspot (always works), or, on a laptop with a firewall,
        allow incoming connections from your home network.
      </p>
      {children}
      {diagnostics && (
        <details className="small">
          <summary>Technical details</summary>
          <pre className="code-box mono tiny pre">{diagnostics.text}</pre>
          <CopyButton text={`${diagnostics.hint}\n\n${diagnostics.text}`} label="Copy details" className="btn small" />
        </details>
      )}
    </div>
  );
}

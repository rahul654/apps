import type { ReactNode } from 'react';
import type { ErrorInfo } from '../lib/errors';
import { IconAlert, IconInfo } from './Icons';

export function Callout({ kind = 'info', title, children, role }: { kind?: 'info' | 'warn' | 'error'; title?: ReactNode; children?: ReactNode; role?: 'alert' | 'status' }) {
  return (
    <div className={`callout ${kind}`} role={role}>
      {kind === 'info' ? <IconInfo /> : <IconAlert />}
      <div className="stack-xs">
        {title && <strong>{title}</strong>}
        {children && <div className="small">{children}</div>}
      </div>
    </div>
  );
}

export function ErrorCallout({ error, onRetry }: { error: ErrorInfo; onRetry?: () => void }) {
  return (
    <Callout kind="error" title={error.title} role="alert">
      <p>{error.message}</p>
      {error.canRetry && onRetry && (
        <button type="button" className="btn small mt-sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </Callout>
  );
}

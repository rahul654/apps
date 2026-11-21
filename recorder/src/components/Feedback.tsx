import type { ReactNode } from 'react';
import { IconX } from './Icons';

export type NoticeKind = 'info' | 'warn' | 'error' | 'success';

export function Notice({ kind = 'info', children, onDismiss, actions }: { kind?: NoticeKind; children: ReactNode; onDismiss?: () => void; actions?: ReactNode }) {
  return (
    <div className={`notice ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <div className="notice-body">{children}</div>
      {actions && <div className="notice-actions">{actions}</div>}
      {onDismiss && (
        <button type="button" className="btn ghost small icon" onClick={onDismiss} aria-label="Dismiss">
          <IconX size={16} />
        </button>
      )}
    </div>
  );
}

/** value in 0–1; undefined = indeterminate. */
export function ProgressBar({ value, label }: { value?: number; label: string }) {
  const pct = value === undefined ? undefined : Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className={pct === undefined ? 'progress indeterminate' : 'progress'} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <div style={pct === undefined ? undefined : { width: `${pct}%` }} />
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="row loading" role="status">
      <span className="spinner" aria-hidden="true" /> <span className="muted">{label}</span>
    </div>
  );
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

import type { ReactNode } from 'react';

export type NoticeKind = 'info' | 'warn' | 'error' | 'success';

const ICONS: Record<NoticeKind, string> = { info: 'ℹ️', warn: '⚠️', error: '⛔', success: '✅' };

export function Notice({ kind = 'info', children, onDismiss }: { kind?: NoticeKind; children: ReactNode; onDismiss?: () => void }) {
  return (
    <div className={`notice ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <span className="notice-icon" aria-hidden="true">{ICONS[kind]}</span>
      <div className="notice-body">{children}</div>
      {onDismiss && (
        <button type="button" className="btn ghost small icon" onClick={onDismiss} aria-label="Dismiss">
          ✕
        </button>
      )}
    </div>
  );
}

/** value in 0–1; undefined = indeterminate. */
export function ProgressBar({ value, label }: { value?: number; label?: string }) {
  const pct = value === undefined ? undefined : Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div
      className={pct === undefined ? 'progress indeterminate' : 'progress'}
      role="progressbar"
      aria-label={label ?? 'Progress'}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      <div style={pct === undefined ? undefined : { width: `${pct}%` }} />
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="row" style={{ padding: 24, justifyContent: 'center' }} role="status">
      <span className="spinner" aria-hidden="true" /> <span className="muted">{label}</span>
    </div>
  );
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

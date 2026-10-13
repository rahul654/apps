import { useId, type ReactNode } from 'react';

interface SegmentedProps<T extends string | number> {
  label: string;
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (v: T) => void;
  hideLabel?: boolean;
}

/** Radio group styled as a segmented control (native arrow-key navigation). */
export function Segmented<T extends string | number>({ label, value, options, onChange, hideLabel }: SegmentedProps<T>) {
  const name = useId();
  return (
    <fieldset className="segmented-field">
      <legend className={hideLabel ? 'sr-only' : 'control-label'}>{label}</legend>
      <div className="segmented">
        {options.map((o) => (
          <label key={String(o.value)} title={o.title} className={o.value === value ? 'active' : ''}>
            <input type="radio" name={name} value={String(o.value)} checked={o.value === value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function Checkbox({ label, checked, onChange, title }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; title?: string }) {
  return (
    <label className="checkbox" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Toolbar({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`toolbar ${className}`}>{children}</div>;
}

export function Notice({ kind = 'info', children, title }: { kind?: 'info' | 'ok' | 'warn' | 'error'; children: ReactNode; title?: string }) {
  return (
    <div className={`notice notice-${kind}`} role={kind === 'error' || kind === 'warn' ? 'alert' : 'status'}>
      <span className="notice-icon" aria-hidden="true">
        {kind === 'ok' ? '✓' : kind === 'error' ? '✕' : kind === 'warn' ? '!' : 'i'}
      </span>
      <div>
        {title && <strong>{title} </strong>}
        {children}
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  children: (id: string) => ReactNode;
  hint?: ReactNode;
  className?: string;
}

/** Label + control wrapper; the render prop receives the id to put on the control. */
export function Field({ label, children, hint, className = '' }: FieldProps) {
  const id = useId();
  return (
    <div className={`field ${className}`}>
      <label htmlFor={id} className="control-label">
        {label}
      </label>
      {children(id)}
      {hint && <small className="muted">{hint}</small>}
    </div>
  );
}

import { forwardRef, useId, type ReactNode } from 'react';
import { useDebounced } from '../hooks/useDebounced';
import { formatBytes } from '../lib/clipboard';
import { CopyButton } from './CopyButton';

interface Props {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  rows?: number;
  onSample?: () => void;
  onClear?: () => void;
  /** Show a Copy button (default: true for read-only areas). */
  copy?: boolean;
  /** Extra buttons in the header. */
  actions?: ReactNode;
  invalid?: boolean;
  /** Text shown at the bottom right (defaults to size). */
  footer?: ReactNode;
  className?: string;
  wrap?: boolean;
  describedBy?: string;
}

const encoder = new TextEncoder();

/** Monospace textarea with a header (label + Sample/Clear/Copy) used for all tool inputs and outputs. */
export const CodeArea = forwardRef<HTMLTextAreaElement, Props>(function CodeArea(
  { label, value, onChange, placeholder, rows = 10, onSample, onClear, copy, actions, invalid, footer, className = '', wrap = true, describedBy },
  ref,
) {
  const id = useId();
  const readOnly = !onChange;
  const showCopy = copy ?? readOnly;
  // Size info is computed lazily so typing in multi-MB inputs stays smooth.
  const sizeSource = useDebounced(value, value.length > 200_000 ? 400 : 0);
  const sizeText = sizeSource ? `${sizeSource.length.toLocaleString()} chars${sizeSource.length <= 2_000_000 ? ` · ${formatBytes(encoder.encode(sizeSource).length)}` : ''}` : '\u00a0';
  return (
    <div className={`code-area ${invalid ? 'is-invalid' : ''} ${className}`}>
      <div className="code-area-head">
        <label htmlFor={id} className="control-label">
          {label}
        </label>
        <div className="code-area-actions">
          {actions}
          {onSample && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={onSample}>
              Sample
            </button>
          )}
          {onClear && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={onClear} disabled={value === ''}>
              Clear
            </button>
          )}
          {showCopy && <CopyButton text={value} ariaLabel={`Copy ${label}`} />}
        </div>
      </div>
      <textarea
        ref={ref}
        id={id}
        className="mono"
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        readOnly={readOnly}
        placeholder={placeholder}
        rows={rows}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        wrap={wrap ? 'soft' : 'off'}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
      />
      <div className="code-area-foot muted">{footer ?? sizeText}</div>
    </div>
  );
});

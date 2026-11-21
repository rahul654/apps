import { useEffect, useRef, useState } from 'react';
import { copyText } from '../lib/clipboard';

interface Props {
  /** Text to copy, or a function producing it (evaluated on click). */
  text: string | (() => string);
  label?: string;
  /** Accessible name when the visible label is generic, e.g. "Copy SHA-256". */
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
}

export function CopyButton({ text, label = 'Copy', ariaLabel, className = '', disabled }: Props) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onClick = async () => {
    const value = typeof text === 'function' ? text() : text;
    const ok = await copyText(value);
    setState(ok ? 'copied' : 'failed');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 1500);
  };

  const isEmpty = typeof text === 'string' && text === '';
  return (
    <button type="button" className={`btn btn-sm copy-btn ${state === 'copied' ? 'is-copied' : ''} ${className}`} onClick={onClick} disabled={disabled ?? isEmpty} aria-label={ariaLabel}>
      <span aria-hidden="true">{state === 'copied' ? '✓' : '⧉'}</span>
      <span>{state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}</span>
      <span className="sr-only" aria-live="polite">
        {state === 'copied' ? 'Copied to clipboard' : ''}
      </span>
    </button>
  );
}

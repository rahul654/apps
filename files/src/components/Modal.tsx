import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

let openCount = 0;

/**
 * A dialog in a portal on document.body (a div role=dialog: jsdom has no <dialog>).
 * Escape and the backdrop close it; Tab stays inside; focus goes back where it was on close.
 */
export function Modal({
  title,
  onClose,
  children,
  size = 'sm',
  className = '',
  initialFocus,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  size?: 'sm' | 'lg';
  className?: string;
  /** CSS selector inside the dialog to focus first */
  initialFocus?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const el = ref.current!;
    const first = (initialFocus && el.querySelector<HTMLElement>(initialFocus)) || el;
    first.focus();
    if (openCount++ === 0) document.body.classList.add('modal-open');
    return () => {
      if (--openCount === 0) document.body.classList.remove('modal-open');
      if (before?.isConnected) before.focus();
    };
  }, [initialFocus]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close.current();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...ref.current!.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close.current()}>
      <div ref={ref} className={`dialog dialog-${size} ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
        <div id={titleId} className="sr-only">
          {title}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Accessible modal: focus moves in (first field, else the first button), Tab stays inside, Escape
 * cancels, and focus returns to where it was. A div rather than <dialog>, which jsdom lacks.
 */
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE = 'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export function Modal({ title, children, onCancel, footer, initialFocus }: { title: string; children: ReactNode; onCancel: () => void; footer: ReactNode; initialFocus?: string }) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const cancel = useRef(onCancel);
  cancel.current = onCancel;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const el = box.current;
    const first = (initialFocus && el?.querySelector<HTMLElement>(initialFocus)) || el?.querySelector<HTMLElement>('input, select, textarea') || el?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => {
      if (before?.isConnected) before.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && cancel.current()}>
      <div
        ref={box}
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            cancel.current();
          } else if (e.key === 'Tab') {
            const items = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
            if (!items.length) return;
            const i = items.indexOf(document.activeElement as HTMLElement);
            if (e.shiftKey && i <= 0) {
              e.preventDefault();
              items[items.length - 1].focus();
            } else if (!e.shiftKey && i === items.length - 1) {
              e.preventDefault();
              items[0].focus();
            }
          }
        }}
      >
        <h2 id={`${id}-t`}>{title}</h2>
        <div className="stack-sm">{children}</div>
        <div className="modal-actions">{footer}</div>
      </div>
    </div>,
    document.body,
  );
}

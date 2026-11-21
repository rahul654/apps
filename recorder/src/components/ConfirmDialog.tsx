import { useEffect, useRef, type ReactNode } from 'react';

/** Modal confirm built on <dialog> (focus trap + Esc come from the browser). */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" aria-labelledby="confirm-title" onCancel={(e) => { e.preventDefault(); onCancel(); }}>
      <h2 id="confirm-title">{title}</h2>
      {children && <div className="dialog-body">{children}</div>}
      <div className="row dialog-actions">
        <button type="button" className="btn" onClick={onCancel} autoFocus>
          Cancel
        </button>
        <button type="button" className={danger ? 'btn danger-solid' : 'btn primary'} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

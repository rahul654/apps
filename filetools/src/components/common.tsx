import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { downloadBlob, zipBlobs, type OutputFile } from '../lib/download';
import { formatBytes } from '../lib/format';
import { errorMessage } from './Feedback';

export function ToolHeader({ emoji, title, children, back = true }: { emoji: string; title: string; children?: ReactNode; back?: boolean }) {
  return (
    <>
      {back && (
        <Link to="/" className="back-link">
          ← All tools
        </Link>
      )}
      <div className="page-head">
        <span className="emoji" aria-hidden="true">{emoji}</span>
        <div className="grow">
          <h1>{title}</h1>
          {children && <p>{children}</p>}
        </div>
      </div>
    </>
  );
}

/** Download one file directly, or several as a ZIP. */
export function DownloadButton({
  files,
  zipName = 'files.zip',
  label,
  primary = true,
  small = false,
}: {
  files: OutputFile[];
  zipName?: string;
  label?: string;
  primary?: boolean;
  small?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (files.length === 0) return null;
  const single = files.length === 1;
  const total = files.reduce((s, f) => s + f.blob.size, 0);
  const click = async () => {
    setErr(null);
    if (single) return downloadBlob(files[0].blob, files[0].name);
    setBusy(true);
    try {
      downloadBlob(await zipBlobs(files), zipName);
    } catch (e) {
      setErr(`Couldn’t create the ZIP: ${errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="stack-sm" style={{ display: 'inline-flex' }}>
      <button type="button" className={`btn${primary ? ' primary' : ''}${small ? ' small' : ''}`} onClick={click} disabled={busy}>
        <span aria-hidden="true">⬇</span>
        {busy ? 'Zipping…' : label ?? (single ? `Download (${formatBytes(total)})` : `Download all as ZIP (${files.length} files, ${formatBytes(total)})`)}
      </button>
      {err && <span className="danger-text small">{err}</span>}
    </span>
  );
}

/** Object URL for a Blob, revoked automatically when the blob changes or on unmount. */
export function useObjectUrl(blob: Blob | null | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) {
      setUrl(undefined);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close]), canvas[tabindex]');
    (first ?? ref.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && ref.current) {
        const items = Array.from(ref.current.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')).filter((el) => !el.hasAttribute('disabled'));
        if (items.length === 0) return;
        const firstEl = items[0];
        const lastEl = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1} style={wide ? { width: 'min(760px, 100%)' } : undefined}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="btn ghost small icon" onClick={onClose} aria-label="Close" data-close>
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode; disabled?: boolean }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} disabled={o.disabled} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

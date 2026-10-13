import { useEffect, useRef, useState } from 'react';
import { DropZone } from '../../components/DropZone';
import { errorMessage, Loading, Notice } from '../../components/Feedback';
import { formatBytes } from '../../lib/format';
import { ENCRYPTED_MESSAGE, loadPdf, PdfUserError } from '../../lib/pdf/ops';
import { isPdfFile, readBytes } from '../../lib/pdf/prepareImage';
import { isCancelled, openPdf, PasswordRequiredError, startRender, type PDFDocumentProxy } from '../../lib/pdf/pdfjs';

export const PDF_ACCEPT = 'application/pdf,.pdf';

export interface LoadedPdf {
  file: File;
  bytes: Uint8Array;
  doc: PDFDocumentProxy;
  /** Password the user entered (pdf.js only; pdf-lib can't decrypt). */
  password?: string;
}

/**
 * Pick one PDF and open it with pdf.js (for rendering). Asks for a password if
 * needed. `requireUnencrypted` shows the "can't modify encrypted PDFs" explanation
 * for tools that write with pdf-lib.
 */
export function usePdfPicker({ requireWritable = false }: { requireWritable?: boolean } = {}) {
  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needPassword, setNeedPassword] = useState<{ file: File; bytes: Uint8Array; incorrect: boolean } | null>(null);
  const current = useRef<PDFDocumentProxy | null>(null);

  useEffect(() => () => void current.current?.destroy(), []);

  const open = async (file: File, bytes?: Uint8Array, password?: string) => {
    setError(null);
    setLoading(true);
    try {
      const b = bytes ?? (await readBytes(file));
      if (requireWritable) {
        // pdf-lib can't write encrypted files (even ones without an open password).
        try {
          await loadPdf(b);
        } catch (e) {
          if (e instanceof PdfUserError && e.code === 'encrypted') {
            setNeedPassword(null);
            setError(`${file.name}: ${ENCRYPTED_MESSAGE}`);
            return;
          }
          throw e;
        }
      }
      const doc = await openPdf(b, password);
      current.current?.destroy();
      current.current = doc;
      setNeedPassword(null);
      setPdf({ file, bytes: b, doc, password });
    } catch (e) {
      if (e instanceof PasswordRequiredError) {
        setNeedPassword({ file, bytes: bytes ?? (await readBytes(file)), incorrect: e.incorrect });
      } else {
        setError(`${file.name}: ${errorMessage(e)}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    current.current?.destroy();
    current.current = null;
    setPdf(null);
    setError(null);
    setNeedPassword(null);
  };

  return { pdf, loading, error, needPassword, open, reset, setError };
}

export function PdfPickerView({
  picker,
  hint,
  encryptedNote,
}: {
  picker: ReturnType<typeof usePdfPicker>;
  hint?: string;
  /** Shown when a password-protected file is opened. */
  encryptedNote?: string;
}) {
  const [pw, setPw] = useState('');
  return (
    <div className="stack">
      <DropZone accept={PDF_ACCEPT} multiple={false} filter={isPdfFile} onFiles={(f) => f[0] && picker.open(f[0])} label="Drop a PDF here or click to choose" hint={hint} />
      {picker.loading && <Loading label="Opening PDF…" />}
      {picker.error && <Notice kind="error" onDismiss={() => picker.setError(null)}>{picker.error}</Notice>}
      {picker.needPassword && (
        <form
          className="card stack"
          onSubmit={(e) => {
            e.preventDefault();
            picker.open(picker.needPassword!.file, picker.needPassword!.bytes, pw);
          }}
        >
          <Notice kind={picker.needPassword.incorrect ? 'error' : 'info'}>
            {picker.needPassword.incorrect ? 'Incorrect password — try again.' : `“${picker.needPassword.file.name}” is password-protected.`}
            {encryptedNote && <p className="small">{encryptedNote}</p>}
          </Notice>
          <label className="field">
            <span>Password</span>
            <input className="input" type="password" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
          </label>
          <div className="row">
            <button type="submit" className="btn primary">Open</button>
            <button type="button" className="btn" onClick={picker.reset}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

export function PdfFileBar({ pdf, onClose }: { pdf: LoadedPdf; onClose: () => void }) {
  return (
    <div className="file-item">
      <span className="thumb" aria-hidden="true">📄</span>
      <div className="grow">
        <div className="name">{pdf.file.name}</div>
        <div className="small muted">
          {pdf.doc.numPages} page{pdf.doc.numPages === 1 ? '' : 's'} · {formatBytes(pdf.file.size)}
          {pdf.password ? ' · password-protected' : ''}
        </div>
      </div>
      <button type="button" className="btn small" onClick={onClose}>
        Choose another
      </button>
    </div>
  );
}

/** Lazily rendered page thumbnail (renders when scrolled into view). */
export function PageThumb({ doc, pageNumber, maxSize = 160, extraRotation = 0 }: { doc: PDFDocumentProxy; pageNumber: number; maxSize?: number; extraRotation?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let cancel: (() => void) | undefined;
    let stopped = false;
    const io = new IntersectionObserver(
      async (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        try {
          const page = await doc.getPage(pageNumber);
          if (stopped) return;
          const vp = page.getViewport({ scale: 1 });
          const scale = maxSize / Math.max(vp.width, vp.height);
          const r = startRender(page, canvas, scale, Math.min(2, window.devicePixelRatio || 1), 'all');
          cancel = r.cancel;
          canvas.style.aspectRatio = `${vp.width} / ${vp.height}`;
          canvas.style.width = vp.width >= vp.height ? '100%' : 'auto';
          canvas.style.height = vp.width >= vp.height ? 'auto' : '100%';
          await r.promise;
        } catch (e) {
          if (!isCancelled(e) && !stopped) setFailed(true);
        }
      },
      { rootMargin: '300px' },
    );
    io.observe(canvas);
    return () => {
      stopped = true;
      io.disconnect();
      cancel?.();
    };
  }, [doc, pageNumber, maxSize]);
  if (failed) return <span className="muted tiny">Preview unavailable</span>;
  return <canvas ref={ref} aria-hidden="true" style={{ transform: extraRotation ? `rotate(${extraRotation}deg)` : undefined }} />;
}

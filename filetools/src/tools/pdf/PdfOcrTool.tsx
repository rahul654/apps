import { useRef, useState } from 'react';
import { DownloadButton, ToolHeader } from '../../components/common';
import { errorMessage, Notice, ProgressBar } from '../../components/Feedback';
import { LicenceList, ocrLicenceLinks } from '../../components/Licences';
import { bytesToBlob, pdfBlob, type OutputFile } from '../../lib/download';
import { baseName, formatBytes } from '../../lib/format';
import { canvasToPng, isCancelled, PSM_LABEL, type PageSegMode } from '../../lib/ocr/engine';
import type { OcrModel } from '../../lib/ocr/langs';
import { fitCanvas, releaseCanvas, rotateCanvas } from '../../lib/ocr/imageOps';
import { recognizeOriented } from '../../lib/ocr/orient';
import { hasMeaningfulText, textFromLines, type OcrPage } from '../../lib/ocr/result';
import { addInvisibleTextLayer, quadsFromOcrLines, renderPixelMapper, type QuarterTurn } from '../../lib/ocr/textLayer';
import type { PageGeometry } from '../../lib/coords';
import { loadPdf, saveClean } from '../../lib/pdf/ops';
import { geometryOf, renderPage } from '../../lib/pdf/pdfjs';
import { flattenRanges, parsePageRanges } from '../../lib/pageRanges';
import { LangPicker } from '../ocr/LangPicker';
import { useOcrPool } from '../ocr/useOcrPool';
import { PdfFileBar, PdfPickerView, usePdfPicker } from './shared';

const DPI = 300;

type PageStatus = 'queued' | 'checking' | 'rendering' | 'ocr' | 'done' | 'skipped' | 'error' | 'cancelled';

interface PageState {
  index: number;
  status: PageStatus;
  progress?: number;
  result?: OcrPage;
  /** Rendered pixels per point. */
  scale?: number;
  /** Clockwise turn applied to the rendering before OCR (text upright). */
  rotation?: QuarterTurn;
  renderSize?: { w: number; h: number };
  geometry?: PageGeometry;
  error?: string;
  reduced?: boolean;
}

export default function PdfOcrTool() {
  const picker = usePdfPicker({ requireWritable: true });
  const { pdf } = picker;
  const [codes, setCodes] = useState<string[]>(['eng']);
  const [model, setModel] = useState<OcrModel>('fast');
  const [psm, setPsm] = useState<PageSegMode>('auto');
  const [range, setRange] = useState('');
  const [force, setForce] = useState(false);
  const [autoOrient, setAutoOrient] = useState(true);
  const [pages, setPages] = useState<PageState[]>([]);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<{ label: string; fraction?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [out, setOut] = useState<{ pdf: OutputFile; txt: OutputFile; ocred: number; skipped: number } | null>(null);
  const [cacheTick, setCacheTick] = useState(0);
  const ocr = useOcrPool();
  const cancelled = useRef(false);

  if (!pdf) {
    return (
      <>
        <ToolHeader emoji="🔎" title="Make PDF searchable (OCR)">
          Add an invisible text layer to scanned PDFs so you can search, select and copy their text. The pages look exactly the same.
        </ToolHeader>
        <div style={{ maxWidth: 720 }}>
          <PdfPickerView picker={picker} hint="Scanned documents, photos saved as PDF…" />
        </div>
      </>
    );
  }

  const set = (index: number, patch: Partial<PageState>) => setPages((l) => l.map((p) => (p.index === index ? { ...p, ...patch } : p)));

  const run = async () => {
    setError(null);
    setOut(null);
    let indices: number[];
    if (range.trim()) {
      const r = parsePageRanges(range, pdf.doc.numPages);
      if (!r.ok) return setError(r.error);
      indices = flattenRanges(r.ranges).sort((a, b) => a - b);
    } else indices = Array.from({ length: pdf.doc.numPages }, (_, i) => i);
    const states: PageState[] = indices.map((index) => ({ index, status: 'queued' }));
    setPages(states);
    setRunning(true);
    cancelled.current = false;
    const results = new Map<number, PageState>();
    try {
      const pool = await ocr.get(codes, model, psm, (label, fraction) => setStatus({ label, fraction }));
      setCacheTick((t) => t + 1);
      setStatus(null);
      const queue = [...indices];
      // Render at most one page ahead per worker to bound memory.
      await Promise.all(
        Array.from({ length: pool.size }, async () => {
          while (queue.length && !cancelled.current) {
            const index = queue.shift()!;
            try {
              const page = await pdf.doc.getPage(index + 1);
              if (!force) {
                set(index, { status: 'checking' });
                const tc = await page.getTextContent();
                if (hasMeaningfulText(tc.items as { str?: string }[])) {
                  const st: PageState = { index, status: 'skipped' };
                  results.set(index, st);
                  set(index, st);
                  continue;
                }
              }
              set(index, { status: 'rendering' });
              const geometry = geometryOf(page);
              const { canvas, effectiveScale, reduced } = await renderPage(page, { scale: DPI / 72, annotations: true });
              page.cleanup();
              const renderSize = { w: canvas.width, h: canvas.height };
              set(index, { status: 'ocr', progress: 0, reduced });
              try {
                // Recognise the rendering, turned so its text reads left to right if needed.
                const { result, rotation } = await recognizeOriented(
                  async (r, quick) => {
                    const src = quick ? fitCanvas(canvas, 1200) : canvas;
                    const c = rotateCanvas(src, r);
                    const png = await canvasToPng(c);
                    const res = await pool.recognize(png, c.width, c.height, quick ? undefined : (p) => set(index, { status: 'ocr', progress: p }));
                    if (c !== src) releaseCanvas(c);
                    if (src !== canvas) releaseCanvas(src);
                    return res;
                  },
                  { auto: autoOrient },
                );
                const st: PageState = { index, status: 'done', result, scale: effectiveScale, rotation, renderSize, geometry, reduced };
                results.set(index, st);
                set(index, st);
              } finally {
                releaseCanvas(canvas);
              }
            } catch (e) {
              const st: PageState = { index, status: isCancelled(e) || cancelled.current ? 'cancelled' : 'error', error: errorMessage(e) };
              results.set(index, st);
              set(index, st);
            }
          }
        }),
      );
      if (cancelled.current) return;
      const ocred = [...results.values()].filter((p) => p.status === 'done' && p.result);
      const skipped = [...results.values()].filter((p) => p.status === 'skipped').length;
      setStatus({ label: 'Writing the text layer…' });
      const doc = await loadPdf(pdf.bytes);
      for (const p of ocred) {
        if (!p.result!.lines.length) continue;
        const map = renderPixelMapper(p.geometry!, p.scale!, p.renderSize!.w, p.renderSize!.h, p.rotation ?? 0);
        addInvisibleTextLayer(doc, doc.getPage(p.index), quadsFromOcrLines(p.result!.lines, map));
      }
      const bytes = await saveClean(doc);
      const text = ocred
        .sort((a, b) => a.index - b.index)
        .map((p) => `--- Page ${p.index + 1} ---\n${textFromLines(p.result!.lines).text}`)
        .join('\n\n');
      const base = baseName(pdf.file.name);
      setOut({
        pdf: { name: `${base}_searchable.pdf`, blob: pdfBlob(bytes) },
        txt: { name: `${base}_ocr.txt`, blob: bytesToBlob(new TextEncoder().encode(text), 'text/plain;charset=utf-8') },
        ocred: ocred.length,
        skipped,
      });
    } catch (e) {
      if (!isCancelled(e)) setError(errorMessage(e));
    } finally {
      setRunning(false);
      setStatus(null);
    }
  };

  const cancel = async () => {
    cancelled.current = true;
    await ocr.cancel();
    setPages((l) => l.map((p) => (['queued', 'checking', 'rendering', 'ocr'].includes(p.status) ? { ...p, status: 'cancelled', progress: undefined } : p)));
  };

  const doneCount = pages.filter((p) => ['done', 'skipped', 'error', 'cancelled'].includes(p.status)).length;
  const label = (p: PageState) =>
    ({
      queued: 'Waiting',
      checking: 'Checking for existing text',
      rendering: `Rendering at ${DPI} dpi`,
      ocr: `Recognising ${Math.round((p.progress ?? 0) * 100)}%`,
      done: `${p.result?.lines.reduce((n, l) => n + l.words.length, 0) ?? 0} words · ${Math.round(p.result?.confidence ?? 0)}%${p.rotation ? ` · text turned ${p.rotation}° for OCR` : ''}`,
      skipped: 'Already has text — skipped',
      error: `Failed: ${p.error}`,
      cancelled: 'Cancelled',
    })[p.status];

  return (
    <>
      <ToolHeader emoji="🔎" title="Make PDF searchable (OCR)" />
      <div className="tool-layout">
        <div className="stack">
          <PdfFileBar pdf={pdf} onClose={() => { void ocr.cancel(); picker.reset(); setPages([]); setOut(null); }} />
          {pages.length > 0 && (
            <div className="card stack">
              <div className="row">
                <h2 className="grow" style={{ margin: 0 }}>Pages</h2>
                <span className="small muted">{doneCount}/{pages.length}</span>
              </div>
              {running && <ProgressBar value={doneCount / Math.max(1, pages.length)} label="Overall progress" />}
              <ul className="file-list ocr-pages" aria-label="Page progress">
                {pages.map((p) => (
                  <li key={p.index} className="file-item">
                    <span className="thumb" aria-hidden="true">{p.index + 1}</span>
                    <div className="grow">
                      <div className={`small ${p.status === 'error' ? 'danger-text' : p.status === 'skipped' ? 'muted' : ''}`}>{label(p)}</div>
                      {p.status === 'ocr' && <ProgressBar value={p.progress} label={`Page ${p.index + 1}`} />}
                      {p.reduced && <div className="tiny warn-text">Rendered below {DPI} dpi to fit the browser’s canvas limit.</div>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {out && (
            <div className="card stack">
              <Notice kind="success">
                Added a text layer to {out.ocred} page{out.ocred === 1 ? '' : 's'}
                {out.skipped ? ` · ${out.skipped} page${out.skipped === 1 ? '' : 's'} already had text and ${out.skipped === 1 ? 'was' : 'were'} left alone` : ''} · {formatBytes(out.pdf.blob.size)}
              </Notice>
              <div className="row">
                <DownloadButton files={[out.pdf]} />
                <DownloadButton files={[out.txt]} primary={false} label="Download text (.txt)" />
              </div>
              <p className="tiny muted">The original pages are unchanged — the recognised text sits invisibly on top, aligned with the words, so search and copy/paste work in any PDF viewer.</p>
            </div>
          )}
        </div>
        <aside className="card stack">
          <h2 style={{ margin: 0 }}>Settings</h2>
          <LangPicker codes={codes} model={model} onChange={(c, m) => { setCodes(c); setModel(m); }} disabled={running} refreshKey={cacheTick} />
          <label className="field">
            <span>Layout</span>
            <select className="input" value={psm} disabled={running} onChange={(e) => setPsm(e.target.value as PageSegMode)}>
              {(Object.keys(PSM_LABEL) as PageSegMode[]).map((k) => <option key={k} value={k}>{PSM_LABEL[k]}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Pages (blank = all {pdf.doc.numPages})</span>
            <input className="input" placeholder="e.g. 1-3,5" value={range} disabled={running} onChange={(e) => setRange(e.target.value)} />
          </label>
          <label className="check small"><input type="checkbox" checked={force} disabled={running} onChange={(e) => setForce(e.target.checked)} /> Force OCR on all pages (even ones that already have text)</label>
          <label className="check small"><input type="checkbox" checked={autoOrient} disabled={running} onChange={(e) => setAutoOrient(e.target.checked)} /> Detect sideways or upside-down pages</label>
          {status && (
            <div className="stack-sm">
              <span className="small">{status.label}</span>
              <ProgressBar value={status.fraction} label={status.label} />
            </div>
          )}
          {error && <Notice kind="error">{error}</Notice>}
          <div className="row">
            <button type="button" className="btn primary" onClick={run} disabled={running}>{running ? 'Working…' : 'Make searchable'}</button>
            {running && <button type="button" className="btn" onClick={cancel}>Cancel</button>}
          </div>
          <p className="tiny muted">Each page is rendered at {DPI} dpi and recognised in your browser — roughly 2–10 seconds per page depending on your device and the amount of text.</p>
          <LicenceList title="OCR licences" links={ocrLicenceLinks()} />
        </aside>
      </div>
    </>
  );
}

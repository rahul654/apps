import { useRef, useState } from 'react';
import { DownloadButton, Segmented, ToolHeader, useObjectUrl } from '../../components/common';
import { DropZone } from '../../components/DropZone';
import { errorMessage, Notice, ProgressBar } from '../../components/Feedback';
import { SortableList } from '../../components/SortableList';
import { uid } from '../../lib/array';
import { pdfBlob, type OutputFile } from '../../lib/download';
import { baseName, formatBytes } from '../../lib/format';
import { imagesToPdf, type EmbeddableImage, type Orientation, type PageSizeName } from '../../lib/pdf/ops';
import { canvasToBlob, renderPage } from '../../lib/pdf/pdfjs';
import { isImageFile, prepareImageForPdf } from '../../lib/pdf/prepareImage';
import { flattenRanges, parsePageRanges } from '../../lib/pageRanges';
import { PdfFileBar, PdfPickerView, usePdfPicker } from './shared';

type Mode = 'to-pdf' | 'from-pdf';

interface ImgItem {
  id: string;
  file: File;
}

function Thumb({ file }: { file: Blob }) {
  const url = useObjectUrl(file);
  const [broken, setBroken] = useState(false);
  return <span className="thumb">{url && !broken ? <img src={url} alt="" onError={() => setBroken(true)} /> : '🖼️'}</span>;
}

function ImagesToPdf() {
  const [items, setItems] = useState<ImgItem[]>([]);
  const [size, setSize] = useState<PageSizeName>('A4');
  const [orientation, setOrientation] = useState<Orientation>('auto');
  const [marginMm, setMarginMm] = useState(10);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [out, setOut] = useState<OutputFile | null>(null);

  const run = async () => {
    setBusy(0);
    setError(null);
    setOut(null);
    try {
      const imgs: EmbeddableImage[] = [];
      for (let i = 0; i < items.length; i++) {
        setBusy(i / items.length);
        try {
          imgs.push(await prepareImageForPdf(items[i].file));
        } catch (e) {
          throw new Error(`${items[i].file.name}: ${errorMessage(e)}`);
        }
      }
      const bytes = await imagesToPdf(imgs, { pageSize: size, orientation, marginPt: (marginMm * 72) / 25.4 });
      setOut({ name: items.length === 1 ? `${baseName(items[0].file.name)}.pdf` : 'images.pdf', blob: pdfBlob(bytes) });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="tool-layout">
      <div className="stack">
        <DropZone accept="image/*,.heic,.heif" filter={isImageFile} paste onFiles={(f) => { setItems((l) => [...l, ...f.map((file) => ({ id: uid('i'), file }))]); setOut(null); }} hint="Each image becomes one page" />
        {items.length > 0 && (
          <div className="card stack">
            <div className="row">
              <h2 className="grow" style={{ margin: 0 }}>{items.length} image{items.length > 1 ? 's' : ''}</h2>
              <button type="button" className="btn small" onClick={() => { setItems([]); setOut(null); }}>Clear</button>
            </div>
            <SortableList label="Images (page order)" items={items} onChange={(l) => { setItems(l); setOut(null); }} onRemove={(it) => setItems((l) => l.filter((x) => x.id !== it.id))} render={(it, i) => (
              <>
                <Thumb file={it.file} />
                <div className="grow">
                  <div className="name">{it.file.name}</div>
                  <div className="small muted">Page {i + 1} · {formatBytes(it.file.size)}</div>
                </div>
              </>
            )} />
          </div>
        )}
      </div>
      <aside className="card stack">
        <h2 style={{ margin: 0 }}>Page setup</h2>
        <div className="field">
          <span>Page size</span>
          <Segmented label="Page size" value={size} onChange={setSize} options={[{ value: 'A4', label: 'A4' }, { value: 'Letter', label: 'Letter' }, { value: 'fit', label: 'Fit image' }]} />
        </div>
        {size !== 'fit' && (
          <div className="field">
            <span>Orientation</span>
            <Segmented label="Orientation" value={orientation} onChange={setOrientation} options={[{ value: 'auto', label: 'Auto' }, { value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]} />
          </div>
        )}
        <label className="field">
          <span>Margin: {marginMm} mm</span>
          <input type="range" min={0} max={40} value={marginMm} onChange={(e) => setMarginMm(Number(e.target.value))} />
        </label>
        <p className="tiny muted">JPEG and PNG files are embedded unchanged (no quality loss). Other formats and rotated photos are converted first. Images are never enlarged beyond their natural size (96 dpi).</p>
        {busy !== null && <ProgressBar value={busy} label="Creating PDF" />}
        {error && <Notice kind="error">{error}</Notice>}
        <button type="button" className="btn primary" disabled={!items.length || busy !== null} onClick={run}>Create PDF</button>
        {out && <DownloadButton files={[out]} />}
      </aside>
    </div>
  );
}

function PdfToImages() {
  const picker = usePdfPicker();
  const { pdf } = picker;
  const [format, setFormat] = useState<'image/png' | 'image/jpeg'>('image/png');
  const [dpi, setDpi] = useState(150);
  const [quality, setQuality] = useState(90);
  const [range, setRange] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outs, setOuts] = useState<OutputFile[]>([]);
  const [reduced, setReduced] = useState(false);
  const cancel = useRef(false);

  if (!pdf) {
    return (
      <div style={{ maxWidth: 720 }}>
        <PdfPickerView picker={picker} hint="Password-protected PDFs can be opened with their password" />
      </div>
    );
  }

  const run = async () => {
    setError(null);
    setOuts([]);
    setReduced(false);
    cancel.current = false;
    let pages: number[];
    if (range.trim()) {
      const r = parsePageRanges(range, pdf.doc.numPages);
      if (!r.ok) return setError(r.error);
      pages = flattenRanges(r.ranges);
    } else pages = Array.from({ length: pdf.doc.numPages }, (_, i) => i);
    setBusy(0);
    const ext = format === 'image/png' ? 'png' : 'jpg';
    const base = baseName(pdf.file.name);
    const pad = String(pdf.doc.numPages).length;
    const results: OutputFile[] = [];
    try {
      for (let i = 0; i < pages.length && !cancel.current; i++) {
        setBusy(i / pages.length);
        const page = await pdf.doc.getPage(pages[i] + 1);
        const { canvas, reduced: r } = await renderPage(page, { scale: dpi / 72, annotations: true });
        if (r) setReduced(true);
        const blob = await canvasToBlob(canvas, format, quality / 100);
        canvas.width = canvas.height = 0;
        page.cleanup();
        results.push({ name: `${base}_page${String(pages[i] + 1).padStart(pad, '0')}.${ext}`, blob });
        setOuts([...results]);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="tool-layout">
      <div className="stack">
        <PdfFileBar pdf={pdf} onClose={() => { picker.reset(); setOuts([]); }} />
        {outs.length > 0 && (
          <div className="card stack">
            <h2 style={{ margin: 0 }}>{outs.length} image{outs.length > 1 ? 's' : ''} · {formatBytes(outs.reduce((s, o) => s + o.blob.size, 0))}</h2>
            <ul className="file-list">
              {outs.map((o) => (
                <li key={o.name} className="file-item">
                  <Thumb file={o.blob} />
                  <div className="grow"><div className="name">{o.name}</div><div className="small muted">{formatBytes(o.blob.size)}</div></div>
                  <DownloadButton files={[o]} label="Save" primary={false} small />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <aside className="card stack">
        <h2 style={{ margin: 0 }}>Export settings</h2>
        <div className="field">
          <span>Format</span>
          <Segmented label="Image format" value={format} onChange={setFormat} options={[{ value: 'image/png', label: 'PNG' }, { value: 'image/jpeg', label: 'JPEG' }]} />
        </div>
        <div className="field">
          <span>Resolution</span>
          <Segmented label="Resolution (DPI)" value={dpi} onChange={setDpi} options={[72, 150, 200, 300].map((d) => ({ value: d, label: `${d} dpi` }))} />
        </div>
        {format === 'image/jpeg' && (
          <label className="field">
            <span>JPEG quality: {quality}%</span>
            <input type="range" min={30} max={100} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
          </label>
        )}
        <label className="field">
          <span>Pages (blank = all)</span>
          <input className="input" placeholder={`1-${pdf.doc.numPages}`} value={range} onChange={(e) => setRange(e.target.value)} />
        </label>
        {busy !== null && <ProgressBar value={busy} label="Rendering pages" />}
        {reduced && <Notice kind="warn">Some pages were rendered at a lower resolution to stay within your browser’s canvas size limit.</Notice>}
        {error && <Notice kind="error">{error}</Notice>}
        <div className="row">
          <button type="button" className="btn primary" onClick={run} disabled={busy !== null}>Export images</button>
          {busy !== null && <button type="button" className="btn" onClick={() => (cancel.current = true)}>Stop</button>}
        </div>
        {outs.length > 0 && busy === null && <DownloadButton files={outs} zipName={`${baseName(pdf.file.name)}_images.zip`} />}
      </aside>
    </div>
  );
}

export default function ImagesPdfTool() {
  const [mode, setMode] = useState<Mode>('to-pdf');
  return (
    <>
      <ToolHeader emoji="🔁" title="Images ⇄ PDF">
        Turn photos and scans into a PDF, or export PDF pages as images.
      </ToolHeader>
      <div className="tabs" role="tablist" aria-label="Direction">
        <button type="button" role="tab" aria-selected={mode === 'to-pdf'} onClick={() => setMode('to-pdf')}>Images → PDF</button>
        <button type="button" role="tab" aria-selected={mode === 'from-pdf'} onClick={() => setMode('from-pdf')}>PDF → Images</button>
      </div>
      {mode === 'to-pdf' ? <ImagesToPdf /> : <PdfToImages />}
    </>
  );
}

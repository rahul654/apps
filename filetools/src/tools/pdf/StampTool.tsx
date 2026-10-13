import { useState } from 'react';
import { DownloadButton, Segmented, ToolHeader } from '../../components/common';
import { errorMessage, Notice, ProgressBar } from '../../components/Feedback';
import { pdfBlob, type OutputFile } from '../../lib/download';
import { baseName } from '../../lib/format';
import { addPageNumbers, addWatermark, formatPageNumber, type StampPosition } from '../../lib/pdf/ops';
import { hexToRgb01 } from '../../lib/pdf/editorModel';
import { flattenRanges, parsePageRanges } from '../../lib/pageRanges';
import { unsupportedChars } from '../../lib/winAnsi';
import { PdfFileBar, PdfPickerView, usePdfPicker } from './shared';

type Mode = 'numbers' | 'watermark';

const FORMATS = ['{n}', 'Page {n}', 'Page {n} of {total}', '{n} / {total}', '- {n} -'];
const POSITIONS: { value: StampPosition; label: string }[] = [
  { value: 'top-left', label: '↖' },
  { value: 'top-center', label: '↑' },
  { value: 'top-right', label: '↗' },
  { value: 'bottom-left', label: '↙' },
  { value: 'bottom-center', label: '↓' },
  { value: 'bottom-right', label: '↘' },
];

export default function StampTool() {
  const picker = usePdfPicker({ requireWritable: true });
  const { pdf } = picker;
  const [mode, setMode] = useState<Mode>('numbers');
  const [fmt, setFmt] = useState('Page {n} of {total}');
  const [position, setPosition] = useState<StampPosition>('bottom-center');
  const [startAt, setStartAt] = useState('1');
  const [fontSize, setFontSize] = useState(10);
  const [margin, setMargin] = useState(24);
  const [pageRange, setPageRange] = useState('');
  const [wmText, setWmText] = useState('CONFIDENTIAL');
  const [wmSize, setWmSize] = useState(60);
  const [wmOpacity, setWmOpacity] = useState(20);
  const [wmAngle, setWmAngle] = useState(45);
  const [wmPos, setWmPos] = useState<'center' | 'top' | 'bottom'>('center');
  const [wmColor, setWmColor] = useState('#808080');
  const [wmBold, setWmBold] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [out, setOut] = useState<OutputFile | null>(null);

  if (!pdf) {
    return (
      <>
        <ToolHeader emoji="🔢" title="Page numbers & watermark">Stamp page numbers or a text watermark on every page (or a range).</ToolHeader>
        <div style={{ maxWidth: 720 }}><PdfPickerView picker={picker} /></div>
      </>
    );
  }

  const text = mode === 'numbers' ? fmt : wmText;
  const badChars = unsupportedChars(text);

  const run = async () => {
    setError(null);
    setOut(null);
    let pages: number[] | undefined;
    if (pageRange.trim()) {
      const r = parsePageRanges(pageRange, pdf.doc.numPages);
      if (!r.ok) return setError(r.error);
      pages = flattenRanges(r.ranges);
    }
    setBusy(true);
    try {
      const bytes =
        mode === 'numbers'
          ? await addPageNumbers(pdf.bytes, { format: fmt, position, startAt: Number(startAt) || 1, fontSize, marginPt: margin, pages })
          : await addWatermark(pdf.bytes, { text: wmText, fontSize: wmSize, opacity: wmOpacity / 100, angle: wmAngle, position: wmPos, color: hexToRgb01(wmColor), bold: wmBold, pages });
      setOut({ name: `${baseName(pdf.file.name)}_${mode === 'numbers' ? 'numbered' : 'watermarked'}.pdf`, blob: pdfBlob(bytes) });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ToolHeader emoji="🔢" title="Page numbers & watermark" />
      <div className="stack" style={{ maxWidth: 760 }}>
        <PdfFileBar pdf={pdf} onClose={() => { picker.reset(); setOut(null); }} />
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'numbers'} onClick={() => { setMode('numbers'); setOut(null); }}>Page numbers</button>
          <button type="button" role="tab" aria-selected={mode === 'watermark'} onClick={() => { setMode('watermark'); setOut(null); }}>Watermark</button>
        </div>
        <div className="card stack">
          {mode === 'numbers' ? (
            <>
              <label className="field">
                <span>Format ({'{n}'} = page number, {'{total}'} = page count)</span>
                <input className="input" list="pn-formats" value={fmt} onChange={(e) => setFmt(e.target.value)} />
                <datalist id="pn-formats">{FORMATS.map((f) => <option key={f} value={f} />)}</datalist>
                <span className="tiny muted">Preview: “{formatPageNumber(fmt, Number(startAt) || 1, (Number(startAt) || 1) - 1 + pdf.doc.numPages)}”</span>
              </label>
              <div className="field">
                <span>Position</span>
                <Segmented label="Position" value={position} onChange={setPosition} options={POSITIONS} />
              </div>
              <div className="grid-3">
                <label className="field"><span>Start at</span><input className="input" inputMode="numeric" value={startAt} onChange={(e) => setStartAt(e.target.value.replace(/\D/g, ''))} /></label>
                <label className="field"><span>Font size: {fontSize}pt</span><input type="range" min={6} max={24} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} /></label>
                <label className="field"><span>Margin: {margin}pt</span><input type="range" min={6} max={72} value={margin} onChange={(e) => setMargin(Number(e.target.value))} /></label>
              </div>
            </>
          ) : (
            <>
              <label className="field"><span>Watermark text</span><input className="input" value={wmText} onChange={(e) => setWmText(e.target.value)} /></label>
              <div className="grid-2">
                <label className="field"><span>Size: {wmSize}pt</span><input type="range" min={12} max={160} value={wmSize} onChange={(e) => setWmSize(Number(e.target.value))} /></label>
                <label className="field"><span>Opacity: {wmOpacity}%</span><input type="range" min={5} max={100} value={wmOpacity} onChange={(e) => setWmOpacity(Number(e.target.value))} /></label>
                <label className="field"><span>Rotation: {wmAngle}°</span><input type="range" min={-90} max={90} step={5} value={wmAngle} onChange={(e) => setWmAngle(Number(e.target.value))} /></label>
                <div className="field"><span>Position</span><Segmented label="Watermark position" value={wmPos} onChange={setWmPos} options={[{ value: 'top', label: 'Top' }, { value: 'center', label: 'Center' }, { value: 'bottom', label: 'Bottom' }]} /></div>
              </div>
              <div className="row">
                <label className="field"><span>Colour</span><input type="color" className="input" value={wmColor} onChange={(e) => setWmColor(e.target.value)} /></label>
                <label className="check"><input type="checkbox" checked={wmBold} onChange={(e) => setWmBold(e.target.checked)} /> Bold</label>
              </div>
              <p className="tiny muted">The watermark is drawn on top of the page content as semi-transparent text. It can be removed with a PDF editor — it isn’t a security feature.</p>
            </>
          )}
          <label className="field">
            <span>Pages (blank = all {pdf.doc.numPages})</span>
            <input className="input" placeholder="e.g. 2-10" value={pageRange} onChange={(e) => setPageRange(e.target.value)} />
          </label>
          {badChars.length > 0 && <Notice kind="warn">These characters can’t be written with the standard PDF fonts: {badChars.join(' ')}. Only Latin (Windows-1252) characters are supported.</Notice>}
          {busy && <ProgressBar label="Stamping" />}
          {error && <Notice kind="error">{error}</Notice>}
          <div className="row">
            <button type="button" className="btn primary" disabled={busy || badChars.length > 0} onClick={run}>{mode === 'numbers' ? 'Add page numbers' : 'Add watermark'}</button>
            {out && <DownloadButton files={[out]} />}
          </div>
        </div>
      </div>
    </>
  );
}

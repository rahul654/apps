import { useMemo, useRef, useState } from 'react';
import { CompareSlider } from '../../components/CompareSlider';
import { DownloadButton, Segmented, ToolHeader, useObjectUrl } from '../../components/common';
import { DropZone } from '../../components/DropZone';
import { errorMessage, Notice, ProgressBar } from '../../components/Feedback';
import { LicenceList, ocrLicenceLinks } from '../../components/Licences';
import { uid } from '../../lib/array';
import { bytesToBlob, pdfBlob, type OutputFile } from '../../lib/download';
import { baseName } from '../../lib/format';
import { isCancelled, PSM_LABEL, type PageSegMode } from '../../lib/ocr/engine';
import { canvasBlob, fileToCanvas, fitCanvas, preprocessCanvas, releaseCanvas, rotateCanvas, scaleCanvas } from '../../lib/ocr/imageOps';
import type { OcrModel } from '../../lib/ocr/langs';
import { recognizeOriented } from '../../lib/ocr/orient';
import { clampFactor, median, upscaleFactor } from '../../lib/ocr/preprocess';
import { textFromLines, type OcrPage, type TextWithOffsets } from '../../lib/ocr/result';
import { imagesToSearchablePdf } from '../../lib/ocr/searchablePdf';
import { getItem, setItem } from '../../lib/storage';
import { LangPicker } from './LangPicker';
import { useOcrPool } from './useOcrPool';

type Rotation = 0 | 90 | 180 | 270;
type Status = 'queued' | 'working' | 'done' | 'error' | 'cancelled';

interface Item {
  id: string;
  file: File;
  status: Status;
  stage?: string;
  progress?: number;
  error?: string;
  processed?: Blob;
  processedSize?: { w: number; h: number };
  /** Rotated colour image (no binarisation) for the searchable PDF. */
  oriented?: Blob;
  orientedSize?: { w: number; h: number };
  rotation?: Rotation;
  upscaled?: number;
  result?: OcrPage;
  text?: string;
  offsets?: TextWithOffsets['offsets'];
  edited?: boolean;
  sig?: string;
}

interface Settings {
  codes: string[];
  model: OcrModel;
  psm: PageSegMode;
  grayscale: boolean;
  contrast: boolean;
  binarize: boolean;
  upscale: boolean;
  rotation: 'auto' | Rotation;
}

const DEFAULTS: Settings = { codes: ['eng'], model: 'fast', psm: 'auto', grayscale: false, contrast: false, binarize: false, upscale: true, rotation: 'auto' };
const PREFS_KEY = 'ocr:prefs:v1';

function loadPrefs(): Settings {
  try {
    const p = JSON.parse(getItem(PREFS_KEY) ?? 'null');
    return p ? { ...DEFAULTS, ...p, rotation: DEFAULTS.rotation } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

const LOW_CONFIDENCE = 60;

function Preview({ item, showBoxes, compare, hovered, onHover, onPick }: { item: Item; showBoxes: boolean; compare: boolean; hovered: number | null; onHover: (i: number | null) => void; onPick: (i: number) => void }) {
  const original = useObjectUrl(item.file);
  const processed = useObjectUrl(item.processed);
  if (!processed || !item.processedSize) return original ? <img src={original} alt="Original" className="ocr-img" /> : null;
  if (compare && original) return <CompareSlider before={original} after={processed} beforeLabel="Original" afterLabel="Prepared for OCR" />;
  const words = item.result?.lines.flatMap((l) => l.words) ?? [];
  const { w, h } = item.processedSize;
  return (
    <div className="ocr-preview">
      <img src={processed} alt="Image prepared for OCR" className="ocr-img" />
      {showBoxes && item.result && (
        <svg viewBox={`0 0 ${w} ${h}`} className="ocr-boxes" role="group" aria-label="Recognised words">
          {words.map((wd, i) => (
            <rect
              key={i}
              x={wd.bbox.x0}
              y={wd.bbox.y0}
              width={wd.bbox.x1 - wd.bbox.x0}
              height={wd.bbox.y1 - wd.bbox.y0}
              className={`${wd.confidence < LOW_CONFIDENCE ? 'low' : ''}${hovered === i ? ' hot' : ''}`}
              onMouseEnter={() => onHover(i)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onPick(i)}
            >
              <title>{`${wd.text} — ${Math.round(wd.confidence)}% confidence`}</title>
            </rect>
          ))}
        </svg>
      )}
    </div>
  );
}

export default function OcrTool() {
  const [items, setItems] = useState<Item[]>([]);
  const [settings, setSettingsState] = useState<Settings>(loadPrefs);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<{ label: string; fraction?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showBoxes, setShowBoxes] = useState(true);
  const [compare, setCompare] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const [combined, setCombined] = useState(false);
  const [pdfOut, setPdfOut] = useState<OutputFile | null>(null);
  const [cacheTick, setCacheTick] = useState(0);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const ocr = useOcrPool();
  const cancelled = useRef(false);

  const setSettings = (s: Settings) => {
    setSettingsState(s);
    setItem(PREFS_KEY, JSON.stringify({ ...s, rotation: undefined }));
  };
  const sig = JSON.stringify(settings);

  const update = (id: string, patch: Partial<Item>) => setItems((l) => l.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const add = (files: File[]) => {
    const fresh = files.map((file) => ({ id: uid('ocr'), file, status: 'queued' as Status }));
    setItems((l) => [...l, ...fresh]);
    if (!selectedId && fresh[0]) setSelectedId(fresh[0].id);
    setPdfOut(null);
  };

  const processOne = async (item: Item, s: Settings) => {
    const pool = await ocr.get(s.codes, s.model, s.psm, (label, fraction) => setStatus({ label, fraction }));
    setStatus(null);
    const step = (stage: string, progress?: number) => update(item.id, { status: 'working', stage, progress });
    step('Decoding image');
    const canvas = await fileToCanvas(item.file);
    step('Preparing image');
    const { canvas: prepared0 } = preprocessCanvas(canvas, s);
    const recognizeAt = async (r: Rotation, quick: boolean) => {
      if (quick) step('Checking orientation');
      const src = quick ? fitCanvas(prepared0, 1000) : prepared0;
      const c = rotateCanvas(src, r);
      const res = await pool.recognize(await canvasBlob(c), c.width, c.height, quick ? undefined : (p) => step('Recognising text', p));
      if (c !== src) releaseCanvas(c);
      if (src !== prepared0) releaseCanvas(src);
      return res;
    };
    // Auto: OCR upright, and only if the text looks sideways/upside down try the other turns.
    let { result: res, rotation } = await recognizeOriented(recognizeAt, s.rotation === 'auto' ? { auto: true } : { auto: false, rotation: s.rotation });
    if (cancelled.current) throw new Error('Cancelled');
    let prepared = rotateCanvas(prepared0, rotation);
    const oriented = rotateCanvas(canvas, rotation);
    const orientedBlob = await canvasBlob(oriented, 'image/jpeg', 0.9);
    const orientedSize = { w: oriented.width, h: oriented.height };
    let blob = await canvasBlob(prepared);
    let upscaled = 1;
    if (s.upscale) {
      const heights = res.lines.flatMap((l) => l.words.map((w) => w.bbox.y1 - w.bbox.y0));
      const f = clampFactor(prepared.width, prepared.height, upscaleFactor(median(heights)));
      if (f > 1 && heights.length) {
        step(`Small text — retrying at ${f}× size`);
        const big = scaleCanvas(prepared, f);
        const bigBlob = await canvasBlob(big);
        const second = await pool.recognize(bigBlob, big.width, big.height, (p) => step('Recognising text', p));
        if (second.confidence >= res.confidence) {
          if (prepared !== prepared0) releaseCanvas(prepared);
          prepared = big;
          blob = bigBlob;
          res = second;
          upscaled = f;
        } else releaseCanvas(big);
      }
    }
    const t = textFromLines(res.lines);
    update(item.id, {
      status: 'done',
      stage: undefined,
      progress: undefined,
      processed: blob,
      processedSize: { w: prepared.width, h: prepared.height },
      oriented: orientedBlob,
      orientedSize,
      rotation,
      upscaled,
      result: res,
      text: t.text,
      offsets: t.offsets,
      edited: false,
      sig: JSON.stringify(s),
      error: undefined,
    });
    for (const c of new Set([prepared, prepared0, oriented, canvas])) releaseCanvas(c);
  };

  const runAll = async (targets: Item[]) => {
    if (!targets.length) return;
    setError(null);
    setPdfOut(null);
    setRunning(true);
    cancelled.current = false;
    const s = settings;
    try {
      const pool = await ocr.get(s.codes, s.model, s.psm, (label, fraction) => setStatus({ label, fraction }));
      setCacheTick((t) => t + 1);
      setStatus(null);
      const queue = [...targets];
      const lanes = Math.max(1, pool.size);
      await Promise.all(
        Array.from({ length: lanes }, async () => {
          while (queue.length && !cancelled.current) {
            const it = queue.shift()!;
            try {
              await processOne(it, s);
            } catch (e) {
              if (isCancelled(e) || cancelled.current) update(it.id, { status: 'cancelled', stage: undefined, progress: undefined });
              else update(it.id, { status: 'error', error: errorMessage(e), stage: undefined, progress: undefined });
            }
          }
        }),
      );
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
    setItems((l) => l.map((i) => (i.status === 'working' || i.status === 'queued' ? { ...i, status: i.status === 'working' ? 'cancelled' : i.status, stage: undefined, progress: undefined } : i)));
  };

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const done = items.filter((i) => i.status === 'done' && i.result);
  const pending = items.filter((i) => i.status !== 'done' && i.status !== 'working');
  const stale = done.filter((i) => i.sig !== sig);
  const words = selected?.result?.lines.flatMap((l) => l.words) ?? [];
  const combinedText = useMemo(() => done.map((i) => (done.length > 1 ? `--- ${i.file.name} ---\n${i.text ?? ''}` : i.text ?? '')).join('\n\n'), [done]);
  const overall = done.length ? Math.round(done.reduce((s, i) => s + (i.result!.confidence || 0), 0) / done.length) : 0;

  const pickWord = (i: number) => {
    const o = selected?.offsets?.[i];
    const ta = textRef.current;
    if (!o || !ta || selected?.edited) return;
    setCombined(false);
    ta.focus();
    ta.setSelectionRange(o.start, o.end);
    const before = ta.value.slice(0, o.start).split('\n').length;
    ta.scrollTop = Math.max(0, (before - 3) * 20);
  };

  const makePdf = async () => {
    setError(null);
    try {
      const pages = [];
      for (const i of done) {
        pages.push({
          image: { bytes: new Uint8Array(await i.oriented!.arrayBuffer()), format: 'jpg' as const, width: i.orientedSize!.w, height: i.orientedSize!.h },
          ocr: i.result!,
        });
      }
      const bytes = await imagesToSearchablePdf(pages, done.length === 1 ? baseName(done[0].file.name) : 'OCR scans');
      setPdfOut({ name: done.length === 1 ? `${baseName(done[0].file.name)}_searchable.pdf` : 'scans_searchable.pdf', blob: pdfBlob(bytes) });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const copy = (text: string) => navigator.clipboard?.writeText(text).catch(() => setError('Copy failed — select the text and copy manually.'));

  return (
    <>
      <ToolHeader emoji="🔍" title="Image to text (OCR)">
        Pull text out of photos, scans and screenshots in 20+ languages. Recognition runs in your browser.
      </ToolHeader>
      <div className="tool-layout">
        <div className="stack">
          <div className="row">
            <div className="grow">
              <DropZone accept="image/*,.heic,.heif" onFiles={add} paste hint="Photos, scans or screenshots — several at once" />
            </div>
          </div>
          <div className="row">
            <button type="button" className="btn" onClick={() => cameraRef.current?.click()}>📷 Take a photo</button>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { if (e.target.files?.length) add([...e.target.files]); e.target.value = ''; }} />
            <span className="tiny muted">On phones this opens the camera.</span>
          </div>

          {items.length > 0 && (
            <div className="card stack">
              <div className="row">
                <h2 className="grow" style={{ margin: 0 }}>{items.length} image{items.length > 1 ? 's' : ''}</h2>
                <button type="button" className="btn small" disabled={running} onClick={() => { setItems([]); setSelectedId(null); setPdfOut(null); }}>Clear</button>
              </div>
              <ul className="file-list" aria-label="Images">
                {items.map((it) => (
                  <li key={it.id} className={`file-item${it.id === selectedId ? ' selected' : ''}`}>
                    <button type="button" className="grow btn ghost" style={{ justifyContent: 'flex-start', textAlign: 'left', padding: 0, minHeight: 0, display: 'block', whiteSpace: 'normal' }} onClick={() => setSelectedId(it.id)}>
                      <div className="name">{it.file.name}</div>
                      <div className="small muted">
                        {it.status === 'queued' && 'Ready'}
                        {it.status === 'working' && `${it.stage ?? 'Working'}${it.progress !== undefined ? ` ${Math.round(it.progress * 100)}%` : '…'}`}
                        {it.status === 'done' && `${it.result!.lines.reduce((n, l) => n + l.words.length, 0)} words · ${Math.round(it.result!.confidence)}% confidence${it.rotation ? ` · rotated ${it.rotation}°` : ''}${it.upscaled && it.upscaled > 1 ? ` · upscaled ${it.upscaled}×` : ''}`}
                        {it.status === 'cancelled' && 'Cancelled'}
                        {it.sig && it.sig !== sig && it.status === 'done' && ' · settings changed'}
                      </div>
                      {it.status === 'working' && <ProgressBar value={it.progress} label={`OCR progress for ${it.file.name}`} />}
                      {it.error && <div className="small danger-text">{it.error}</div>}
                    </button>
                    <button type="button" className="btn ghost small icon danger" disabled={running} aria-label={`Remove ${it.file.name}`} onClick={() => setItems((l) => l.filter((x) => x.id !== it.id))}>✕</button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {selected && (
            <div className="card stack">
              <div className="row">
                <h2 className="grow" style={{ margin: 0 }}>{selected.file.name}</h2>
                <label className="check small"><input type="checkbox" checked={showBoxes} onChange={(e) => setShowBoxes(e.target.checked)} /> Word boxes</label>
                <label className="check small"><input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} disabled={!selected.processed} /> Before/after</label>
              </div>
              <Preview item={selected} showBoxes={showBoxes} compare={compare} hovered={hovered} onHover={setHovered} onPick={pickWord} />
              {selected.result && showBoxes && <p className="tiny muted">Orange boxes: confidence under {LOW_CONFIDENCE}% — worth checking. Click a box to find the word in the text.</p>}
              {hovered !== null && words[hovered] && <p className="small">“{words[hovered].text}” — {Math.round(words[hovered].confidence)}% confidence</p>}
            </div>
          )}

          {done.length > 0 && (
            <div className="card stack">
              <div className="row">
                <h2 className="grow" style={{ margin: 0 }}>Text</h2>
                <Segmented label="Text view" value={combined ? 'all' : 'one'} onChange={(v) => setCombined(v === 'all')} options={[{ value: 'one', label: 'This image', disabled: !selected?.result }, { value: 'all', label: `All (${done.length})` }]} />
              </div>
              {combined || !selected?.result ? (
                <textarea className="input ocr-text" readOnly value={combinedText} aria-label="All recognised text" rows={14} />
              ) : (
                <textarea
                  ref={textRef}
                  className="input ocr-text"
                  value={selected.text ?? ''}
                  aria-label={`Recognised text of ${selected.file.name}`}
                  rows={14}
                  dir="auto"
                  onChange={(e) => update(selected.id, { text: e.target.value, edited: true })}
                />
              )}
              {selected?.edited && !combined && <p className="tiny muted">Edited — clicking word boxes no longer jumps to the text.</p>}
              <div className="row">
                <span className="small muted grow">Overall confidence: <b>{overall}%</b>{overall && overall < 70 ? ' — try preprocessing, another language or the Best model' : ''}</span>
                <button type="button" className="btn small" onClick={() => copy(combined || !selected?.result ? combinedText : selected.text ?? '')}>Copy</button>
                <DownloadButton
                  small
                  primary={false}
                  label="Download .txt"
                  files={[{ name: combined || !selected?.result ? 'ocr-text.txt' : `${baseName(selected.file.name)}.txt`, blob: bytesToBlob(new TextEncoder().encode(combined || !selected?.result ? combinedText : selected.text ?? ''), 'text/plain;charset=utf-8') }]}
                />
              </div>
              <div className="row">
                <button type="button" className="btn" onClick={makePdf} disabled={running}>Make searchable PDF ({done.length} page{done.length > 1 ? 's' : ''})</button>
                {pdfOut && <DownloadButton files={[pdfOut]} />}
              </div>
              <p className="tiny muted">The PDF shows each image as a page with an invisible text layer, so you can search, select and copy the text.</p>
            </div>
          )}
        </div>

        <aside className="card stack">
          <h2 style={{ margin: 0 }}>Settings</h2>
          <LangPicker codes={settings.codes} model={settings.model} onChange={(codes, model) => setSettings({ ...settings, codes, model })} disabled={running} refreshKey={cacheTick} />
          <label className="field">
            <span>Layout</span>
            <select className="input" value={settings.psm} disabled={running} onChange={(e) => setSettings({ ...settings, psm: e.target.value as PageSegMode })}>
              {(Object.keys(PSM_LABEL) as PageSegMode[]).map((k) => <option key={k} value={k}>{PSM_LABEL[k]}</option>)}
            </select>
          </label>
          <div className="field">
            <span>Prepare the image</span>
            <label className="check small"><input type="checkbox" checked={settings.grayscale} onChange={(e) => setSettings({ ...settings, grayscale: e.target.checked })} /> Grayscale</label>
            <label className="check small"><input type="checkbox" checked={settings.contrast} onChange={(e) => setSettings({ ...settings, contrast: e.target.checked })} /> Boost contrast</label>
            <label className="check small"><input type="checkbox" checked={settings.binarize} onChange={(e) => setSettings({ ...settings, binarize: e.target.checked })} /> Black &amp; white (Otsu)</label>
            <label className="check small"><input type="checkbox" checked={settings.upscale} onChange={(e) => setSettings({ ...settings, upscale: e.target.checked })} /> Upscale small text automatically</label>
          </div>
          <div className="field">
            <span>Rotation</span>
            <Segmented
              label="Rotation"
              value={settings.rotation}
              onChange={(r) => setSettings({ ...settings, rotation: r })}
              options={[
                { value: 0, label: '0°' },
                { value: 90, label: '90°' },
                { value: 180, label: '180°' },
                { value: 270, label: '270°' },
                { value: 'auto', label: 'Auto' },
              ]}
            />
            {settings.rotation === 'auto' && <span className="tiny muted">If the text looks sideways or upside down, the other orientations are tried on a small copy and the best is kept.</span>}
          </div>
          {status && (
            <div className="stack-sm">
              <span className="small">{status.label}</span>
              <ProgressBar value={status.fraction} label={status.label} />
            </div>
          )}
          {error && <Notice kind="error">{error}</Notice>}
          <div className="row">
            <button type="button" className="btn primary" disabled={running || !items.length || (!pending.length && !stale.length)} onClick={() => runAll(stale.length && !pending.length ? stale : [...pending, ...stale])}>
              {running ? 'Recognising…' : stale.length && !pending.length ? `Re-run with new settings (${stale.length})` : `Recognise text${pending.length > 1 ? ` (${pending.length})` : ''}`}
            </button>
            {running && <button type="button" className="btn" onClick={cancel}>Cancel</button>}
          </div>
          <p className="tiny muted">
            Works best on printed text: straight, sharp, well-lit. Handwriting is rarely recognised well. The first run downloads the OCR engine (~4 MB, cached by your browser).
          </p>
          <LicenceList title="OCR licences" links={ocrLicenceLinks()} />
        </aside>
      </div>
    </>
  );
}

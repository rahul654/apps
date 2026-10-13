import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Modal } from '../../../components/common';
import { errorMessage, Notice } from '../../../components/Feedback';
import { getItem, removeItem, setItem } from '../../../lib/storage';
import { prepareImageForPdf } from '../../../lib/pdf/prepareImage';
import { loadFace } from '../../../lib/fonts/loader';
import { cssFontFamily, type FontId } from '../../../lib/fonts/registry';
import type { EmbeddableImage } from '../../../lib/pdf/ops';

const STORE_KEY = 'signature:v1';
const MAX_STORED = 1_500_000; // characters of data URL

// Bundled script fonts, so a typed signature looks the same on every device.
const SCRIPT_FONTS: { label: string; id: FontId }[] = [
  { label: 'Dancing Script', id: 'DancingScript' },
  { label: 'Caveat', id: 'Caveat' },
];

const INKS = ['#111111', '#1d3fbf'];

type Tab = 'draw' | 'type' | 'upload';
type Stroke = { x: number; y: number; p: number }[];

/** Crop transparent margins and return PNG bytes. */
async function trimToPng(canvas: HTMLCanvasElement): Promise<EmbeddableImage | null> {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const pad = 6;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d')!.drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  const blob = await new Promise<Blob | null>((r) => out.toBlob(r, 'image/png'));
  if (!blob) return null;
  return { bytes: new Uint8Array(await blob.arrayBuffer()), format: 'png', width: out.width, height: out.height };
}

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, base: number) {
  if (s.length === 0) return;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (s.length === 1) {
    ctx.beginPath();
    ctx.arc(s[0].x, s[0].y, base / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // Quadratic curves through midpoints; width follows pen pressure where available.
  for (let i = 1; i < s.length; i++) {
    const p0 = s[i - 1];
    const p1 = s[i];
    const m0 = i === 1 ? p0 : { x: (s[i - 2].x + p0.x) / 2, y: (s[i - 2].y + p0.y) / 2 };
    const m1 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    ctx.lineWidth = base * (0.6 + 0.8 * p1.p);
    ctx.beginPath();
    ctx.moveTo(m0.x, m0.y);
    ctx.quadraticCurveTo(p0.x, p0.y, m1.x, m1.y);
    if (i === s.length - 1) ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }
}

function dataUrlToImage(url: string): EmbeddableImage | null {
  const m = url.match(/^data:image\/(png|jpeg);base64,(.+)$/);
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const v = new DataView(bytes.buffer);
  if (m[1] === 'png') return { bytes, format: 'png', width: v.getUint32(16), height: v.getUint32(20) };
  return null;
}

function imageToDataUrl(img: EmbeddableImage): string {
  let s = '';
  for (let i = 0; i < img.bytes.length; i += 0x8000) s += String.fromCharCode(...img.bytes.subarray(i, i + 0x8000));
  return `data:image/${img.format === 'png' ? 'png' : 'jpeg'};base64,${btoa(s)}`;
}

export function SignatureModal({ onClose, onDone }: { onClose: () => void; onDone: (img: EmbeddableImage) => void }) {
  const [tab, setTab] = useState<Tab>('draw');
  const [ink, setInk] = useState(INKS[0]);
  const [typed, setTyped] = useState('');
  const [fontId, setFontId] = useState<FontId>(SCRIPT_FONTS[0].id);
  const [fontReady, setFontReady] = useState(false);
  const font = cssFontFamily(fontId);
  useEffect(() => {
    if (tab !== 'type') return;
    let alive = true;
    setFontReady(false);
    loadFace(fontId, 'regular')
      .then(() => alive && setFontReady(true))
      .catch(() => alive && setFontReady(true)); // fall back to the CSS fallback font
    return () => {
      alive = false;
    };
  }, [fontId, tab]);
  const [upload, setUpload] = useState<EmbeddableImage | null>(null);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(() => getItem(STORE_KEY));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const drawing = useRef<Stroke | null>(null);
  const [strokeCount, setStrokeCount] = useState(0);

  const redraw = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    const ratio = c.width / c.clientWidth || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    for (const s of strokes.current) drawStroke(ctx, s, 3);
  };

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || tab !== 'draw') return;
    const resize = () => {
      const ratio = Math.min(3, window.devicePixelRatio || 1);
      c.width = Math.round(c.clientWidth * ratio);
      c.height = Math.round(c.clientHeight * ratio);
      redraw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(c);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(redraw, [ink]);

  const point = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, p: e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5 };
  };

  const finishImage = async (): Promise<EmbeddableImage | null> => {
    if (tab === 'upload') return upload;
    const c = document.createElement('canvas');
    if (tab === 'draw') {
      const src = canvasRef.current!;
      c.width = src.width;
      c.height = src.height;
      c.getContext('2d')!.drawImage(src, 0, 0);
    } else {
      if (!typed.trim()) return null;
      await loadFace(fontId, 'regular').catch(() => undefined);
      const size = 96;
      const ctx0 = c.getContext('2d')!;
      ctx0.font = `${size}px ${font}`;
      const w = Math.ceil(ctx0.measureText(typed).width) + 40;
      c.width = w;
      c.height = Math.ceil(size * 1.6);
      const ctx = c.getContext('2d')!;
      ctx.font = `${size}px ${font}`;
      ctx.fillStyle = ink;
      ctx.textBaseline = 'middle';
      ctx.fillText(typed, 20, c.height / 2);
    }
    return trimToPng(c);
  };

  const done = async () => {
    setError(null);
    try {
      const img = await finishImage();
      if (!img) {
        setError(tab === 'draw' ? 'Draw your signature first.' : tab === 'type' ? 'Type your name first.' : 'Choose an image first.');
        return;
      }
      if (remember) {
        const url = imageToDataUrl(img);
        if (url.length > MAX_STORED || img.format !== 'png' || !setItem(STORE_KEY, url)) setError('Couldn’t remember this signature (too large or storage unavailable). It was still added.');
      }
      onDone(img);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const savedImg = saved ? dataUrlToImage(saved) : null;

  return (
    <Modal
      title="Add signature"
      onClose={onClose}
      wide
      footer={
        <>
          <label className="check small" style={{ marginRight: 'auto' }}>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember on this device
          </label>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" onClick={done}>Add to page</button>
        </>
      }
    >
      <div className="stack">
        {savedImg && saved && (
          <div className="row">
            <img src={saved} alt="Saved signature" className="sig-preview" />
            <button type="button" className="btn primary small" onClick={() => onDone(savedImg)}>Use saved signature</button>
            <button type="button" className="btn small danger" onClick={() => { removeItem(STORE_KEY); setSaved(null); }}>Forget it</button>
          </div>
        )}
        <div className="tabs" role="tablist">
          {(['draw', 'type', 'upload'] as Tab[]).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              {t === 'draw' ? '✍️ Draw' : t === 'type' ? '⌨️ Type' : '🖼️ Upload'}
            </button>
          ))}
        </div>
        {tab !== 'upload' && (
          <div className="row">
            <span className="small muted">Ink</span>
            <div className="swatches">
              {INKS.map((c) => (
                <button key={c} type="button" className="swatch" style={{ background: c }} aria-pressed={ink === c} aria-label={c === INKS[0] ? 'Black ink' : 'Blue ink'} onClick={() => setInk(c)} />
              ))}
            </div>
          </div>
        )}
        {tab === 'draw' && (
          <>
            <canvas
              ref={canvasRef}
              className="sig-pad"
              aria-label="Signature pad: draw with mouse, finger or pen"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                drawing.current = [point(e)];
                strokes.current.push(drawing.current);
                redraw();
              }}
              onPointerMove={(e) => {
                if (!drawing.current) return;
                const evts = 'getCoalescedEvents' in e.nativeEvent ? e.nativeEvent.getCoalescedEvents() : [];
                const r = e.currentTarget.getBoundingClientRect();
                const pts = evts.length ? evts.map((ev) => ({ x: ev.clientX - r.left, y: ev.clientY - r.top, p: ev.pointerType === 'pen' && ev.pressure > 0 ? ev.pressure : 0.5 })) : [point(e)];
                for (const p of pts) {
                  const last = drawing.current[drawing.current.length - 1];
                  if (Math.hypot(p.x - last.x, p.y - last.y) >= 1.2) drawing.current.push(p);
                }
                redraw();
              }}
              onPointerUp={() => {
                drawing.current = null;
                setStrokeCount(strokes.current.length);
              }}
              onPointerCancel={() => (drawing.current = null)}
            />
            <div className="row">
              <button type="button" className="btn small" onClick={() => { strokes.current.pop(); setStrokeCount(strokes.current.length); redraw(); }} disabled={!strokeCount}>Undo stroke</button>
              <button type="button" className="btn small" onClick={() => { strokes.current = []; setStrokeCount(0); redraw(); }} disabled={!strokeCount}>Clear</button>
            </div>
          </>
        )}
        {tab === 'type' && (
          <>
            <label className="field">
              <span>Your name</span>
              <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Jane Doe" />
            </label>
            <div className="field">
              <span>Style</span>
              <select className="input" value={fontId} onChange={(e) => setFontId(e.target.value as FontId)}>
                {SCRIPT_FONTS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </div>
            <div className="sig-typed" style={{ fontFamily: font, color: ink, opacity: fontReady ? 1 : 0.5 }}>{typed || 'Preview'}</div>
            <p className="tiny muted">Uses the bundled {SCRIPT_FONTS.find((f) => f.id === fontId)?.label} font (same on every device) and is added to the PDF as an image.</p>
          </>
        )}
        {tab === 'upload' && (
          <>
            <input
              type="file"
              accept="image/*"
              aria-label="Signature image"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  setUpload(await prepareImageForPdf(f));
                } catch (err) {
                  setError(errorMessage(err));
                }
              }}
            />
            <p className="tiny muted">Tip: a PNG with a transparent background looks best.</p>
            {upload && <Notice kind="success">Image ready ({upload.width}×{upload.height}).</Notice>}
          </>
        )}
        {error && <Notice kind="error">{error}</Notice>}
        <p className="tiny muted">A drawn or typed signature is a picture of your signature. It isn’t a cryptographic digital signature.</p>
      </div>
    </Modal>
  );
}

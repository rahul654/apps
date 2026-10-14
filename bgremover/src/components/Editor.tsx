import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { applyPatch, intersectRect, refineLut, resetPatch, Stroke, subjectBounds, cropRect, unionRect } from '../lib/mask';
import { formatBytes } from '../lib/format';
import { getModel, planRun } from '../lib/models';
import type { Rect } from '../lib/preprocess';
import type { QueueItem } from '../lib/queue';
import { blurRadius, blurredImage, decodeImage, drawCover, readPixels, shadowFor, writeCutoutAlpha } from '../lib/render';
import { useApp } from '../store/AppStore';
import { IconAlert, IconCompare, IconEraser, IconFit, IconHand, IconBrush, IconRedo, IconReload, IconUndo, IconZoomIn, IconZoomOut } from './Icons';

type Tool = 'compare' | 'erase' | 'restore' | 'pan';

interface Session {
  key: string;
  bitmap: ImageBitmap;
  cutout: ImageData;
  srcAlpha: Uint8Array | null;
  w: number;
  h: number;
  scratch: Uint8Array;
}

interface View {
  scale: number;
  x: number;
  y: number;
}

type Gesture =
  | { kind: 'stroke'; stroke: Stroke }
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'pinch'; dist: number; mx: number; my: number; view: View }
  | { kind: 'compare' };

const TOOLS: { id: Tool; label: string; key: string; Icon: typeof IconCompare }[] = [
  { id: 'compare', label: 'Compare', key: 'C', Icon: IconCompare },
  { id: 'erase', label: 'Erase', key: 'E', Icon: IconEraser },
  { id: 'restore', label: 'Restore', key: 'R', Icon: IconBrush },
  { id: 'pan', label: 'Pan', key: 'H', Icon: IconHand },
];

const MAX_SCALE = 32;

export function Editor({ item }: { item: QueueItem }) {
  const app = useApp();
  const { prefs, setPrefs, bgImage, rerun } = app;
  const d = app.data(item.id);
  const stageRef = useRef<HTMLDivElement>(null);
  const cutRef = useRef<HTMLCanvasElement>(null);
  const bgRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>('compare');
  const [comparePos, setComparePos] = useState(50);
  const [view, setViewState] = useState<View>({ scale: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  const fitted = useRef(true);
  const [session, setSession] = useState<Session | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [, setHistRev] = useState(0);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [bounds, setBounds] = useState<Rect | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const spaceDown = useRef(false);
  const dirty = useRef<Rect | null>(null);
  const raf = useRef(0);

  const ready = item.status === 'done' && Boolean(d?.mask);
  const key = `${item.id}:${item.rev}`;
  const lut = useMemo(() => refineLut(item.refine), [item.refine]);
  const lutRef = useRef(lut);
  lutRef.current = lut;

  const setView = useCallback((v: View) => {
    viewRef.current = v;
    setViewState(v);
  }, []);

  // ----- Session: decode the image once per (item, result) -----
  useEffect(() => {
    if (!ready || !d) {
      setSession(null);
      return;
    }
    let live = true;
    let made: Session | null = null;
    setSessionError(null);
    decodeImage(d.file)
      .then((bitmap) => {
        if (!live) return bitmap.close();
        const { data, srcAlpha } = readPixels(bitmap);
        made = { key, bitmap, cutout: data, srcAlpha, w: bitmap.width, h: bitmap.height, scratch: new Uint8Array(bitmap.width * bitmap.height) };
        fitted.current = true;
        setSession(made);
      })
      .catch((e: Error) => live && setSessionError(e.message));
    return () => {
      live = false;
      made?.bitmap.close();
    };
  }, [ready, key, d]);

  const fit = useCallback(() => {
    const stage = stageRef.current;
    const w = session?.w ?? item.width;
    const h = session?.h ?? item.height;
    if (!stage || !w || !h) return;
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    const scale = Math.min(sw / w, sh / h) * 0.94;
    fitted.current = true;
    setView({ scale, x: (sw - w * scale) / 2, y: (sh - h * scale) / 2 });
  }, [session, item.width, item.height, setView]);

  useLayoutEffect(() => {
    if (session) fit();
  }, [session, fit]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const ro = new ResizeObserver(() => fitted.current && fit());
    ro.observe(stage);
    return () => ro.disconnect();
  }, [fit]);

  // ----- Drawing -----
  const updateBounds = useCallback(() => {
    if (!session) return;
    setBounds(subjectBounds(session.cutout.data, session.w, session.h, 16, 4, 3));
  }, [session]);

  const drawFull = useCallback(() => {
    const canvas = cutRef.current;
    if (!session || !canvas || !d?.mask) return;
    writeCutoutAlpha(session.cutout, d.mask, d.edits, lutRef.current, session.srcAlpha);
    canvas.getContext('2d')!.putImageData(session.cutout, 0, 0);
    updateBounds();
  }, [session, d, updateBounds]);

  useEffect(() => {
    const id = requestAnimationFrame(drawFull);
    return () => cancelAnimationFrame(id);
  }, [drawFull, lut]);

  const flush = useCallback(() => {
    raf.current = 0;
    const r = dirty.current;
    dirty.current = null;
    const canvas = cutRef.current;
    if (!r || !session || !canvas || !d?.mask) return;
    const rect = intersectRect(r, { x: 0, y: 0, w: session.w, h: session.h });
    if (!rect) return;
    writeCutoutAlpha(session.cutout, d.mask, d.edits, lutRef.current, session.srcAlpha, rect);
    canvas.getContext('2d')!.putImageData(session.cutout, 0, 0, rect.x, rect.y, rect.w, rect.h);
  }, [session, d]);

  const markDirty = useCallback(
    (r: Rect | null) => {
      if (!r) return;
      dirty.current = unionRect(dirty.current, r);
      if (!raf.current) raf.current = requestAnimationFrame(flush);
    },
    [flush],
  );

  // Background layer for blur / custom image.
  const longSide = session ? Math.max(session.w, session.h) : 0;
  const blurPx = session ? blurRadius(prefs, longSide) : 0;
  useEffect(() => {
    const c = bgRef.current;
    if (!c || !session) return;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (prefs.background === 'blur') ctx.drawImage(blurredImage(session.bitmap, session.w, session.h, blurPx), 0, 0);
    else if (prefs.background === 'image' && bgImage) drawCover(ctx, bgImage.bitmap, session.w, session.h);
  }, [session, prefs.background, blurPx, bgImage]);

  // ----- History -----
  const undo = useCallback(() => {
    if (!d?.edits || !session) return;
    const p = d.history.undo();
    if (!p) return;
    applyPatch(d.edits, session.w, p, 'undo');
    markDirty(p.rect);
    setHistRev((n) => n + 1);
    requestAnimationFrame(updateBounds);
  }, [d, session, markDirty, updateBounds]);

  const redo = useCallback(() => {
    if (!d?.edits || !session) return;
    const p = d.history.redo();
    if (!p) return;
    applyPatch(d.edits, session.w, p, 'redo');
    markDirty(p.rect);
    setHistRev((n) => n + 1);
    requestAnimationFrame(updateBounds);
  }, [d, session, markDirty, updateBounds]);

  const resetEdits = useCallback(() => {
    if (!d?.edits || !session) return;
    const p = resetPatch(d.edits, session.w, session.h);
    if (!p) return;
    applyPatch(d.edits, session.w, p, 'redo');
    d.history.push(p);
    markDirty(p.rect);
    setHistRev((n) => n + 1);
    requestAnimationFrame(updateBounds);
  }, [d, session, markDirty, updateBounds]);

  // ----- Zoom & pan -----
  const zoomAt = useCallback(
    (factor: number, cx?: number, cy?: number) => {
      const stage = stageRef.current;
      if (!stage) return;
      const v = viewRef.current;
      const w = session?.w ?? 1;
      const h = session?.h ?? 1;
      const minScale = Math.min(stage.clientWidth / w, stage.clientHeight / h) * 0.25;
      const scale = Math.min(MAX_SCALE, Math.max(minScale, v.scale * factor));
      const px = cx ?? stage.clientWidth / 2;
      const py = cy ?? stage.clientHeight / 2;
      fitted.current = false;
      setView({ scale, x: px - ((px - v.x) * scale) / v.scale, y: py - ((py - v.y) * scale) / v.scale });
    },
    [session, setView],
  );

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      if (!session) return;
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
      } else {
        const v = viewRef.current;
        fitted.current = false;
        setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
      }
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [session, zoomAt, setView]);

  // ----- Pointer input -----
  const toImage = (clientX: number, clientY: number) => {
    const r = stageRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - r.left - v.x) / v.scale, y: (clientY - r.top - v.y) / v.scale };
  };

  const brushRadius = () => prefs.brushSize / 2 / viewRef.current.scale;

  const endStroke = useCallback(() => {
    const g = gesture.current;
    if (g?.kind !== 'stroke' || !d) return;
    if (raf.current) {
      cancelAnimationFrame(raf.current);
      flush();
    }
    const patch = g.stroke.finish();
    gesture.current = null;
    if (patch) {
      d.history.push(patch);
      setHistRev((n) => n + 1);
      updateBounds();
    }
  }, [d, flush, updateBounds]);

  const setCompareFromClient = (clientX: number) => {
    if (!session) return;
    const { x } = toImage(clientX, 0);
    setComparePos(Math.round(Math.min(100, Math.max(0, (x / session.w) * 100))));
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!session || !d) return;
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      endStroke();
      const [a, b] = [...pointers.current.values()];
      const r = stageRef.current!.getBoundingClientRect();
      gesture.current = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top, view: viewRef.current };
      return;
    }
    if (pointers.current.size > 2) return;
    const panning = tool === 'pan' || e.button === 1 || spaceDown.current;
    if (panning) {
      const v = viewRef.current;
      gesture.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y };
    } else if (tool === 'erase' || tool === 'restore') {
      if (!d.edits) d.edits = new Int8Array(session.w * session.h);
      const stroke = new Stroke(d.edits, session.w, session.h, tool, session.scratch);
      gesture.current = { kind: 'stroke', stroke };
      const p = toImage(e.clientX, e.clientY);
      markDirty(stroke.to(p.x, p.y, brushRadius()));
    } else {
      gesture.current = { kind: 'compare' };
      setCompareFromClient(e.clientX);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = stageRef.current!.getBoundingClientRect();
    if (e.pointerType !== 'touch') setCursor({ x: e.clientX - r.left, y: e.clientY - r.top });
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'stroke') {
      const p = toImage(e.clientX, e.clientY);
      markDirty(g.stroke.to(p.x, p.y, brushRadius()));
    } else if (g.kind === 'pan') {
      fitted.current = false;
      setView({ ...viewRef.current, x: g.vx + e.clientX - g.sx, y: g.vy + e.clientY - g.sy });
    } else if (g.kind === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mx = (a.x + b.x) / 2 - r.left;
      const my = (a.y + b.y) / 2 - r.top;
      const scale = Math.min(MAX_SCALE, Math.max(0.01, (g.view.scale * dist) / g.dist));
      fitted.current = false;
      setView({ scale, x: mx - ((g.mx - g.view.x) * scale) / g.view.scale, y: my - ((g.my - g.view.y) * scale) / g.view.scale });
    } else if (g.kind === 'compare') {
      setCompareFromClient(e.clientX);
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g?.kind === 'stroke') endStroke();
    else if (g?.kind === 'pinch') {
      if (pointers.current.size < 2) gesture.current = null;
    } else gesture.current = null;
  };

  // ----- Keyboard shortcuts -----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && ((t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range' && (t as HTMLInputElement).type !== 'radio' && (t as HTMLInputElement).type !== 'checkbox') || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (typing) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (mod || e.altKey) return;
      if (e.key === ' ' && t?.tagName !== 'BUTTON') {
        spaceDown.current = true;
        if (t === document.body || stageRef.current?.contains(t)) e.preventDefault();
        return;
      }
      const k = e.key.toLowerCase();
      const toolKey = TOOLS.find((x) => x.key.toLowerCase() === k);
      if (toolKey) setTool(toolKey.id);
      else if (k === '[') setPrefs({ brushSize: Math.max(4, Math.round(prefs.brushSize / 1.2)) });
      else if (k === ']') setPrefs({ brushSize: Math.min(300, Math.round(prefs.brushSize * 1.2)) });
      else if (k === '0') fit();
      else if (k === '+' || k === '=') zoomAt(1.25);
      else if (k === '-') zoomAt(0.8);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') spaceDown.current = false;
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [undo, redo, fit, zoomAt, prefs.brushSize, setPrefs]);

  const shadow = session ? shadowFor(prefs, longSide) : null;
  const w = session?.w ?? item.width ?? 0;
  const h = session?.h ?? item.height ?? 0;
  const brushing = tool === 'erase' || tool === 'restore';
  const canUndo = Boolean(d?.history.canUndo);
  const canRedo = Boolean(d?.history.canRedo);
  const frame = prefs.crop && session ? cropRect(bounds, prefs.padding, w, h, prefs.background === 'blur') : null;
  const boxStyle: CSSProperties = { width: w, height: h, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, ['--checker' as string]: `${12 / view.scale}px` };
  const model = getModel(item.model);
  const runPlan = app.caps ? planRun(model, app.caps) : null;
  const consentSize = item.status === 'queued' && runPlan && !app.cached[item.model] && !app.allowed.has(item.model) ? runPlan.file.bytes : null;

  return (
    <section className="editor card" aria-labelledby="editor-h">
      <div className="editor-head">
        <div className="grow stack-xs">
          <h2 id="editor-h" className="clip" title={item.name}>
            {item.name}
          </h2>
          <span className="tiny muted">
            {w && h ? `${w} × ${h}px` : ''}
            {item.status === 'done' ? ` · ${model.name} model${item.backend === 'webgpu' ? ' on WebGPU' : ' on CPU'}` : ''}
          </span>
        </div>
        {(item.status === 'done' || item.status === 'error') && (
          <button type="button" className="btn small" onClick={() => rerun([item.id], prefs.model)} title="Run the selected model on this image again (clears brush edits)">
            <IconReload size={15} />
            {item.model === prefs.model ? 'Run again' : `Re-run with ${getModel(prefs.model).name}`}
          </button>
        )}
      </div>

      <div className="toolbar" role="toolbar" aria-label="Editing tools">
        <div className="segmented" role="group" aria-label="Tool">
          {TOOLS.map(({ id, label, key: k, Icon }) => (
            <button key={id} type="button" aria-pressed={tool === id} onClick={() => setTool(id)} disabled={!session} title={`${label} (${k})`}>
              <Icon size={16} />
              <span className="tool-label">{label}</span>
            </button>
          ))}
        </div>
        <label className="range-field brush-size">
          <span>Brush</span>
          <input type="range" min={4} max={300} value={prefs.brushSize} onChange={(e) => setPrefs({ brushSize: Number(e.target.value) })} aria-valuetext={`${prefs.brushSize} pixels`} />
        </label>
        <div className="row tight" role="group" aria-label="Zoom">
          <button type="button" className="btn ghost icon small" onClick={() => zoomAt(0.8)} disabled={!session} aria-label="Zoom out" title="Zoom out (−)">
            <IconZoomOut size={16} />
          </button>
          <button type="button" className="btn ghost small zoom-level" onClick={fit} disabled={!session} aria-label={`Zoom ${Math.round(view.scale * 100)}%, fit to view`} title="Fit (0)">
            <IconFit size={15} />
            {Math.round(view.scale * 100)}%
          </button>
          <button type="button" className="btn ghost icon small" onClick={() => zoomAt(1.25)} disabled={!session} aria-label="Zoom in" title="Zoom in (+)">
            <IconZoomIn size={16} />
          </button>
        </div>
        <div className="row tight" role="group" aria-label="History">
          <button type="button" className="btn ghost icon small" onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl/⌘+Z)">
            <IconUndo size={16} />
          </button>
          <button type="button" className="btn ghost icon small" onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl/⌘+Shift+Z)">
            <IconRedo size={16} />
          </button>
          <button type="button" className="btn ghost small" onClick={resetEdits} disabled={!d?.edits?.some((v) => v !== 0)}>
            Reset edits
          </button>
        </div>
      </div>

      <div
        ref={stageRef}
        className={`stage tool-${tool}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setCursor(null)}
        role="img"
        aria-label={session ? `Result for ${item.name}${tool === 'compare' ? `, original shown on the left ${comparePos}%` : ''}` : `Preview of ${item.name}`}
      >
        {session ? (
          <div className="layer-box" style={boxStyle}>
            <div className={`layer bg-${prefs.background}`} style={prefs.background === 'color' ? { background: prefs.color } : undefined} />
            <canvas ref={bgRef} className="layer" width={w} height={h} hidden={!(prefs.background === 'blur' || (prefs.background === 'image' && bgImage))} />
            <canvas
              ref={cutRef}
              className="layer"
              width={w}
              height={h}
              style={shadow ? { filter: `drop-shadow(0 ${shadow.offsetY}px ${shadow.blur}px ${shadow.color})` } : undefined}
            />
            {tool === 'compare' && (
              <>
                <img className="layer before" src={d?.url} alt="" style={{ clipPath: `inset(0 ${100 - comparePos}% 0 0)` }} draggable={false} />
                <div className="split-line" style={{ left: `${comparePos}%`, width: `${2 / view.scale}px` }} />
              </>
            )}
            {frame && <div className="crop-frame" style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h, borderWidth: `${1.5 / view.scale}px` }} />}
          </div>
        ) : (
          <div className="stage-placeholder">
            {d && <img src={d.url} alt="" className="placeholder-img" draggable={false} />}
            <div className="stage-status" role="status">
              {item.status === 'error' ? (
                <>
                  <IconAlert size={16} /> {item.error}
                </>
              ) : sessionError ? (
                <>
                  <IconAlert size={16} /> {sessionError}
                </>
              ) : item.status === 'done' ? (
                <>
                  <span className="spinner" aria-hidden="true" /> Opening…
                </>
              ) : item.status === 'processing' ? (
                <>
                  <span className="spinner" aria-hidden="true" /> Removing background…
                </>
              ) : consentSize !== null ? (
                <>
                  <span>Waiting for the model</span>
                  <button type="button" className="btn primary small" onClick={() => app.allowModel(item.model)}>
                    Download {formatBytes(consentSize)} and start
                  </button>
                </>
              ) : (
                'Waiting in the queue'
              )}
            </div>
          </div>
        )}
        {session && brushing && cursor && (
          <div className={`brush-cursor ${tool}`} style={{ left: cursor.x, top: cursor.y, width: prefs.brushSize, height: prefs.brushSize }} aria-hidden="true" />
        )}
      </div>

      {session && tool === 'compare' && (
        <label className="range-field compare-range">
          <span>Before / after</span>
          <input type="range" min={0} max={100} value={comparePos} onChange={(e) => setComparePos(Number(e.target.value))} aria-valuetext={`Original shown on the left ${comparePos}%`} />
        </label>
      )}
      {session && brushing && (
        <p className="tiny muted hint">
          {tool === 'erase' ? 'Paint over areas to remove them.' : 'Paint over areas to bring back the original pixels.'} Drag with two fingers, the Pan tool or Space+drag to move; scroll or pinch to zoom. Edits change the mask only, so nothing is lost.
        </p>
      )}
    </section>
  );
}

/**
 * Screenshot annotation editor: toolbar + one canvas at the image's full resolution (scaled
 * down by CSS). Pointer positions are mapped to image pixels, and drawing goes through
 * media/annotateRender.ts, the same code the export uses.
 *
 * The committed scene lives in an undo history; the shape being dragged lives in a ref and is
 * painted on the next animation frame, so dragging doesn't re-render React.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  addPenPoint,
  bounds,
  clampRect,
  COLORS,
  HIGHLIGHT_COLORS,
  hitHandle,
  hitTest,
  historyOf,
  isDegenerate,
  moveAnnotation,
  normRect,
  pushHistory,
  redo,
  replaceAnnotation,
  resizeAnnotation,
  resizeRect,
  strokeWidth,
  styleUnit,
  textSize,
  undo,
  viewRect,
  type Annotation,
  type HandleId,
  type History,
  type MarkSize,
  type Pt,
  type Rect,
  type Scene,
  type TextAnn,
  type ToolId,
} from '../../lib/annotations';
import type { Prefs } from '../../lib/prefs';
import { drawOverlay, drawScene, measureText, textFont, textPad, type LoadedImage } from '../../media/annotateRender';
import {
  IconArrow,
  IconBlur,
  IconCrop,
  IconHighlighter,
  IconPen,
  IconPointer,
  IconRedo,
  IconSpotlight,
  IconSquare,
  IconText,
  IconTrash,
  IconUndo,
} from '../Icons';

const TOOLS: Array<{ id: ToolId; label: string; key: string; icon: ReactNode; hint: string }> = [
  { id: 'select', label: 'Select', key: 'V', icon: <IconPointer />, hint: 'Click a mark to move it, drag its corners to resize. Delete removes it.' },
  { id: 'highlight', label: 'Highlight', key: 'H', icon: <IconHighlighter />, hint: 'Drag over the part to highlight.' },
  { id: 'spotlight', label: 'Spotlight', key: 'S', icon: <IconSpotlight />, hint: 'Drag over what matters; everything else is dimmed.' },
  { id: 'rect', label: 'Box', key: 'R', icon: <IconSquare />, hint: 'Drag to draw a box.' },
  { id: 'arrow', label: 'Arrow', key: 'A', icon: <IconArrow />, hint: 'Drag from the tail to the tip. Hold Shift to snap the angle.' },
  { id: 'pen', label: 'Pen', key: 'P', icon: <IconPen />, hint: 'Draw freehand.' },
  { id: 'text', label: 'Text', key: 'T', icon: <IconText />, hint: 'Click where the text goes. Click outside or press Ctrl+Enter to finish.' },
  { id: 'blur', label: 'Blur', key: 'B', icon: <IconBlur />, hint: 'Drag over passwords, tokens or personal data. Blurred pixels are removed from the downloaded image.' },
  { id: 'crop', label: 'Crop', key: 'C', icon: <IconCrop />, hint: 'Drag the frame or its corners. Enter applies, Esc cancels.' },
];

const MARK_TYPES = new Set<Annotation['type']>(['rect', 'arrow', 'pen', 'text']);

type StylePrefs = Pick<Prefs, 'markColor' | 'highlightColor' | 'markSize' | 'blurStyle'>;

type Drag =
  | { kind: 'draw'; start: Pt; ann: Annotation }
  | { kind: 'move'; start: Pt; orig: Annotation; ann: Annotation }
  | { kind: 'resize'; handle: HandleId; orig: Annotation; ann: Annotation }
  | { kind: 'crop'; mode: 'new' | 'move' | HandleId; start: Pt; orig: Rect; rect: Rect };

interface TextEdit {
  /** Existing annotation being edited, or null for a new one. */
  id: string | null;
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
}

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);

let measureCtx: CanvasRenderingContext2D | null = null;
function measure(text: string, size: number) {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  return measureCtx ? measureText(measureCtx, text, size) : { w: text.length * size * 0.6, h: size * 1.4 };
}

const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function Swatches({ label, colors, value, onChange }: { label: string; colors: readonly string[]; value: string; onChange: (c: string) => void }) {
  const id = useId();
  return (
    <div className="swatches" role="radiogroup" aria-labelledby={id}>
      <span id={id} className="sr-only">
        {label}
      </span>
      {colors.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={c === value} aria-label={c} title={c} className="swatch" style={{ background: c }} onClick={() => onChange(c)} />
      ))}
    </div>
  );
}

function SizePicker({ value, onChange }: { value: MarkSize; onChange: (s: MarkSize) => void }) {
  return (
    <div className="segmented small-seg" role="group" aria-label="Size">
      {(['s', 'm', 'l'] as const).map((s) => (
        <button key={s} type="button" aria-pressed={value === s} onClick={() => onChange(s)} title={{ s: 'Thin / small', m: 'Medium', l: 'Thick / large' }[s]}>
          {s.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

export interface AnnotatorProps {
  image: LoadedImage;
  initialScene: Scene;
  styles: StylePrefs;
  onStylesChange: (patch: Partial<StylePrefs>) => void;
  /** Called with every committed change (not during drags). */
  onSceneChange: (scene: Scene) => void;
  /** Ctrl/⌘+C with nothing selected in the page. */
  onCopy?: () => void;
  label: string;
}

export function Annotator({ image, initialScene, styles, onStylesChange, onSceneChange, onCopy, label }: AnnotatorProps) {
  const [hist, setHist] = useState<History<Scene>>(() => historyOf(initialScene));
  const [tool, setTool] = useState<ToolId>('highlight');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [textEdit, setTextEdit] = useState<TextEdit | null>(null);
  const [cropDraft, setCropDraft] = useState<Rect | null>(null);
  const [zoom, setZoom] = useState<'fit' | 'actual'>('fit');
  const [displayW, setDisplayW] = useState(0);
  const [announce, setAnnounce] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const drag = useRef<Drag | null>(null);
  const raf = useRef(0);

  const scene = hist.present;
  const W = image.width;
  const H = image.height;
  const unit = styleUnit(W, H);
  const cropping = tool === 'crop' && cropDraft !== null;
  const view: Rect = cropping ? { x: 0, y: 0, w: W, h: H } : viewRect(scene, W, H);
  const pxPerScreen = displayW > 0 ? view.w / displayW : 1;
  const selected = scene.annotations.find((a) => a.id === selectedId) ?? null;

  // Everything the paint callback needs, read at paint time.
  const live = useRef({ scene, view, pxPerScreen, selectedId, cropDraft, cropping, textEditId: textEdit?.id ?? null, image });
  live.current = { scene, view, pxPerScreen, selectedId, cropDraft, cropping, textEditId: textEdit?.id ?? null, image };

  const paint = useCallback(() => {
    raf.current = 0;
    const c = canvasRef.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const L = live.current;
    const d = drag.current;
    if (c.width !== L.view.w) c.width = L.view.w;
    if (c.height !== L.view.h) c.height = L.view.h;
    let anns = L.scene.annotations;
    let sel: Annotation | null = anns.find((a) => a.id === L.selectedId) ?? null;
    if (d && d.kind !== 'crop') {
      anns = d.kind === 'draw' ? [...anns, d.ann] : replaceAnnotation(anns, d.ann);
      sel = d.kind === 'draw' ? null : d.ann;
    }
    const shown: Scene = { annotations: anns, crop: L.scene.crop };
    drawScene(ctx, L.image.source, L.image.width, L.image.height, shown, { view: L.view, hideId: L.textEditId ?? undefined });
    const crop = L.cropping ? (d?.kind === 'crop' ? d.rect : L.cropDraft) : null;
    drawOverlay(ctx, { view: L.view, pxPerScreen: L.pxPerScreen, selected: L.textEditId ? null : sel, crop }, bounds);
  }, []);

  const schedule = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(paint);
  }, [paint]);

  useLayoutEffect(() => {
    paint();
  });
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // Track the canvas' on-screen width (handle size, text box position).
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setDisplayW(c.getBoundingClientRect().width));
    ro.observe(c);
    setDisplayW(c.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  // Report committed changes (skips the initial scene).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    onSceneChange(scene);
  }, [scene, onSceneChange]);

  const commit = useCallback((next: Scene, message?: string) => {
    setHist((h) => pushHistory(h, next));
    if (message) setAnnounce(message);
  }, []);

  // ---------- Text ----------

  // The pointerdown that ends an edit is followed by the textarea's blur: the ref makes the
  // second call a no-op instead of adding the text twice.
  const textEditRef = useRef<TextEdit | null>(null);
  textEditRef.current = textEdit;
  const closeText = useCallback(() => {
    textEditRef.current = null;
    setTextEdit(null);
  }, []);

  const commitText = useCallback(() => {
    const te = textEditRef.current;
    if (!te) return;
    closeText();
    const text = te.text.replace(/\s+$/, '');
    const anns = live.current.scene.annotations;
    const existing = te.id ? (anns.find((a) => a.id === te.id) as TextAnn | undefined) : undefined;
    if (existing) {
      if (!text) {
        commit({ ...live.current.scene, annotations: anns.filter((a) => a.id !== existing.id) }, 'Text removed');
        setSelectedId(null);
      } else if (text !== existing.text) {
        commit({ ...live.current.scene, annotations: replaceAnnotation(anns, { ...existing, text, ...measure(text, existing.size) }) }, 'Text updated');
      }
      return;
    }
    if (!text) return;
    const ann: TextAnn = { id: newId(), type: 'text', x: te.x, y: te.y, text, color: te.color, size: te.size, ...measure(text, te.size) };
    commit({ ...live.current.scene, annotations: [...anns, ann] }, 'Text added');
    setSelectedId(ann.id);
  }, [closeText, commit]);

  const editing = textEdit !== null;
  useEffect(() => {
    if (editing) textRef.current?.focus();
  }, [editing]);

  const editText = (a: TextAnn) => {
    setSelectedId(a.id);
    setTextEdit({ id: a.id, x: a.x, y: a.y, text: a.text, color: a.color, size: a.size });
  };

  // ---------- Tools ----------

  const applyCrop = useCallback(() => {
    if (!cropDraft) return;
    const r = clampRect(cropDraft, W, H);
    const full = !r || (r.x === 0 && r.y === 0 && r.w === W && r.h === H);
    const next = full ? null : r;
    const cur = live.current.scene.crop;
    if (JSON.stringify(next) !== JSON.stringify(cur)) commit({ ...live.current.scene, crop: next }, next ? `Cropped to ${next.w} × ${next.h}` : 'Crop removed');
    setCropDraft(null);
  }, [cropDraft, W, H, commit]);

  const chooseTool = useCallback(
    (t: ToolId) => {
      if (textEdit) commitText();
      if (tool === 'crop' && t !== 'crop') applyCrop();
      if (t === 'crop') setCropDraft(live.current.scene.crop ?? { x: 0, y: 0, w: W, h: H });
      if (t !== 'select') setSelectedId(null);
      setTool(t);
    },
    [textEdit, commitText, tool, applyCrop, W, H],
  );

  const deleteSelected = useCallback(() => {
    const id = live.current.selectedId;
    if (!id) return;
    commit({ ...live.current.scene, annotations: live.current.scene.annotations.filter((a) => a.id !== id) }, 'Mark deleted');
    setSelectedId(null);
  }, [commit]);

  const doUndo = useCallback(() => {
    closeText();
    setHist((h) => undo(h));
    setAnnounce('Undone');
  }, [closeText]);
  const doRedo = useCallback(() => {
    closeText();
    setHist((h) => redo(h));
    setAnnounce('Redone');
  }, [closeText]);

  // A selection that undo removed.
  useEffect(() => {
    if (selectedId && !scene.annotations.some((a) => a.id === selectedId)) setSelectedId(null);
  }, [scene, selectedId]);

  // Style changes apply to the selected mark too.
  const setStyle = (patch: Partial<StylePrefs>) => {
    onStylesChange(patch);
    const a = selected;
    if (!a) return;
    let next: Annotation = a;
    if (patch.highlightColor && a.type === 'highlight') next = { ...a, color: patch.highlightColor };
    if (patch.markColor && (a.type === 'rect' || a.type === 'arrow' || a.type === 'pen' || a.type === 'text')) next = { ...a, color: patch.markColor };
    if (patch.markSize) {
      if (a.type === 'rect' || a.type === 'arrow' || a.type === 'pen') next = { ...a, width: strokeWidth(patch.markSize, unit) };
      if (a.type === 'text') {
        const size = textSize(patch.markSize, unit);
        next = { ...a, size, ...measure(a.text, size) };
      }
    }
    if (patch.blurStyle && a.type === 'blur') next = { ...a, style: patch.blurStyle };
    if (next !== a) commit({ ...scene, annotations: replaceAnnotation(scene.annotations, next) });
  };

  // ---------- Pointer ----------

  const toImage = (e: { clientX: number; clientY: number }): Pt => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    const v = live.current.view;
    return { x: v.x + ((e.clientX - r.left) * v.w) / r.width, y: v.y + ((e.clientY - r.top) * v.h) / r.height };
  };
  const tolerance = () => {
    const c = canvasRef.current!;
    return (8 * live.current.view.w) / Math.max(1, c.getBoundingClientRect().width);
  };
  const clampPt = (p: Pt): Pt => ({ x: Math.max(0, Math.min(W, p.x)), y: Math.max(0, Math.min(H, p.y)) });

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    if (textEdit) {
      commitText();
      return;
    }
    const p = toImage(e);
    const tol = tolerance();
    const anns = scene.annotations;
    e.currentTarget.setPointerCapture(e.pointerId);

    if (tool === 'crop') {
      const cur = cropDraft ?? { x: 0, y: 0, w: W, h: H };
      const h = hitHandle(cur, p, tol);
      // Inside a frame smaller than the image = move it; otherwise draw a new one.
      const whole = cur.w >= W && cur.h >= H;
      const inCrop = !whole && p.x >= cur.x && p.x <= cur.x + cur.w && p.y >= cur.y && p.y <= cur.y + cur.h;
      drag.current = { kind: 'crop', mode: h ?? (inCrop ? 'move' : 'new'), start: clampPt(p), orig: cur, rect: cur };
      return;
    }
    // A handle of the selected mark wins with any tool.
    if (selected) {
      const h = hitHandle(selected, p, tol);
      if (h) {
        drag.current = { kind: 'resize', handle: h, orig: selected, ann: selected };
        return;
      }
    }
    if (tool === 'select' || tool === 'text') {
      const hit = hitTest(anns, p, tol);
      // Opening the text box: stop the mousedown that follows from moving focus off it.
      if (tool === 'text' && hit?.type === 'text') {
        e.preventDefault();
        editText(hit);
        return;
      }
      if (tool === 'select') {
        setSelectedId(hit?.id ?? null);
        if (hit) drag.current = { kind: 'move', start: p, orig: hit, ann: hit };
        if (hit && e.detail >= 2 && hit.type === 'text') {
          e.preventDefault();
          editText(hit);
        }
        return;
      }
      e.preventDefault();
      const size = textSize(styles.markSize, unit);
      setSelectedId(null);
      setTextEdit({ id: null, x: Math.round(p.x - textPad(size)), y: Math.round(p.y - size * 0.75), text: '', color: styles.markColor, size });
      return;
    }
    const id = newId();
    const q = clampPt(p);
    const width = strokeWidth(styles.markSize, unit);
    let ann: Annotation;
    if (tool === 'highlight') ann = { id, type: 'highlight', x: q.x, y: q.y, w: 0, h: 0, color: styles.highlightColor };
    else if (tool === 'spotlight') ann = { id, type: 'spotlight', x: q.x, y: q.y, w: 0, h: 0 };
    else if (tool === 'rect') ann = { id, type: 'rect', x: q.x, y: q.y, w: 0, h: 0, color: styles.markColor, width };
    else if (tool === 'blur') ann = { id, type: 'blur', x: q.x, y: q.y, w: 0, h: 0, style: styles.blurStyle };
    else if (tool === 'arrow') ann = { id, type: 'arrow', x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: styles.markColor, width };
    else ann = { id, type: 'pen', points: [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10], color: styles.markColor, width };
    setSelectedId(null);
    drag.current = { kind: 'draw', start: q, ann };
    schedule();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    const p = toImage(e);
    if (!d) {
      // Hover cursor.
      const c = e.currentTarget;
      const tol = tolerance();
      let cursor = tool === 'text' ? 'text' : tool === 'select' ? 'default' : 'crosshair';
      if (tool === 'crop' && cropDraft) {
        const h = hitHandle(cropDraft, p, tol);
        const whole = cropDraft.w >= W && cropDraft.h >= H;
        cursor = h ? (h === 'nw' || h === 'se' ? 'nwse-resize' : 'nesw-resize') : whole ? 'crosshair' : 'move';
      } else if (selected && hitHandle(selected, p, tol)) cursor = selected.type === 'arrow' ? 'grab' : 'nwse-resize';
      else if (tool === 'select' && hitTest(scene.annotations, p, tol)) cursor = 'move';
      if (c.style.cursor !== cursor) c.style.cursor = cursor;
      return;
    }
    if (d.kind === 'draw') {
      const a = d.ann;
      if (a.type === 'arrow') {
        let q = p;
        if (e.shiftKey) {
          const ang = Math.round(Math.atan2(p.y - a.y1, p.x - a.x1) / (Math.PI / 12)) * (Math.PI / 12);
          const len = Math.hypot(p.x - a.x1, p.y - a.y1);
          q = { x: a.x1 + Math.cos(ang) * len, y: a.y1 + Math.sin(ang) * len };
        }
        d.ann = { ...a, x2: q.x, y2: q.y };
      } else if (a.type === 'pen') {
        d.ann = { ...a, points: addPenPoint(a.points, p, 1.5 * live.current.pxPerScreen) };
      } else if (a.type !== 'text') {
        d.ann = { ...a, ...normRect(d.start, clampPt(p)) };
      }
    } else if (d.kind === 'move') {
      d.ann = moveAnnotation(d.orig, p.x - d.start.x, p.y - d.start.y);
    } else if (d.kind === 'resize') {
      d.ann = resizeAnnotation(d.orig, d.handle, d.orig.type === 'arrow' ? p : clampPt(p));
    } else if (d.kind === 'crop') {
      const q = clampPt(p);
      if (d.mode === 'new') d.rect = normRect(d.start, q);
      else if (d.mode === 'move') {
        const dx = Math.max(-d.orig.x, Math.min(W - d.orig.x - d.orig.w, q.x - d.start.x));
        const dy = Math.max(-d.orig.y, Math.min(H - d.orig.y - d.orig.h, q.y - d.start.y));
        d.rect = { ...d.orig, x: d.orig.x + dx, y: d.orig.y + dy };
      } else d.rect = resizeRect(d.orig, d.mode, q);
    }
    schedule();
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'draw') {
      const a = d.ann.type === 'pen' || d.ann.type === 'arrow' ? d.ann : { ...d.ann, x: Math.round(d.ann.x), y: Math.round(d.ann.y), w: Math.round(d.ann.w), h: Math.round(d.ann.h) };
      if (!isDegenerate(a)) {
        commit({ ...scene, annotations: [...scene.annotations, a] }, `${TOOLS.find((t) => t.id === tool)?.label ?? 'Mark'} added`);
        setSelectedId(a.id);
      }
    } else if (d.kind === 'move' || d.kind === 'resize') {
      if (d.ann !== d.orig && !isDegenerate(d.ann)) commit({ ...scene, annotations: replaceAnnotation(scene.annotations, d.ann) });
    } else if (d.kind === 'crop') {
      setCropDraft(d.rect.w >= 8 && d.rect.h >= 8 ? d.rect : d.orig);
    }
    schedule();
  };

  // ---------- Keyboard ----------

  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (TYPING.has(t.tagName) || t.isContentEditable)) return;
    if (document.querySelector('dialog[open]')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) doUndo();
      else if ((k === 'z' && e.shiftKey) || k === 'y') doRedo();
      else if (k === 'c' && onCopy && !window.getSelection()?.toString()) onCopy();
      else return;
      e.preventDefault();
      return;
    }
    if (e.altKey || mod) return;
    if (e.key === 'Escape') {
      if (drag.current) {
        drag.current = null;
        schedule();
      } else if (tool === 'crop') {
        setCropDraft(null);
        setTool('select');
      } else setSelectedId(null);
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter' && tool === 'crop') {
      applyCrop();
      setTool('select');
      e.preventDefault();
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
      deleteSelected();
      e.preventDefault();
      return;
    }
    if (selected && e.key.startsWith('Arrow')) {
      const step = (e.shiftKey ? 10 : 1) * Math.max(1, Math.round(pxPerScreen));
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      commit({ ...scene, annotations: replaceAnnotation(scene.annotations, moveAnnotation(selected, dx, dy)) });
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter' && selected?.type === 'text') {
      editText(selected);
      e.preventDefault();
      return;
    }
    const tl = TOOLS.find((x) => x.key === e.key.toUpperCase());
    if (tl && !e.shiftKey && !e.repeat) {
      chooseTool(tl.id);
      e.preventDefault();
    }
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  // ---------- Render ----------

  const toolInfo = TOOLS.find((t) => t.id === tool)!;
  const styleTarget: Annotation['type'] | ToolId = tool === 'select' && selected ? selected.type : tool;
  const showMark = MARK_TYPES.has(styleTarget as Annotation['type']);
  const textBox = textEdit ? measure(textEdit.text || ' ', textEdit.size) : null;
  const countLabel = `${scene.annotations.length} mark${scene.annotations.length === 1 ? '' : 's'}`;

  return (
    <div className="annotator stack-sm">
      <div className="anno-toolbar" role="toolbar" aria-label="Annotation tools">
        <div className="tool-group">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="btn icon tool-btn"
              aria-pressed={tool === t.id}
              aria-keyshortcuts={t.key}
              title={`${t.label} (${t.key})`}
              aria-label={t.label}
              onClick={() => chooseTool(t.id)}
            >
              {t.icon}
              <span className="tool-label">{t.label}</span>
            </button>
          ))}
        </div>
        <span className="spacer" />
        <div className="tool-group">
          <button type="button" className="btn icon" onClick={doUndo} disabled={hist.past.length === 0} aria-label="Undo" title="Undo (Ctrl+Z)">
            <IconUndo />
          </button>
          <button type="button" className="btn icon" onClick={doRedo} disabled={hist.future.length === 0} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
            <IconRedo />
          </button>
          <div className="segmented small-seg" role="group" aria-label="Zoom">
            <button type="button" aria-pressed={zoom === 'fit'} onClick={() => setZoom('fit')}>
              Fit
            </button>
            <button type="button" aria-pressed={zoom === 'actual'} onClick={() => setZoom('actual')} title="One image pixel per screen pixel">
              1:1
            </button>
          </div>
        </div>
      </div>

      <div className="anno-options row">
        {(styleTarget === 'highlight') && (
          <Swatches label="Highlight colour" colors={HIGHLIGHT_COLORS} value={selected?.type === 'highlight' ? selected.color : styles.highlightColor} onChange={(c) => setStyle({ highlightColor: c })} />
        )}
        {showMark && (
          <>
            <Swatches
              label="Colour"
              colors={COLORS}
              value={selected && 'color' in selected && selected.type !== 'highlight' ? selected.color : styles.markColor}
              onChange={(c) => setStyle({ markColor: c })}
            />
            <SizePicker value={styles.markSize} onChange={(s) => setStyle({ markSize: s })} />
          </>
        )}
        {styleTarget === 'blur' && (
          <div className="segmented small-seg" role="group" aria-label="Blur style">
            {(['pixelate', 'solid'] as const).map((s) => (
              <button key={s} type="button" aria-pressed={(selected?.type === 'blur' ? selected.style : styles.blurStyle) === s} onClick={() => setStyle({ blurStyle: s })}>
                {s === 'pixelate' ? 'Pixelate' : 'Solid box'}
              </button>
            ))}
          </div>
        )}
        {tool === 'crop' && cropDraft && (
          <>
            <span className="mono small">
              {Math.round(cropDraft.w)} × {Math.round(cropDraft.h)}
            </span>
            <button type="button" className="btn small primary" onClick={() => { applyCrop(); setTool('select'); }}>
              Apply crop
            </button>
            <button type="button" className="btn small" onClick={() => setCropDraft({ x: 0, y: 0, w: W, h: H })}>
              Reset
            </button>
            <button type="button" className="btn small ghost" onClick={() => { setCropDraft(null); setTool('select'); }}>
              Cancel
            </button>
          </>
        )}
        {tool === 'select' && selected && (
          <button type="button" className="btn small ghost danger" onClick={deleteSelected}>
            <IconTrash size={16} /> Delete mark
          </button>
        )}
        <span className="muted small anno-hint">{tool === 'select' && selected ? 'Arrow keys nudge, Delete removes.' : toolInfo.hint}</span>
      </div>

      <div className={zoom === 'fit' ? 'anno-stage fit' : 'anno-stage actual'}>
        <div className="anno-canvas-wrap">
          <canvas
            ref={canvasRef}
            className="anno-canvas"
            role="img"
            aria-label={`${label} (${countLabel})`}
            style={zoom === 'actual' ? { width: view.w / (window.devicePixelRatio || 1) } : undefined}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={(e) => {
              const hit = hitTest(scene.annotations, toImage(e), tolerance());
              if (hit?.type === 'text') editText(hit);
            }}
          />
          {textEdit && textBox && (
            <textarea
              ref={textRef}
              className="anno-text"
              aria-label="Annotation text"
              value={textEdit.text}
              spellCheck={false}
              rows={1}
              style={{
                left: (textEdit.x - view.x) / pxPerScreen,
                top: (textEdit.y - view.y) / pxPerScreen,
                width: Math.max(textBox.w, textEdit.size * 4) / pxPerScreen + 4,
                height: textBox.h / pxPerScreen + 4,
                font: textFont(textEdit.size / pxPerScreen),
                lineHeight: 1.25,
                padding: textPad(textEdit.size) / pxPerScreen,
                color: textEdit.color,
              }}
              onChange={(e) => setTextEdit({ ...textEdit, text: e.target.value })}
              onBlur={commitText}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  closeText();
                } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  commitText();
                }
              }}
            />
          )}
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}

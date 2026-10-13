import { memo, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { uid } from '../../../lib/array';
import { makeParagraph, type Paragraph } from '../../../lib/text/model';
import { RichTextEditor } from './richtext/RichTextEditor';
import { TextBoxView } from './richtext/TextBoxView';
import type { TextInfo } from './textEngine';
import {
  arrowHead,
  objectBounds,
  resizeObject,
  smoothPath,
  translateObject,
  type EditorObject,
  type FormFieldInfo,
  type FormValue,
  type ResizeHandle,
  type TextObj,
} from '../../../lib/pdf/editorModel';
import { isCancelled, startRender, type PDFDocumentProxy } from '../../../lib/pdf/pdfjs';
import { DRAW_TOOLS, type ImageAsset, type Tool, type ToolStyle } from './types';

export interface PageViewProps {
  index: number;
  doc: PDFDocumentProxy;
  width: number;
  height: number;
  zoom: number;
  objects: EditorObject[];
  selectedId: string | null;
  editingId: string | null;
  tool: Tool;
  style: ToolStyle;
  images: Record<string, ImageAsset>;
  fields: FormFieldInfo[];
  formValues: Record<string, FormValue>;
  hasForm: boolean;
  measure: (t: TextObj) => { w: number; h: number };
  textInfo: (t: TextObj) => TextInfo;
  onSelect: (id: string | null) => void;
  onCreate: (o: EditorObject, edit?: boolean) => void;
  onBegin: () => void;
  onTransient: (o: EditorObject) => void;
  onEnd: () => void;
  onEditText: (id: string | null) => void;
  onTextChange: (id: string, paragraphs: Paragraph[]) => void;
  onFormChange: (name: string, value: FormValue) => void;
  registerEl: (index: number, el: HTMLDivElement | null) => void;
}

type Pt = { x: number; y: number };

/** Track pointer moves/ups on the window so drags keep working outside the element. */
function trackPointer(e: ReactPointerEvent, toPt: (ev: PointerEvent) => Pt, onMove: (p: Pt, ev: PointerEvent) => void, onUp: (p: Pt) => void) {
  const id = e.pointerId;
  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    ev.preventDefault();
    const evs = ev.getCoalescedEvents?.() ?? [];
    if (evs.length > 1) for (const c of evs) onMove(toPt(c), c);
    else onMove(toPt(ev), ev);
  };
  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    onUp(toPt(ev));
  };
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

function ShapeSvg({ o, zoom, selectable, onDown }: { o: EditorObject; zoom: number; selectable: boolean; onDown: (e: ReactPointerEvent) => void }) {
  const b = objectBounds(o);
  const sw = o.type === 'rect' || o.type === 'ellipse' ? o.strokeWidth : o.type === 'line' || o.type === 'path' ? o.width : 0;
  const pad = sw + 14;
  const vb = { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
  // touch-action on the <svg> root so dragging a shape with a finger doesn't scroll the page.
  const box: CSSProperties = { position: 'absolute', left: vb.x * zoom, top: vb.y * zoom, width: vb.w * zoom, height: vb.h * zoom, overflow: 'visible', pointerEvents: 'none', touchAction: selectable ? 'none' : undefined };
  const hitWidth = Math.max(sw, 12 / zoom);
  const hitProps = selectable ? { className: 'hit', onPointerDown: onDown } : {};
  let body: ReactNode = null;
  let hit: ReactNode = null;
  switch (o.type) {
    case 'rect':
      body = <rect x={o.x} y={o.y} width={o.w} height={o.h} fill={o.fill ?? 'none'} stroke={o.stroke ?? 'none'} strokeWidth={o.stroke ? o.strokeWidth : 0} opacity={o.opacity} />;
      hit = <rect x={o.x} y={o.y} width={o.w} height={o.h} fill="transparent" stroke="transparent" strokeWidth={hitWidth} pointerEvents="all" {...hitProps} />;
      break;
    case 'ellipse':
      body = <ellipse cx={o.x + o.w / 2} cy={o.y + o.h / 2} rx={o.w / 2} ry={o.h / 2} fill={o.fill ?? 'none'} stroke={o.stroke ?? 'none'} strokeWidth={o.stroke ? o.strokeWidth : 0} opacity={o.opacity} />;
      hit = <ellipse cx={o.x + o.w / 2} cy={o.y + o.h / 2} rx={o.w / 2} ry={o.h / 2} fill="transparent" stroke="transparent" strokeWidth={hitWidth} pointerEvents="all" {...hitProps} />;
      break;
    case 'cover':
      body = (
        <>
          <rect x={o.x} y={o.y} width={o.w} height={o.h} fill={o.color === 'black' ? '#000' : '#fff'} />
          {/* On-screen only: show where white boxes are; mark secure redactions. */}
          <rect x={o.x} y={o.y} width={o.w} height={o.h} fill="none" stroke={o.secure ? '#f59e0b' : o.color === 'white' ? 'rgba(37,99,235,0.45)' : 'none'} strokeWidth={1 / zoom} strokeDasharray={`${4 / zoom} ${3 / zoom}`} />
          {o.secure && o.h * zoom > 14 && o.w * zoom > 60 && (
            <text x={o.x + 3 / zoom} y={o.y + 11 / zoom} fontSize={9 / zoom} fill="#f59e0b" fontFamily="system-ui, sans-serif">
              SECURE REDACT
            </text>
          )}
        </>
      );
      hit = <rect x={o.x} y={o.y} width={o.w} height={o.h} fill="transparent" pointerEvents="all" {...hitProps} />;
      break;
    case 'line': {
      const head = o.arrow ? arrowHead(o.x1, o.y1, o.x2, o.y2, o.width) : null;
      body = (
        <g stroke={o.color} strokeWidth={o.width} strokeLinecap="round" opacity={o.opacity}>
          <line x1={o.x1} y1={o.y1} x2={o.x2} y2={o.y2} />
          {head && (
            <>
              <line x1={o.x2} y1={o.y2} x2={head[0]} y2={head[1]} />
              <line x1={o.x2} y1={o.y2} x2={head[2]} y2={head[3]} />
            </>
          )}
        </g>
      );
      hit = <line x1={o.x1} y1={o.y1} x2={o.x2} y2={o.y2} stroke="transparent" strokeWidth={hitWidth} pointerEvents="stroke" {...hitProps} />;
      break;
    }
    case 'path': {
      const d = smoothPath(o.points);
      body = <path d={d} fill="none" stroke={o.color} strokeWidth={o.width} strokeLinecap="round" strokeLinejoin="round" opacity={o.opacity} />;
      hit = <path d={d} fill="none" stroke="transparent" strokeWidth={hitWidth} strokeLinecap="round" pointerEvents="stroke" {...hitProps} />;
      break;
    }
    default:
      return null;
  }
  return (
    <svg style={{ ...box, mixBlendMode: o.type === 'path' && o.highlighter ? 'multiply' : undefined }} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} aria-hidden="true">
      {body}
      {hit}
    </svg>
  );
}

function PageViewImpl(p: PageViewProps) {
  const { index, doc, width, height, zoom, objects, selectedId, editingId, tool, style } = p;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [draft, setDraft] = useState<EditorObject | null>(null);
  const [renderFailed, setRenderFailed] = useState(false);
  const drawing = DRAW_TOOLS.includes(tool);

  // Lazy render: only pages near the viewport keep a rendered canvas.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    p.registerEl(index, el);
    const io = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), { rootMargin: '800px 0px' });
    io.observe(el);
    return () => {
      io.disconnect();
      p.registerEl(index, null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!visible) {
      canvas.width = canvas.height = 0;
      return;
    }
    let cancel: (() => void) | undefined;
    let stop = false;
    const t = setTimeout(async () => {
      try {
        const page = await doc.getPage(index + 1);
        if (stop) return;
        const r = startRender(page, canvas, zoom, Math.min(2, window.devicePixelRatio || 1), p.hasForm ? 'no-forms' : 'all');
        cancel = r.cancel;
        await r.promise;
        setRenderFailed(false);
      } catch (e) {
        if (!isCancelled(e) && !stop) setRenderFailed(true);
      }
    }, 120);
    return () => {
      stop = true;
      clearTimeout(t);
      cancel?.();
    };
  }, [visible, zoom, doc, index, p.hasForm]);

  const toPt = (ev: { clientX: number; clientY: number }): Pt => {
    const r = overlayRef.current!.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / zoom, y: (ev.clientY - r.top) / zoom };
  };

  const onOverlayDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (tool === 'select') {
      if (e.target === e.currentTarget || (e.target as Element).tagName === 'CANVAS') p.onSelect(null);
      return;
    }
    const start = toPt(e);
    if (tool === 'text') {
      e.preventDefault();
      const w = Math.max(60, Math.min(260, width - start.x - 8));
      const t: TextObj = {
        id: uid('t'),
        page: index,
        type: 'text',
        x: Math.min(start.x, Math.max(0, width - w)),
        y: start.y - style.textMarks.size * 0.7,
        w,
        paragraphs: [makeParagraph('', style.textMarks, style.align, style.lineHeight)],
        background: null,
        padding: 2,
        opacity: 1,
      };
      p.onCreate(t, true);
      return;
    }
    e.preventDefault();
    const id = uid('o');
    let obj: EditorObject;
    switch (tool) {
      case 'whiteout':
      case 'cover':
      case 'redact':
        obj = { id, page: index, type: 'cover', x: start.x, y: start.y, w: 0, h: 0, color: tool === 'whiteout' ? 'white' : 'black', secure: tool === 'redact' };
        break;
      case 'rect':
      case 'ellipse':
        obj = { id, page: index, type: tool, x: start.x, y: start.y, w: 0, h: 0, stroke: style.stroke, fill: style.fill, strokeWidth: style.strokeWidth, opacity: style.opacity };
        break;
      case 'line':
      case 'arrow':
        obj = { id, page: index, type: 'line', x1: start.x, y1: start.y, x2: start.x, y2: start.y, color: style.stroke, width: style.strokeWidth, arrow: tool === 'arrow', opacity: style.opacity };
        break;
      default:
        obj = {
          id,
          page: index,
          type: 'path',
          points: [start.x, start.y],
          color: tool === 'highlight' ? style.highlight : style.stroke,
          width: tool === 'highlight' ? style.highlightWidth : style.strokeWidth,
          opacity: tool === 'highlight' ? 0.4 : style.opacity,
          highlighter: tool === 'highlight',
        };
    }
    let cur = obj;
    setDraft(cur);
    trackPointer(
      e,
      toPt,
      (pt, ev) => {
        if (cur.type === 'path') {
          const n = cur.points.length;
          if (Math.hypot(pt.x - cur.points[n - 2], pt.y - cur.points[n - 1]) < 1 / zoom) return;
          cur = { ...cur, points: [...cur.points, pt.x, pt.y] };
        } else if (cur.type === 'line') {
          let { x, y } = pt;
          if (ev.shiftKey) {
            // Snap to 45° increments.
            const a = Math.round(Math.atan2(y - start.y, x - start.x) / (Math.PI / 4)) * (Math.PI / 4);
            const len = Math.hypot(x - start.x, y - start.y);
            x = start.x + len * Math.cos(a);
            y = start.y + len * Math.sin(a);
          }
          cur = { ...cur, x2: x, y2: y };
        } else if ('w' in cur) {
          let w = pt.x - start.x;
          let h = pt.y - start.y;
          if (ev.shiftKey) {
            const s = Math.max(Math.abs(w), Math.abs(h));
            w = Math.sign(w || 1) * s;
            h = Math.sign(h || 1) * s;
          }
          cur = { ...cur, x: Math.min(start.x, start.x + w), y: Math.min(start.y, start.y + h), w: Math.abs(w), h: Math.abs(h) };
        }
        setDraft(cur);
      },
      () => {
        setDraft(null);
        const b = objectBounds(cur);
        const tiny = cur.type === 'path' ? false : cur.type === 'line' ? Math.hypot(b.w, b.h) < 3 : b.w < 3 || b.h < 3;
        if (tiny) {
          // A click without dragging: create a default-sized box/line.
          if (cur.type === 'line') cur = { ...cur, x2: cur.x1 + 80, y2: cur.y1 };
          else if ('w' in cur) cur = { ...cur, w: cur.type === 'cover' ? 120 : 100, h: cur.type === 'cover' ? 20 : 60 };
        }
        p.onCreate(cur);
      },
    );
  };

  const startMove = (o: EditorObject, e: ReactPointerEvent) => {
    if (tool !== 'select' || editingId === o.id) return;
    e.stopPropagation();
    e.preventDefault();
    const wasSelected = selectedId === o.id;
    p.onSelect(o.id);
    const start = toPt(e);
    let moved = false;
    p.onBegin();
    trackPointer(
      e,
      toPt,
      (pt) => {
        const dx = pt.x - start.x;
        const dy = pt.y - start.y;
        if (!moved && Math.hypot(dx, dy) * zoom < 3) return;
        moved = true;
        p.onTransient(translateObject(o, dx, dy));
      },
      () => {
        p.onEnd();
        if (!moved && wasSelected && o.type === 'text') p.onEditText(o.id);
      },
    );
  };

  const startResize = (o: EditorObject, handle: ResizeHandle, e: ReactPointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const start = toPt(e);
    p.onBegin();
    trackPointer(
      e,
      toPt,
      (pt) => p.onTransient(resizeObject(o, handle, pt.x - start.x, pt.y - start.y)),
      () => p.onEnd(),
    );
  };

  const selected = objects.find((o) => o.id === selectedId) ?? null;
  const pageFields = p.fields;

  return (
    <div ref={wrapRef} className="editor-page" style={{ width: width * zoom, height: height * zoom }} data-page={index}>
      <span className="page-label">Page {index + 1}</span>
      <canvas ref={canvasRef} aria-label={`Page ${index + 1}`} role="img" />
      {renderFailed && <span className="muted small" style={{ position: 'absolute', top: 8, left: 8 }}>This page couldn’t be rendered.</span>}
      <div ref={overlayRef} className={`overlay${drawing ? ' drawing' : ''}${tool === 'text' ? ' texting' : ''}`} onPointerDown={onOverlayDown}>
        {pageFields.map((f) => {
          const st: CSSProperties = { left: f.rect.x * zoom, top: f.rect.y * zoom, width: f.rect.w * zoom, height: f.rect.h * zoom, pointerEvents: tool === 'select' ? 'auto' : 'none' };
          const value = p.formValues[f.name] ?? f.value;
          const label = `Form field ${f.name}`;
          const stop = (e: ReactPointerEvent) => e.stopPropagation();
          if (f.type === 'checkbox') {
            return <input key={f.key} type="checkbox" className="form-input" style={st} aria-label={label} checked={Boolean(value)} disabled={f.readOnly} onPointerDown={stop} onChange={(e) => p.onFormChange(f.name, e.target.checked)} />;
          }
          if (f.type === 'radio') {
            return <input key={f.key} type="radio" className="form-input" style={st} aria-label={`${label}: ${f.option ?? ''}`} name={`r-${f.name}`} checked={f.option !== undefined && value === f.option} disabled={f.readOnly || f.option === undefined} onPointerDown={stop} onChange={() => f.option && p.onFormChange(f.name, f.option)} />;
          }
          if (f.type === 'dropdown' || f.type === 'optionlist') {
            return (
              <select key={f.key} className="form-input" style={{ ...st, fontSize: Math.max(8, Math.min(f.rect.h * 0.6, 13)) * zoom }} aria-label={label} value={String(value)} disabled={f.readOnly} onPointerDown={stop} onChange={(e) => p.onFormChange(f.name, e.target.value)}>
                <option value="">—</option>
                {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            );
          }
          const fs = Math.max(6, Math.min(f.multiline ? 11 : f.rect.h * 0.62, 14)) * zoom;
          return f.multiline ? (
            <textarea key={f.key} className="form-input" style={{ ...st, fontSize: fs, resize: 'none' }} aria-label={label} value={String(value)} maxLength={f.maxLength} readOnly={f.readOnly} onPointerDown={stop} onChange={(e) => p.onFormChange(f.name, e.target.value)} />
          ) : (
            <input key={f.key} className="form-input" style={{ ...st, fontSize: fs }} aria-label={label} value={String(value)} maxLength={f.maxLength} readOnly={f.readOnly} onPointerDown={stop} onChange={(e) => p.onFormChange(f.name, e.target.value)} />
          );
        })}

        {[...objects, ...(draft ? [draft] : [])].map((o) => {
          const selectable = tool === 'select' && o !== draft;
          if (o.type === 'text') {
            if (o.id === editingId) {
              return <RichTextEditor key={o.id} obj={o} zoom={zoom} onChange={(paras) => p.onTextChange(o.id, paras)} onExit={() => p.onEditText(null)} />;
            }
            return (
              <TextBoxView
                key={o.id}
                obj={o}
                info={p.textInfo(o)}
                zoom={zoom}
                selectable={selectable}
                showBadge
                onPointerDown={(e) => startMove(o, e)}
                onDoubleClick={() => tool === 'select' && p.onEditText(o.id)}
              />
            );
          }
          if (o.type === 'image') {
            const asset = p.images[o.imageId];
            return (
              <div key={o.id} className={`obj obj-image${selectable ? ' selectable' : ''}`} style={{ left: o.x * zoom, top: o.y * zoom, width: o.w * zoom, height: o.h * zoom }} onPointerDown={(e) => startMove(o, e)}>
                {asset && <img src={asset.url} alt={o.signature ? 'Signature' : 'Placed image'} draggable={false} />}
              </div>
            );
          }
          return <ShapeSvg key={o.id} o={o} zoom={zoom} selectable={selectable} onDown={(e) => startMove(o, e)} />;
        })}

        {selected && tool === 'select' && selected.id !== editingId && (() => {
          const b = objectBounds(selected, p.measure);
          const handles: { h: ResizeHandle; x: number; y: number }[] =
            selected.type === 'line'
              ? [{ h: 'p1', x: selected.x1, y: selected.y1 }, { h: 'p2', x: selected.x2, y: selected.y2 }]
              : selected.type === 'path'
                ? []
                : selected.type === 'text'
                  ? [
                      { h: 'w', x: b.x, y: b.y + b.h / 2 },
                      { h: 'e', x: b.x + b.w, y: b.y + b.h / 2 },
                      { h: 'se', x: b.x + b.w, y: b.y + b.h },
                    ]
                  : [
                      { h: 'nw', x: b.x, y: b.y },
                      { h: 'ne', x: b.x + b.w, y: b.y },
                      { h: 'sw', x: b.x, y: b.y + b.h },
                      { h: 'se', x: b.x + b.w, y: b.y + b.h },
                    ];
          return (
            <>
              {selected.type !== 'line' && <div className="sel-box" style={{ left: b.x * zoom - 2, top: b.y * zoom - 2, width: b.w * zoom + 4, height: b.h * zoom + 4 }} />}
              {handles.map((h) => (
                <div
                  key={h.h}
                  className="handle"
                  role="presentation"
                  style={{ left: h.x * zoom, top: h.y * zoom, cursor: h.h === 'nw' || h.h === 'se' ? 'nwse-resize' : h.h === 'ne' || h.h === 'sw' ? 'nesw-resize' : h.h === 'e' || h.h === 'w' ? 'ew-resize' : 'move' }}
                  title={selected.type === 'text' ? (h.h === 'se' ? 'Drag to scale text' : 'Drag to change width') : undefined}
                  onPointerDown={(e) => startResize(selected, h.h, e)}
                />
              ))}
            </>
          );
        })()}
      </div>
    </div>
  );
}

export const PageView = memo(PageViewImpl);

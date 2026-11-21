import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { CSS_NO_SUBSTITUTION, cssFontFamily, resolveVariant } from '../../../../lib/fonts/registry';
import type { TextObj } from '../../../../lib/pdf/editorModel';
import type { TextInfo } from '../textEngine';

/**
 * Display mode of a text box: draws the shared layout result as positioned SVG text,
 * so what you see is exactly what the PDF writer / rasteriser will produce.
 */
export function TextBoxView({
  obj,
  info,
  zoom,
  selectable,
  showBadge,
  onPointerDown,
  onDoubleClick,
}: {
  obj: TextObj;
  info: TextInfo;
  zoom: number;
  selectable: boolean;
  showBadge: boolean;
  onPointerDown: (e: ReactPointerEvent) => void;
  onDoubleClick: () => void;
}) {
  const { layout, strategy } = info;
  const vector = strategy.kind === 'vector';
  const style: CSSProperties = { left: obj.x * zoom, top: obj.y * zoom, width: layout.width * zoom, height: layout.height * zoom, opacity: obj.opacity };
  const empty = layout.fragments.every((f) => f.space || !f.text);
  return (
    <div className={`obj obj-textbox${selectable ? ' selectable' : ''}${empty ? ' empty' : ''}`} style={style} onPointerDown={onPointerDown} onDoubleClick={onDoubleClick}>
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        style={{ fontFeatureSettings: vector ? CSS_NO_SUBSTITUTION : undefined, fontKerning: vector ? 'none' : undefined, overflow: 'visible' }}
        aria-hidden="true"
      >
        {obj.background && <rect x={0} y={0} width={layout.width} height={layout.height} fill={obj.background} />}
        {layout.decorations.filter((d) => d.kind === 'highlight').map((d, i) => (
          <rect key={`h${i}`} x={d.x} y={d.y} width={d.w} height={d.h} fill={d.color} />
        ))}
        {layout.fragments.map((f, i) => {
          if (f.space || !f.text) return null;
          const v = resolveVariant(f.marks.font, f.marks.bold, f.marks.italic);
          return (
            <text
              key={i}
              x={f.rtl ? f.x + f.width : f.x}
              y={f.baseline}
              direction={f.rtl ? 'rtl' : undefined}
              fontFamily={cssFontFamily(f.marks.font)}
              fontSize={f.marks.size}
              fontWeight={v.bold ? 700 : 400}
              fontStyle={v.italic ? 'italic' : 'normal'}
              fill={f.marks.color}
              // Vector boxes: pin each word to the exact PDF width so screen and PDF line up.
              textLength={vector && info.exact && f.width > 0 ? f.width : undefined}
              lengthAdjust={vector && info.exact ? 'spacingAndGlyphs' : undefined}
              style={{ whiteSpace: 'pre' }}
            >
              {f.text}
            </text>
          );
        })}
        {layout.decorations.filter((d) => d.kind !== 'highlight').map((d, i) => (
          <rect key={`d${i}`} x={d.x} y={d.y} width={d.w} height={d.h} fill={d.color} />
        ))}
      </svg>
      {empty && <span className="tb-placeholder">Empty text box</span>}
      {showBadge && strategy.kind === 'raster' && (
        <span className="tb-badge" title={info.note}>
          Saves as image — not selectable
        </span>
      )}
    </div>
  );
}

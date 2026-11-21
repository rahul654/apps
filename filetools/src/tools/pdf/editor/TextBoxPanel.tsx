import type { CSSProperties } from 'react';
import { fontDef, resolveVariant } from '../../../lib/fonts/registry';
import type { TextObj } from '../../../lib/pdf/editorModel';
import {
  clearFormatting,
  commonMarks,
  DEFAULT_MARKS,
  LINE_HEIGHTS,
  rangeHasMark,
  setMarks,
  setParagraphProps,
  toggleMark,
  type Align,
  type BoolMark,
  type RunMarks,
} from '../../../lib/text/model';
import { Notice } from '../../../components/Feedback';
import { FontPicker } from './richtext/FontPicker';
import { HIGHLIGHT_COLORS, TEXT_COLORS } from './richtext/RichTextEditor';
import type { TextInfo } from './textEngine';
import type { ToolStyle } from './types';

const BACKGROUNDS = ['#ffffff', '#fff8c5', '#e0f2fe', '#fde2e4', '#111111'];
const ALIGNS: { a: Align; icon: string; label: string }[] = [
  { a: 'left', icon: '⇤', label: 'Align left' },
  { a: 'center', icon: '↔', label: 'Center' },
  { a: 'right', icon: '⇥', label: 'Align right' },
  { a: 'justify', icon: '☰', label: 'Justify' },
];

function ColorRow({ colors, value, onChange, label, allowNone }: { colors: string[]; value: string | null | undefined; onChange: (c: string | null) => void; label: string; allowNone?: boolean }) {
  return (
    <div className="row" role="group" aria-label={label}>
      <div className="swatches">
        {colors.map((c) => (
          <button key={c} type="button" className="swatch" style={{ background: c }} aria-pressed={value?.toLowerCase() === c} aria-label={`${label} ${c}`} onClick={() => onChange(c)} />
        ))}
        {allowNone && (
          <button type="button" className="swatch none" aria-pressed={value === null} aria-label={`No ${label.toLowerCase()}`} title="None" onClick={() => onChange(null)}>⌀</button>
        )}
      </div>
      <input type="color" className="input" aria-label={`Custom ${label.toLowerCase()}`} value={value ?? '#000000'} onChange={(e) => onChange(e.target.value)} style={{ width: 40, minHeight: 30 }} />
    </div>
  );
}

/** Whole-box formatting (shown when a text box is selected but not being edited). */
export function TextBoxPanel({ obj, info, onChange, onEdit }: { obj: TextObj; info: TextInfo; onChange: (next: TextObj) => void; onEdit: () => void }) {
  const marks = commonMarks(obj.paragraphs, null);
  const set = (patch: Partial<RunMarks>) => onChange({ ...obj, paragraphs: setMarks(obj.paragraphs, null, patch) });
  const toggleAll = (m: BoolMark) => onChange({ ...obj, paragraphs: toggleMark(obj.paragraphs, null, m) });
  const aligns = new Set(obj.paragraphs.map((p) => p.align));
  const lhs = new Set(obj.paragraphs.map((p) => p.lineHeight));
  const align = aligns.size === 1 ? [...aligns][0] : undefined;
  const lh = lhs.size === 1 ? [...lhs][0] : undefined;
  const missing = new Set<string>();
  for (const p of obj.paragraphs)
    for (const r of p.runs) for (const m of resolveVariant(r.marks.font, r.marks.bold, r.marks.italic).missing) missing.add(`${fontDef(r.marks.font).label} has no ${m}`);
  const first = obj.paragraphs[0]?.runs[0]?.marks ?? DEFAULT_MARKS;
  const bool = (m: BoolMark, label: string, content: string, css: CSSProperties) => (
    <button type="button" className="btn small icon" aria-pressed={rangeHasMark(obj.paragraphs, null, m)} aria-label={`${label} (whole box)`} title={label} onClick={() => toggleAll(m)} style={css}>
      {content}
    </button>
  );
  return (
    <>
      <button type="button" className="btn small primary" onClick={onEdit}>✎ Edit text (Enter)</button>
      <p className="tiny muted">Styles below apply to the whole box. To style part of the text, edit it and select the words.</p>
      <div className="row">
        <FontPicker value={marks.font} onChange={(font) => set({ font })} />
        <label className="field" style={{ width: 80 }}>
          <span className="sr-only">Size</span>
          <input className="input" type="number" min={4} max={400} aria-label="Font size (pt), whole box" placeholder="mixed" value={marks.size ?? ''} onChange={(e) => { const v = Number(e.target.value); if (v >= 4 && v <= 400) set({ size: v }); }} />
        </label>
      </div>
      <div className="row">
        {bool('bold', 'Bold', 'B', { fontWeight: 800 })}
        {bool('italic', 'Italic', 'I', { fontStyle: 'italic' })}
        {bool('underline', 'Underline', 'U', { textDecoration: 'underline' })}
        {bool('strike', 'Strikethrough', 'S', { textDecoration: 'line-through' })}
        <button type="button" className="btn small" onClick={() => onChange({ ...obj, paragraphs: clearFormatting(obj.paragraphs, null, { ...DEFAULT_MARKS, font: first.font, size: first.size }) })}>Clear formatting</button>
      </div>
      <span className="field-label">Text colour</span>
      <ColorRow label="Text colour" colors={TEXT_COLORS} value={marks.color} onChange={(c) => c && set({ color: c })} />
      <span className="field-label">Highlight</span>
      <ColorRow label="Highlight" colors={HIGHLIGHT_COLORS} value={marks.highlight === undefined ? undefined : marks.highlight} onChange={(c) => set({ highlight: c })} allowNone />
      <div className="row">
        <div className="segmented" role="group" aria-label="Alignment">
          {ALIGNS.map((x) => (
            <button key={x.a} type="button" aria-pressed={align === x.a} aria-label={x.label} title={x.label} onClick={() => onChange({ ...obj, paragraphs: setParagraphProps(obj.paragraphs, { align: x.a }) })}>{x.icon}</button>
          ))}
        </div>
        <label className="field">
          <span className="sr-only">Line spacing</span>
          <select className="input" aria-label="Line spacing" value={lh ?? ''} onChange={(e) => onChange({ ...obj, paragraphs: setParagraphProps(obj.paragraphs, { lineHeight: Number(e.target.value) }) })}>
            {lh === undefined && <option value="">mixed</option>}
            {[...new Set([...LINE_HEIGHTS, ...(lh ? [lh] : [])])].sort((a, b) => a - b).map((v) => <option key={v} value={v}>{v}× spacing</option>)}
          </select>
        </label>
      </div>
      <label className="field">
        <span>Custom line spacing: {lh ?? 'mixed'}</span>
        <input type="range" min={0.8} max={3} step={0.05} value={lh ?? 1.15} onChange={(e) => onChange({ ...obj, paragraphs: setParagraphProps(obj.paragraphs, { lineHeight: Number(e.target.value) }) })} />
      </label>
      <span className="field-label">Box background</span>
      <ColorRow label="Background" colors={BACKGROUNDS} value={obj.background} onChange={(c) => onChange({ ...obj, background: c })} allowNone />
      <div className="grid-2">
        <label className="field">
          <span>Padding: {Math.round(obj.padding)}pt</span>
          <input type="range" min={0} max={24} value={obj.padding} onChange={(e) => onChange({ ...obj, padding: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span>Opacity: {Math.round(obj.opacity * 100)}%</span>
          <input type="range" min={0.1} max={1} step={0.05} value={obj.opacity} onChange={(e) => onChange({ ...obj, opacity: Number(e.target.value) })} />
        </label>
      </div>
      <label className="field" style={{ width: 120 }}>
        <span>Width (pt)</span>
        <input className="input" type="number" min={16} max={2000} value={Math.round(obj.w)} onChange={(e) => { const v = Number(e.target.value); if (v >= 16) onChange({ ...obj, w: v }); }} />
      </label>
      <Notice kind={info.strategy.kind === 'raster' ? 'warn' : 'info'}><span className="small">{info.note}</span></Notice>
      {[...missing].map((m) => <p key={m} className="tiny muted">{m} — shown and saved upright/regular.</p>)}
    </>
  );
}

/** Defaults for new text boxes (Text tool selected). */
export function TextToolPanel({ style, setStyle }: { style: ToolStyle; setStyle: (s: ToolStyle) => void }) {
  const m = style.textMarks;
  const setM = (patch: Partial<RunMarks>) => setStyle({ ...style, textMarks: { ...m, ...patch } });
  return (
    <>
      <p className="small muted">Click on a page to add a text box. Select words while editing to style them.</p>
      <div className="row">
        <FontPicker value={m.font} onChange={(font) => setM({ font })} />
        <input className="input" style={{ width: 80 }} type="number" min={4} max={400} aria-label="Font size (pt)" value={m.size} onChange={(e) => { const v = Number(e.target.value); if (v >= 4 && v <= 400) setM({ size: v }); }} />
      </div>
      <div className="row">
        <button type="button" className="btn small icon" aria-pressed={m.bold} aria-label="Bold" onClick={() => setM({ bold: !m.bold })} style={{ fontWeight: 800 }}>B</button>
        <button type="button" className="btn small icon" aria-pressed={m.italic} aria-label="Italic" onClick={() => setM({ italic: !m.italic })} style={{ fontStyle: 'italic' }}>I</button>
        <button type="button" className="btn small icon" aria-pressed={m.underline} aria-label="Underline" onClick={() => setM({ underline: !m.underline })} style={{ textDecoration: 'underline' }}>U</button>
        <div className="segmented" role="group" aria-label="Alignment">
          {ALIGNS.map((x) => (
            <button key={x.a} type="button" aria-pressed={style.align === x.a} aria-label={x.label} onClick={() => setStyle({ ...style, align: style.align === x.a ? 'start' : x.a })}>{x.icon}</button>
          ))}
        </div>
      </div>
      <ColorRow label="Text colour" colors={TEXT_COLORS} value={m.color} onChange={(c) => c && setM({ color: c })} />
      <p className="tiny muted">
        Helvetica, Times and Courier are the built-in PDF fonts (Latin only). Other languages: Cyrillic, Greek and Vietnamese use the bundled Noto fonts; Hindi, Arabic, Chinese,
        emoji and other scripts are saved as an image of the text box.
      </p>
    </>
  );
}

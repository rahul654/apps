import { baseKeymap } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { EditorState, Selection, type Command } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import 'prosemirror-view/style/prosemirror.css';
import { useEffect, useRef, useState, type CSSProperties, type FocusEvent, type MouseEvent } from 'react';
import { cssFontFamily, type FontId } from '../../../../lib/fonts/registry';
import type { TextObj } from '../../../../lib/pdf/editorModel';
import { LINE_HEIGHTS, type Align, type Paragraph, type RunMarks } from '../../../../lib/text/model';
import { pastedFromPlainText, sanitizePastedHtml } from '../../../../lib/text/paste';
import { FontPicker } from './FontPicker';
import {
  activeMarks,
  activeParagraph,
  clearFormat,
  hardBreak,
  setAlign,
  setColor,
  setFont,
  setHighlight,
  setLineHeight,
  setSize,
  splitParagraph,
  toggle,
  type BoolMarkName,
} from './commands';
import { docFromParagraphs, fromPmMarks, paragraphsFromDoc, sliceFromPasted } from './schema';

export const TEXT_COLORS = ['#111111', '#e11d48', '#2563eb', '#16a34a', '#f59e0b', '#7c3aed', '#ffffff'];
export const HIGHLIGHT_COLORS = ['#ffe14d', '#7cf29c', '#7cd3ff', '#ff9ee5'];
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72];

interface Props {
  obj: TextObj;
  zoom: number;
  onChange: (paragraphs: Paragraph[]) => void;
  onExit: () => void;
}

/**
 * In-place rich text editing with ProseMirror (handles IME composition, selection,
 * undo within the session). The model is pushed to the parent on every change; the
 * app-level undo step is recorded when editing ends.
 */
export function RichTextEditor({ obj, zoom, onChange, onExit }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const defaultsRef = useRef<RunMarks>(obj.paragraphs[0]?.runs[0]?.marks);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const plainNext = useRef(false);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const [, setTick] = useState(0);

  useEffect(() => {
    const defaults = defaultsRef.current;
    const state = EditorState.create({
      doc: docFromParagraphs(obj.paragraphs),
      plugins: [
        history(),
        keymap({
          'Mod-z': undo,
          'Mod-y': redo,
          'Shift-Mod-z': redo,
          'Mod-b': toggle('bold'),
          'Mod-i': toggle('italic'),
          'Mod-u': toggle('underline'),
          'Shift-Mod-x': toggle('strike'),
          Enter: splitParagraph,
          'Shift-Enter': hardBreak,
          Escape: () => {
            viewRef.current?.dom.blur();
            onExitRef.current();
            return true;
          },
        }),
        keymap(baseKeymap),
      ],
    });
    const view = new EditorView(mountRef.current!, {
      state: EditorState.create({ doc: state.doc, plugins: state.plugins, selection: Selection.atEnd(state.doc) }),
      attributes: { class: 'pm-root', 'aria-label': 'Text box content', 'aria-multiline': 'true', role: 'textbox', spellcheck: 'true' },
      dispatchTransaction(tr) {
        const next = view.state.apply(tr);
        view.updateState(next);
        if (tr.docChanged || tr.storedMarksSet) onChangeRef.current(paragraphsFromDoc(next.doc, defaults, next.storedMarks));
        setTick((t) => t + 1);
      },
      handleKeyDown(_v, e) {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') plainNext.current = true;
        return false;
      },
      handlePaste(v, event) {
        const html = event.clipboardData?.getData('text/html') ?? '';
        const text = event.clipboardData?.getData('text/plain') ?? '';
        const plain = plainNext.current || !html;
        plainNext.current = false;
        if (!plain && html.includes('data-pm-slice')) return false; // copied from another text box: keep exact formatting
        const base = fromPmMarks(v.state.storedMarks ?? v.state.selection.$from.marks(), defaults);
        const pasted = plain
          ? pastedFromPlainText(text).map((p) => p.map((r) => ({ ...r, bold: base.bold, italic: base.italic, underline: base.underline, strike: base.strike })))
          : sanitizePastedHtml(html, (h) => new DOMParser().parseFromString(h, 'text/html'));
        v.dispatch(v.state.tr.replaceSelection(sliceFromPasted(pasted, base)).scrollIntoView());
        return true;
      },
    });
    viewRef.current = view;
    (mountRef.current as unknown as { pmView?: EditorView }).pmView = view; // test hook
    view.focus();
    setTick((t) => t + 1);
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The editor is created once per editing session; later prop changes come from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onBlur = (e: FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (next && wrapRef.current?.contains(next)) return;
    onExit();
  };

  const view = viewRef.current;
  const exec = (cmd: Command) => {
    if (!view) return;
    cmd(view.state, view.dispatch);
    view.focus();
  };
  const defaults = defaultsRef.current;
  const marks = view ? activeMarks(view.state, defaults) : defaults;
  const para = view ? activeParagraph(view.state) : {};
  const keepFocus = (e: MouseEvent) => e.preventDefault();

  const style: CSSProperties & Record<'--ft-zoom', number> = {
    left: obj.x * zoom,
    top: obj.y * zoom,
    width: obj.w * zoom,
    '--ft-zoom': zoom,
  };
  const boxStyle: CSSProperties = {
    padding: obj.padding * zoom,
    background: obj.background ?? 'transparent',
    fontFamily: cssFontFamily(defaults.font),
    fontSize: defaults.size * zoom,
    color: defaults.color,
    opacity: obj.opacity,
  };
  const below = obj.y * zoom < 96;
  const boolBtn = (name: BoolMarkName, labelText: string, content: string, extra: CSSProperties, shortcut: string) => (
    <button type="button" className="btn small icon" aria-pressed={marks[name] === true} aria-label={labelText} title={`${labelText} (${shortcut})`} onMouseDown={keepFocus} onClick={() => exec(toggle(name))} style={extra}>
      {content}
    </button>
  );
  const aligns: { a: Align; icon: string; label: string }[] = [
    { a: 'left', icon: '⇤', label: 'Align left' },
    { a: 'center', icon: '↔', label: 'Center' },
    { a: 'right', icon: '⇥', label: 'Align right' },
    { a: 'justify', icon: '☰', label: 'Justify' },
  ];

  return (
    <div ref={wrapRef} className="rte-wrap" style={style} onPointerDown={(e) => e.stopPropagation()} onBlur={onBlur}>
      <div className={`rte-toolbar${below ? ' below' : ''}`} role="toolbar" aria-label="Text formatting">
        <FontPicker compact value={marks.font} onChange={(id: FontId) => exec(setFont(id))} />
        <input
          className="input rte-size"
          type="number"
          min={4}
          max={400}
          list="rte-sizes"
          aria-label="Font size (pt)"
          value={marks.size ?? ''}
          placeholder="—"
          onChange={(e) => {
            const v = Number(e.target.value);
            if (v >= 4 && v <= 400 && viewRef.current) setSize(v)(viewRef.current.state, viewRef.current.dispatch);
          }}
        />
        <datalist id="rte-sizes">{SIZES.map((s) => <option key={s} value={s} />)}</datalist>
        {boolBtn('bold', 'Bold', 'B', { fontWeight: 800 }, 'Ctrl/⌘+B')}
        {boolBtn('italic', 'Italic', 'I', { fontStyle: 'italic' }, 'Ctrl/⌘+I')}
        {boolBtn('underline', 'Underline', 'U', { textDecoration: 'underline' }, 'Ctrl/⌘+U')}
        {boolBtn('strike', 'Strikethrough', 'S', { textDecoration: 'line-through' }, 'Ctrl/⌘+Shift+X')}
        <label className="rte-color" title="Text colour">
          <span aria-hidden="true" style={{ borderBottom: `3px solid ${marks.color ?? '#888'}` }}>A</span>
          <input type="color" aria-label="Text colour" value={marks.color ?? '#111111'} onChange={(e) => exec(setColor(e.target.value))} />
        </label>
        <span className="rte-group" role="group" aria-label="Highlight">
          {HIGHLIGHT_COLORS.map((c) => (
            <button key={c} type="button" className="swatch small" style={{ background: c }} aria-pressed={marks.highlight === c} aria-label={`Highlight ${c}`} onMouseDown={keepFocus} onClick={() => exec(setHighlight(marks.highlight === c ? null : c))} />
          ))}
          <button type="button" className="btn small icon" aria-label="No highlight" title="No highlight" onMouseDown={keepFocus} onClick={() => exec(setHighlight(null))}>⌀</button>
        </span>
        <span className="rte-group" role="group" aria-label="Alignment">
          {aligns.map((x) => (
            <button key={x.a} type="button" className="btn small icon" aria-pressed={para.align === x.a} aria-label={x.label} title={x.label} onMouseDown={keepFocus} onClick={() => exec(setAlign(x.a))}>
              {x.icon}
            </button>
          ))}
        </span>
        <select className="input rte-lh" aria-label="Line spacing" value={para.lineHeight ?? ''} onChange={(e) => exec(setLineHeight(Number(e.target.value)))}>
          {para.lineHeight === undefined && <option value="">—</option>}
          {[...new Set([...LINE_HEIGHTS, ...(para.lineHeight ? [para.lineHeight] : [])])].sort((a, b) => a - b).map((lh) => (
            <option key={lh} value={lh}>{lh}×</option>
          ))}
        </select>
        <button type="button" className="btn small" title="Clear formatting" onMouseDown={keepFocus} onClick={() => exec(clearFormat(defaults))}>Clear</button>
        <button type="button" className="btn small primary" onMouseDown={keepFocus} onClick={() => onExit()}>Done</button>
      </div>
      <div ref={mountRef} className="rte-box" style={boxStyle} />
    </div>
  );
}

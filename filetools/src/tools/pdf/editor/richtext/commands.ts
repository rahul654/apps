/** ProseMirror commands used by the formatting toolbar and keymap. */
import { splitBlockAs, toggleMark } from 'prosemirror-commands';
import type { Mark, MarkType } from 'prosemirror-model';
import type { Command, EditorState } from 'prosemirror-state';
import type { FontId } from '../../../../lib/fonts/registry';
import type { Align, RunMarks } from '../../../../lib/text/model';
import { fromPmMarks, schema, toPmMarks } from './schema';

export type BoolMarkName = 'bold' | 'italic' | 'underline' | 'strike';

export const toggle = (name: BoolMarkName): Command => toggleMark(schema.marks[name]);

/** Replace a valued mark (font/size/color/highlight) over the selection, or for the next typed text. */
export function setValueMark(type: MarkType, attrs: Record<string, unknown> | null): Command {
  return (state, dispatch) => {
    const { from, to, empty } = state.selection;
    if (!dispatch) return true;
    const tr = state.tr;
    if (empty) {
      const marks = (state.storedMarks ?? state.selection.$from.marks()).filter((m) => m.type !== type);
      tr.setStoredMarks(attrs ? [...marks, type.create(attrs)] : marks);
    } else {
      tr.removeMark(from, to, type);
      if (attrs) tr.addMark(from, to, type.create(attrs));
    }
    dispatch(tr.scrollIntoView());
    return true;
  };
}

export const setFont = (id: FontId) => setValueMark(schema.marks.font, { id });
export const setSize = (pt: number) => setValueMark(schema.marks.size, { pt });
export const setColor = (value: string) => setValueMark(schema.marks.color, { value });
export const setHighlight = (value: string | null) => setValueMark(schema.marks.highlight, value ? { value } : null);

function setParagraphAttr(attr: 'align' | 'lineHeight', value: Align | number): Command {
  return (state, dispatch) => {
    if (!dispatch) return true;
    const tr = state.tr;
    const { from, to } = state.selection;
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type === schema.nodes.paragraph) tr.setNodeMarkup(pos, null, { ...node.attrs, [attr]: value });
      return false;
    });
    dispatch(tr);
    return true;
  };
}

export const setAlign = (a: Align) => setParagraphAttr('align', a);
export const setLineHeight = (lh: number) => setParagraphAttr('lineHeight', lh);

/** Remove all formatting in the selection, back to the box defaults. */
export function clearFormat(defaults: RunMarks): Command {
  return (state, dispatch) => {
    if (!dispatch) return true;
    const { from, to, empty } = state.selection;
    const base = toPmMarks({ ...defaults, bold: false, italic: false, underline: false, strike: false, highlight: null });
    const tr = state.tr;
    if (empty) tr.setStoredMarks(base);
    else {
      for (const t of Object.values(schema.marks)) tr.removeMark(from, to, t);
      for (const m of base) tr.addMark(from, to, m);
    }
    dispatch(tr);
    return true;
  };
}

/** Enter: new paragraph with the same alignment/spacing and the same marks at the cursor. */
export const splitParagraph: Command = (state, dispatch) =>
  splitBlockAs((node) => ({ type: node.type, attrs: node.attrs }))(
    state,
    dispatch &&
      ((tr) => {
        const marks = state.storedMarks ?? (state.selection.$to.parentOffset ? state.selection.$from.marks() : null);
        if (marks) tr.ensureMarks(marks);
        dispatch(tr);
      }),
  );

/** Shift+Enter: line break inside the paragraph. */
export const hardBreak: Command = (state, dispatch) => {
  if (dispatch) {
    const marks = state.storedMarks ?? state.selection.$from.marks();
    dispatch(state.tr.replaceSelectionWith(schema.nodes.hard_break.create()).ensureMarks(marks).scrollIntoView());
  }
  return true;
};

/** Marks in effect at the selection (for toolbar state). Undefined fields = mixed. */
export function activeMarks(state: EditorState, defaults: RunMarks): Partial<RunMarks> {
  const { from, to, empty } = state.selection;
  if (empty) return fromPmMarks(state.storedMarks ?? state.selection.$from.marks(), defaults);
  let acc: Partial<RunMarks> | null = null;
  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return;
    const m = fromPmMarks(node.marks as Mark[], defaults);
    if (!acc) acc = { ...m };
    else for (const k of Object.keys(acc) as (keyof RunMarks)[]) if (acc[k] !== m[k]) delete acc[k];
  });
  return acc ?? fromPmMarks(state.selection.$from.marks(), defaults);
}

export function activeParagraph(state: EditorState): { align?: Align; lineHeight?: number } {
  const { from, to } = state.selection;
  const aligns = new Set<string>();
  const lhs = new Set<number>();
  state.doc.nodesBetween(from, to, (node) => {
    if (node.type === schema.nodes.paragraph) {
      aligns.add(node.attrs.align);
      lhs.add(node.attrs.lineHeight);
    }
    return false;
  });
  return { align: aligns.size === 1 ? ([...aligns][0] as Align) : undefined, lineHeight: lhs.size === 1 ? [...lhs][0] : undefined };
}

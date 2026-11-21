/**
 * ProseMirror schema for text boxes: paragraphs (align, line height), hard breaks,
 * and only the marks our model supports. Conversion to/from the model lives here too.
 */
import { Fragment, Schema, Slice, type Mark, type MarkSpec, type Node as PMNode } from 'prosemirror-model';
import { cssFontFamily, isFontId, type FontId } from '../../../../lib/fonts/registry';
import { DEFAULT_LINE_HEIGHT, normalizeParagraphs, type Align, type Paragraph, type Run, type RunMarks } from '../../../../lib/text/model';
import type { PastedParagraph } from '../../../../lib/text/paste';

const span = (attrs: Record<string, string>) => ['span', attrs, 0] as const;

const boolMark = (name: string, style: string, parseTags: string[]): MarkSpec => ({
  toDOM: () => span({ style, [`data-${name}`]: '1' }),
  parseDOM: [{ tag: `span[data-${name}]` }, ...parseTags.map((tag) => ({ tag }))],
});

export const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: {
      content: 'inline*',
      group: 'block',
      attrs: { align: { default: 'start' }, lineHeight: { default: DEFAULT_LINE_HEIGHT } },
      toDOM: (n) => ['p', { dir: 'auto', 'data-align': n.attrs.align, 'data-lh': String(n.attrs.lineHeight), style: `text-align:${n.attrs.align};line-height:${n.attrs.lineHeight};margin:0` }, 0],
      parseDOM: [
        {
          tag: 'p',
          getAttrs: (el) => ({
            align: (el as HTMLElement).dataset.align ?? 'start',
            lineHeight: Number((el as HTMLElement).dataset.lh) || DEFAULT_LINE_HEIGHT,
          }),
        },
      ],
    },
    text: { group: 'inline' },
    hard_break: { inline: true, group: 'inline', selectable: false, toDOM: () => ['br'], parseDOM: [{ tag: 'br' }] },
  },
  marks: {
    font: {
      attrs: { id: { default: 'Helvetica' } },
      toDOM: (m) => span({ 'data-font': m.attrs.id, style: `font-family:${cssFontFamily(m.attrs.id as FontId)}` }),
      parseDOM: [{ tag: 'span[data-font]', getAttrs: (el) => ({ id: (el as HTMLElement).dataset.font }) }],
    },
    size: {
      attrs: { pt: { default: 14 } },
      toDOM: (m) => span({ 'data-size': String(m.attrs.pt), style: `font-size:calc(var(--ft-zoom, 1) * ${m.attrs.pt}px)` }),
      parseDOM: [{ tag: 'span[data-size]', getAttrs: (el) => ({ pt: Number((el as HTMLElement).dataset.size) || 14 }) }],
    },
    color: {
      attrs: { value: { default: '#111111' } },
      toDOM: (m) => span({ 'data-color': m.attrs.value, style: `color:${m.attrs.value}` }),
      parseDOM: [{ tag: 'span[data-color]', getAttrs: (el) => ({ value: (el as HTMLElement).dataset.color }) }],
    },
    highlight: {
      attrs: { value: { default: '#ffe14d' } },
      toDOM: (m) => span({ 'data-highlight': m.attrs.value, style: `background-color:${m.attrs.value}` }),
      parseDOM: [{ tag: 'span[data-highlight]', getAttrs: (el) => ({ value: (el as HTMLElement).dataset.highlight }) }],
    },
    bold: boolMark('bold', 'font-weight:700', []),
    italic: boolMark('italic', 'font-style:italic', []),
    underline: boolMark('underline', 'text-decoration:underline', []),
    strike: boolMark('strike', 'text-decoration:line-through', []),
  },
});

export const BOOL_MARKS = ['bold', 'italic', 'underline', 'strike'] as const;

/** Model marks → ProseMirror marks (every text node carries font, size and colour). */
export function toPmMarks(m: RunMarks): Mark[] {
  const s = schema.marks;
  const out: Mark[] = [s.font.create({ id: m.font }), s.size.create({ pt: m.size }), s.color.create({ value: m.color })];
  if (m.highlight) out.push(s.highlight.create({ value: m.highlight }));
  if (m.bold) out.push(s.bold.create());
  if (m.italic) out.push(s.italic.create());
  if (m.underline) out.push(s.underline.create());
  if (m.strike) out.push(s.strike.create());
  return out;
}

/** ProseMirror marks → model marks, filling gaps from `defaults`. */
export function fromPmMarks(marks: readonly Mark[], defaults: RunMarks): RunMarks {
  const m: RunMarks = { ...defaults, bold: false, italic: false, underline: false, strike: false, highlight: null };
  for (const mk of marks) {
    switch (mk.type.name) {
      case 'font':
        if (isFontId(mk.attrs.id)) m.font = mk.attrs.id;
        break;
      case 'size':
        m.size = Number(mk.attrs.pt) || defaults.size;
        break;
      case 'color':
        m.color = String(mk.attrs.value);
        break;
      case 'highlight':
        m.highlight = String(mk.attrs.value);
        break;
      case 'bold':
      case 'italic':
      case 'underline':
      case 'strike':
        m[mk.type.name] = true;
        break;
    }
  }
  return m;
}

function inlineNodes(runs: Run[]): PMNode[] {
  const nodes: PMNode[] = [];
  for (const r of runs) {
    const marks = toPmMarks(r.marks);
    r.text.split('\n').forEach((part, i) => {
      if (i > 0) nodes.push(schema.nodes.hard_break.create());
      if (part) nodes.push(schema.text(part, marks));
    });
  }
  return nodes;
}

export function docFromParagraphs(paragraphs: Paragraph[]): PMNode {
  return schema.nodes.doc.create(
    null,
    paragraphs.map((p) => schema.nodes.paragraph.create({ align: p.align, lineHeight: p.lineHeight }, inlineNodes(p.runs))),
  );
}

export function paragraphsFromDoc(doc: PMNode, defaults: RunMarks, emptyMarks?: readonly Mark[] | null): Paragraph[] {
  const out: Paragraph[] = [];
  doc.forEach((pn) => {
    const runs: Run[] = [];
    let lastMarks: RunMarks | null = null;
    pn.forEach((child) => {
      if (child.type.name === 'hard_break') {
        const marks = lastMarks ?? defaults;
        runs.push({ text: '\n', marks });
      } else if (child.isText) {
        lastMarks = fromPmMarks(child.marks, defaults);
        runs.push({ text: child.text ?? '', marks: lastMarks });
      }
    });
    if (runs.length === 0) runs.push({ text: '', marks: emptyMarks ? fromPmMarks(emptyMarks, defaults) : defaults });
    out.push({ runs, align: (pn.attrs.align as Align) ?? 'start', lineHeight: Number(pn.attrs.lineHeight) || DEFAULT_LINE_HEIGHT });
  });
  return normalizeParagraphs(out);
}

/** Build a paste slice: sanitised paragraphs styled on top of the marks at the cursor. */
export function sliceFromPasted(pasted: PastedParagraph[], base: RunMarks): Slice {
  const paras = pasted.map((runs) =>
    schema.nodes.paragraph.create(
      null,
      inlineNodes(
        runs.map((r) => ({
          text: r.text,
          // Size and colour come from the cursor; bold/italic/underline/strike from the pasted content.
          marks: { ...base, highlight: null, bold: r.bold, italic: r.italic, underline: r.underline, strike: r.strike, font: r.font ?? base.font },
        })),
      ),
    ),
  );
  return new Slice(Fragment.from(paras), 1, 1);
}

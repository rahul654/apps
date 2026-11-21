/**
 * Clipboard HTML → our model, keeping only bold, italic, underline, strike-through,
 * paragraphs and line breaks. Fonts are mapped to ours when the match is obvious;
 * colours, sizes, links, images, tables etc. are dropped (their text is kept).
 */
import type { FontId } from '../fonts/registry';

export interface PastedRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  font?: FontId;
}

export type PastedParagraph = PastedRun[];

const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE', 'TR', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'ASIDE', 'NAV', 'UL', 'OL', 'TABLE', 'DL', 'DT', 'DD', 'FIGURE', 'FIGCAPTION', 'ADDRESS']);
const SKIP = new Set(['SCRIPT', 'STYLE', 'HEAD', 'TITLE', 'META', 'LINK', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'MATH', 'IFRAME', 'OBJECT', 'BUTTON', 'SELECT', 'TEXTAREA', 'INPUT']);

/** Map a CSS font-family list to one of our families when there's an obvious match. */
export function mapFontFamily(css: string): FontId | undefined {
  const names = css.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '').toLowerCase());
  for (const n of names) {
    if (/^noto sans mono/.test(n)) return 'NotoSansMono';
    if (/^noto serif/.test(n)) return 'NotoSerif';
    if (/^noto sans/.test(n)) return 'NotoSans';
    if (/playfair/.test(n)) return 'PlayfairDisplay';
    if (/dancing script/.test(n)) return 'DancingScript';
    if (/^caveat/.test(n)) return 'Caveat';
    if (/^(helvetica|arial|liberation sans|helvetica neue)\b/.test(n)) return 'Helvetica';
    if (/^(times|times new roman|liberation serif)\b/.test(n)) return 'Times';
    if (/^(courier|courier new|liberation mono)\b/.test(n)) return 'Courier';
  }
  return undefined;
}

interface Style {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  font?: FontId;
  pre: boolean;
}

function styleFor(el: Element, parent: Style): Style {
  const s: Style = { ...parent };
  const tag = el.tagName;
  if (tag === 'B' || tag === 'STRONG' || /^H[1-6]$/.test(tag) || tag === 'TH') s.bold = true;
  if (tag === 'I' || tag === 'EM' || tag === 'CITE' || tag === 'DFN') s.italic = true;
  if (tag === 'U' || tag === 'INS') s.underline = true;
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') s.strike = true;
  if (tag === 'PRE' || tag === 'CODE') s.pre = tag === 'PRE' || s.pre;
  if (tag === 'FONT') {
    const face = el.getAttribute('face');
    if (face) s.font = mapFontFamily(face) ?? s.font;
  }
  const style = (el as HTMLElement).style;
  if (style) {
    const fw = style.fontWeight;
    if (fw) s.bold = fw === 'bold' || fw === 'bolder' || (/^\d+$/.test(fw) && Number(fw) >= 600);
    const fs = style.fontStyle;
    if (fs) s.italic = fs === 'italic' || fs === 'oblique';
    const td = `${style.textDecoration} ${style.textDecorationLine}`;
    if (/underline/.test(td)) s.underline = true;
    if (/line-through/.test(td)) s.strike = true;
    if (/\bnone\b/.test(style.textDecorationLine || '')) {
      s.underline = false;
      s.strike = false;
    }
    if (style.fontFamily) s.font = mapFontFamily(style.fontFamily) ?? s.font;
  }
  return s;
}

/**
 * Sanitise clipboard HTML. `parse` turns the HTML into a Document (DOMParser in the
 * browser; injectable for tests). Returns at least one paragraph.
 */
export function sanitizePastedHtml(html: string, parse: (html: string) => Document): PastedParagraph[] {
  const doc = parse(html);
  const paras: PastedParagraph[] = [[]];
  const cur = () => paras[paras.length - 1];
  const newPara = () => {
    if (cur().length) paras.push([]);
  };
  const pushText = (text: string, s: Style) => {
    if (!text) return;
    const p = cur();
    const last = p[p.length - 1];
    if (last && last.bold === s.bold && last.italic === s.italic && last.underline === s.underline && last.strike === s.strike && last.font === s.font) last.text += text;
    else p.push({ text, bold: s.bold, italic: s.italic, underline: s.underline, strike: s.strike, font: s.font });
  };
  const walk = (node: Node, s: Style) => {
    if (node.nodeType === 3) {
      let t = node.nodeValue ?? '';
      if (!s.pre) t = t.replace(/[\s ]+/g, (m) => (m.includes(' ') ? ' ' : ' '));
      if (s.pre && t.includes('\n')) {
        t.split('\n').forEach((line, i) => {
          if (i > 0) pushText('\n', s);
          pushText(line, s);
        });
      } else pushText(t, s);
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    if (SKIP.has(el.tagName)) return;
    if (el.tagName === 'BR') {
      pushText('\n', s);
      return;
    }
    if (el.tagName === 'IMG') return;
    const block = BLOCK.has(el.tagName);
    if (block) newPara();
    const st = styleFor(el, s);
    el.childNodes.forEach((c) => walk(c, st));
    if (block) newPara();
    if (el.tagName === 'TD' || el.tagName === 'TH') pushText(' ', s);
  };
  walk(doc.body ?? doc.documentElement, { bold: false, italic: false, underline: false, strike: false, pre: false });
  // Trim spaces at paragraph edges and drop empty trailing paragraphs.
  const cleaned = paras
    .map((p) => {
      const runs = p.map((r) => ({ ...r }));
      if (runs.length) runs[0].text = runs[0].text.replace(/^ +/, '');
      if (runs.length) runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/[ ]+$/, '').replace(/\n$/, '');
      return runs.filter((r) => r.text);
    });
  while (cleaned.length > 1 && cleaned[cleaned.length - 1].length === 0) cleaned.pop();
  while (cleaned.length > 1 && cleaned[0].length === 0) cleaned.shift();
  return cleaned.length ? cleaned : [[]];
}

export function pastedFromPlainText(text: string): PastedParagraph[] {
  return text.replace(/\r\n?/g, '\n').split('\n').map((line) => (line ? [{ text: line, bold: false, italic: false, underline: false, strike: false }] : []));
}

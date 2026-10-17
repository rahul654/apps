/**
 * CodeMirror 6 setup for request bodies, examples and the response viewer. Loaded on demand by
 * CodeEditor.tsx (its own chunk), so pages that never show an editor don't download it.
 *
 * - Colours come from the app's CSS variables, so one theme serves light and dark.
 * - Tab indents (indentWithTab); Escape then Tab moves focus out (CodeMirror's tab-focus mode).
 * - Mod-Enter is removed from the default keymap: it bubbles to the request editor, which sends.
 * - Folding uses bracketPairs(), which skips strings and `{{placeholders}}` (the JSON grammar
 *   folds badly around `"id": {{destinationId}}`). XML folds by its syntax tree.
 * - `{{variables}}` are marked resolved/unresolved and report hover / keyboard caret positions to
 *   the variable popover through VarHooks.
 */
import { Compartment, EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, MatchDecorator, ViewPlugin, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder as placeholderExt, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, StreamLanguage, bracketMatching, foldAll, foldGutter, foldKeymap, foldService, indentOnInput, syntaxHighlighting, unfoldAll } from '@codemirror/language';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import { tags as t } from '@lezer/highlight';
import { bracketPairs, newlineIndex, type BracketPair } from '../../lib/brackets';
import { validateJsonText } from '../../lib/jsonText';
import type { VarStatus } from '../../lib/varScope';

export type CodeLanguage = 'json' | 'xml' | 'html' | 'javascript' | 'graphql' | 'text';

export interface VarHooks {
  status: (name: string) => VarStatus;
  hover: (name: string, rect: DOMRect, origin: HTMLElement) => void;
  leave: () => void;
  /** Keyboard caret moved into (name) or out of (null) a variable. */
  caret: (name: string | null, rect: DOMRect | null, origin: HTMLElement) => void;
  /** Alt+ArrowDown: move focus into the open popover. Returns false when none is open. */
  focusPopover: () => boolean;
}

export interface CmOptions {
  doc: string;
  language: CodeLanguage;
  readOnly: boolean;
  wrap: boolean;
  /** Syntax highlighting, folding and bracket matching. Off for very large documents. */
  rich: boolean;
  /** Inline JSON errors (placeholders allowed). */
  lintJson: boolean;
  vars: VarHooks | null;
  ariaLabel: string;
  placeholder?: string;
  onChange?: (doc: string) => void;
}

export interface CmHandle {
  view: EditorView;
  setDoc: (doc: string) => void;
  update: (o: Partial<Omit<CmOptions, 'doc' | 'onChange'>> & { onChange?: (doc: string) => void }) => void;
  openSearch: () => void;
  foldAll: () => void;
  unfoldAll: () => void;
  focus: () => void;
  destroy: () => void;
}

const highlight = HighlightStyle.define([
  { tag: [t.propertyName, t.attributeName], color: 'var(--syn-key)' },
  { tag: [t.string, t.special(t.string), t.attributeValue], color: 'var(--syn-string)' },
  { tag: [t.number, t.integer, t.float], color: 'var(--syn-number)' },
  { tag: [t.bool, t.null, t.atom], color: 'var(--syn-bool)' },
  { tag: [t.keyword, t.operatorKeyword, t.definitionKeyword], color: 'var(--syn-keyword)', fontWeight: '600' },
  { tag: [t.tagName, t.typeName, t.className], color: 'var(--syn-tag)' },
  { tag: [t.variableName, t.special(t.variableName)], color: 'var(--syn-var)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--muted)', fontStyle: 'italic' },
  { tag: [t.punctuation, t.separator, t.brace, t.squareBracket, t.angleBracket], color: 'var(--syn-punct)' },
  { tag: t.invalid, color: 'var(--error)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', maxHeight: 'inherit', backgroundColor: 'var(--code-bg)', color: 'var(--text)', fontSize: '0.84rem', border: '1px solid var(--border-strong)', borderRadius: '8px' },
  '&.cm-focused': { outline: 'none', borderColor: 'var(--accent)', boxShadow: 'var(--focus)' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', lineHeight: '1.5' },
  '.cm-content': { caretColor: 'var(--text)', padding: '6px 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'var(--selection)' },
  '.cm-gutters': { backgroundColor: 'var(--code-bg)', color: 'var(--muted)', borderRight: '1px solid var(--border)', borderTopLeftRadius: '8px', borderBottomLeftRadius: '8px' },
  '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--active-line)', color: 'var(--text)' },
  '.cm-foldGutter .cm-gutterElement': { padding: '0 4px', cursor: 'pointer' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--accent-soft)', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: '4px', padding: '0 4px', margin: '0 2px' },
  '.cm-matchingBracket': { backgroundColor: 'var(--accent-soft)', outline: '1px solid var(--accent)' },
  '.cm-nonmatchingBracket': { backgroundColor: 'var(--error-soft)' },
  '.cm-searchMatch': { backgroundColor: 'var(--accent-soft)', outline: '1px solid var(--accent)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--accent)', color: 'var(--on-accent)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--selection)' },
  '.cm-panels': { backgroundColor: 'var(--card)', color: 'var(--text)', borderColor: 'var(--border)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)', borderTopLeftRadius: '8px', borderTopRightRadius: '8px' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-panel.cm-search': { padding: '6px 8px', fontFamily: 'inherit' },
  '.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label': { fontSize: '0.82rem' },
  '.cm-textfield': { backgroundColor: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border-strong)', borderRadius: '6px', padding: '2px 6px' },
  '.cm-button': { backgroundImage: 'none', backgroundColor: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border-strong)', borderRadius: '6px', padding: '2px 8px' },
  '.cm-panel.cm-search [name=close]': { color: 'var(--muted)' },
  '.cm-tooltip': { backgroundColor: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '8px' },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--error)' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--error)', textUnderlineOffset: '3px' },
  '.cm-placeholder': { color: 'var(--muted)' },
  '.cm-var': { borderRadius: '3px' },
  '.cm-var-ok': { color: 'var(--var-ok)', backgroundColor: 'var(--var-ok-bg)' },
  '.cm-var-missing': { color: 'var(--var-missing)', backgroundColor: 'var(--var-missing-bg)' },
  '.cm-var-dynamic': { color: 'var(--var-dynamic)', backgroundColor: 'var(--var-ok-bg)' },
});

/** A small GraphQL highlighter (no grammar package needed for queries). */
const graphql = StreamLanguage.define<{ inBlock: boolean }>({
  name: 'graphql',
  startState: () => ({ inBlock: false }),
  token(stream, state) {
    if (state.inBlock) {
      if (stream.match(/^.*?"""/)) state.inBlock = false;
      else stream.skipToEnd();
      return 'string';
    }
    if (stream.eatSpace()) return null;
    if (stream.match('#')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match('"""')) {
      state.inBlock = true;
      return 'string';
    }
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string';
    if (stream.match(/^\$[A-Za-z_]\w*/)) return 'variableName';
    if (stream.match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/)) return 'number';
    if (stream.match(/^(?:query|mutation|subscription|fragment|on|schema|type|input|enum|interface|union|scalar|extend|directive|implements)\b/)) return 'keyword';
    if (stream.match(/^(?:true|false|null)\b/)) return 'bool';
    if (stream.match(/^@[A-Za-z_]\w*/)) return 'keyword';
    if (stream.match(/^[A-Z]\w*/)) return 'typeName';
    if (stream.match(/^[A-Za-z_]\w*/)) return 'propertyName';
    if (stream.match(/^[{}()[\]]/)) return 'brace';
    stream.next();
    return 'punctuation';
  },
  languageData: { commentTokens: { line: '#' } },
});

function languageExt(lang: CodeLanguage): Extension {
  switch (lang) {
    case 'json':
      return json();
    case 'xml':
    case 'html':
      return xml();
    case 'graphql':
      return graphql;
    default:
      return [];
  }
}

/** Above this size the pair scan (folding, bracket matching) is skipped so typing stays fast. */
const PAIR_LIMIT = 1_000_000;

interface Pairs {
  /** Multi-line pairs, sorted by opening offset (for folding). */
  folds: BracketPair[];
  /** Every bracket's partner (for bracket matching). */
  partner: Map<number, number>;
}

function computePairs(text: string): Pairs {
  if (text.length > PAIR_LIMIT) return { folds: [], partner: new Map() };
  const all = bracketPairs(text, { singleLine: true });
  const spansLines = newlineIndex(text);
  const partner = new Map<number, number>();
  const folds: BracketPair[] = [];
  for (const p of all) {
    partner.set(p.open, p.close);
    partner.set(p.close, p.open);
    if (spansLines(p.open, p.close)) folds.push(p);
  }
  return { folds, partner };
}

/** Bracket pairs that skip strings and `{{placeholders}}`, recomputed when the document changes. */
const pairsField = StateField.define<Pairs>({
  create: (s) => computePairs(s.doc.toString()),
  update: (v, tr) => (tr.docChanged ? computePairs(tr.state.doc.toString()) : v),
});

const matchMark = Decoration.mark({ class: 'cm-matchingBracket' });
/** Highlights the bracket next to the cursor and its partner (the JSON grammar would pair `{` with a placeholder's `}`). */
const pairMatching = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view.state);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet) this.decorations = this.build(u.state);
    }
    build(state: EditorState): DecorationSet {
      const { partner } = state.field(pairsField);
      const head = state.selection.main.head;
      for (const pos of [head, head - 1]) {
        const other = partner.get(pos);
        if (other === undefined) continue;
        const [a, b] = pos < other ? [pos, other] : [other, pos];
        return Decoration.set([matchMark.range(a, a + 1), matchMark.range(b, b + 1)]);
      }
      return Decoration.none;
    }
  },
  { decorations: (v) => v.decorations },
);

const pairFolding: Extension = [
  pairsField,
  pairMatching,
  foldService.of((state, lineStart, lineEnd) => {
    const pairs = state.field(pairsField, false)?.folds;
    if (!pairs) return null;
    // First pair opening on this line (binary search on the sorted opens).
    let lo = 0;
    let hi = pairs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[mid].open < lineStart) lo = mid + 1;
      else hi = mid;
    }
    const p = pairs[lo];
    if (!p || p.open > lineEnd) return null;
    return { from: p.open + 1, to: p.close };
  }),
];

const varsChanged = StateEffect.define<null>();

function variablePlugin(hooks: { current: VarHooks | null }): Extension {
  const decorator = new MatchDecorator({
    regexp: /\{\{([^{}\n]+)\}\}/g,
    decoration: (m) => {
      const name = m[1].trim();
      const st = hooks.current?.status(name) ?? 'ok';
      return Decoration.mark({ class: `cm-var cm-var-${st}`, attributes: { 'data-var': name } });
    },
  });
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = decorator.createDeco(view);
      }
      update(u: ViewUpdate) {
        if (u.transactions.some((tr) => tr.effects.some((e) => e.is(varsChanged)))) this.decorations = decorator.createDeco(u.view);
        else this.decorations = decorator.updateDeco(u, this.decorations);
      }
    },
    { decorations: (v) => v.decorations },
  );
  // Keyboard caret inside a variable shows the popover (mouse users get it on hover).
  const caret = EditorView.updateListener.of((u) => {
    const h = hooks.current;
    if (!h || !u.selectionSet || u.docChanged) return;
    if (!u.transactions.some((tr) => tr.isUserEvent('select') && !tr.isUserEvent('select.pointer'))) return;
    const head = u.state.selection.main.head;
    const line = u.state.doc.lineAt(head);
    let hit: { name: string; from: number; to: number } | null = null;
    for (const m of line.text.matchAll(/\{\{([^{}\n]+)\}\}/g)) {
      const from = line.from + m.index!;
      const to = from + m[0].length;
      if (head > from && head < to) hit = { name: m[1].trim(), from, to };
    }
    const view = u.view;
    if (!hit) {
      h.caret(null, null, view.dom);
      return;
    }
    const found = hit;
    view.requestMeasure({
      read: () => {
        const a = view.coordsAtPos(found.from);
        const b = view.coordsAtPos(found.to);
        return a && b ? new DOMRect(a.left, a.top, Math.max(1, b.right - a.left), a.bottom - a.top) : null;
      },
      write: (rect) => hooks.current?.caret(found.name, rect, view.dom),
    });
  });
  const events = EditorView.domEventHandlers({
    mousemove(e, view) {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-var]') as HTMLElement | null;
      if (el && view.dom.contains(el)) hooks.current?.hover(el.dataset.var ?? '', el.getBoundingClientRect(), view.dom);
      else hooks.current?.leave();
    },
    mouseleave() {
      hooks.current?.leave();
    },
    keydown(e) {
      if (e.key === 'Escape') hooks.current?.leave();
      return false;
    },
  });
  const keys = keymap.of([{ key: 'Alt-ArrowDown', run: () => hooks.current?.focusPopover() ?? false }]);
  return [plugin, caret, events, keys];
}

export function createEditor(parent: HTMLElement, opts: CmOptions): CmHandle {
  const rich = new Compartment();
  const editable = new Compartment();
  const wrap = new Compartment();
  const lint = new Compartment();
  const ph = new Compartment();
  const label = new Compartment();
  const hooks = { current: opts.vars };
  let onChange = opts.onChange;
  let current = { ...opts };
  // Set while applying a document from props, so it isn't echoed back as a user edit.
  let applying = false;

  const richExt = (on: boolean, lang: CodeLanguage): Extension =>
    on ? [languageExt(lang), syntaxHighlighting(highlight), lang === 'xml' || lang === 'html' ? bracketMatching() : pairFolding, foldGutter({ markerDOM: foldMarker }), keymap.of(foldKeymap)] : [];
  const editableExt = (ro: boolean): Extension => [EditorState.readOnly.of(ro), ro ? [] : [history(), indentOnInput(), keymap.of([indentWithTab, ...historyKeymap])]];
  const lintExt = (on: boolean): Extension =>
    on
      ? [
          linter((view): Diagnostic[] => {
            const e = validateJsonText(view.state.doc.toString());
            return e ? [{ from: Math.min(e.from, view.state.doc.length), to: Math.min(Math.max(e.to, e.from), view.state.doc.length), severity: 'error', message: `Line ${e.line}: ${e.message}` }] : [];
          }, { delay: 250 }),
          lintGutter(),
        ]
      : [];

  const state = EditorState.create({
    doc: opts.doc,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      drawSelection(),
      EditorState.tabSize.of(2),
      search({ top: true }),
      highlightSelectionMatches(),
      keymap.of([...searchKeymap, ...defaultKeymap.filter((b) => b.key !== 'Mod-Enter')]),
      theme,
      rich.of(richExt(opts.rich, opts.language)),
      editable.of(editableExt(opts.readOnly)),
      wrap.of(opts.wrap ? EditorView.lineWrapping : []),
      lint.of(lintExt(opts.lintJson && !opts.readOnly)),
      ph.of(opts.placeholder ? placeholderExt(opts.placeholder) : []),
      label.of(EditorView.contentAttributes.of({ 'aria-label': opts.ariaLabel })),
      variablePlugin(hooks),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !applying) onChange?.(u.state.doc.toString());
      }),
    ],
  });
  const view = new EditorView({ state, parent });

  return {
    view,
    setDoc(doc) {
      if (doc === view.state.doc.toString()) return;
      applying = true;
      try {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } });
      } finally {
        applying = false;
      }
    },
    update(o) {
      const effects: StateEffect<unknown>[] = [];
      if (o.onChange) onChange = o.onChange;
      const next = { ...current, ...o };
      if (next.rich !== current.rich || next.language !== current.language) effects.push(rich.reconfigure(richExt(next.rich, next.language)));
      if (next.readOnly !== current.readOnly) effects.push(editable.reconfigure(editableExt(next.readOnly)));
      if (next.wrap !== current.wrap) effects.push(wrap.reconfigure(next.wrap ? EditorView.lineWrapping : []));
      if (next.lintJson !== current.lintJson || next.readOnly !== current.readOnly) effects.push(lint.reconfigure(lintExt(next.lintJson && !next.readOnly)));
      if (next.placeholder !== current.placeholder) effects.push(ph.reconfigure(next.placeholder ? placeholderExt(next.placeholder) : []));
      if (next.ariaLabel !== current.ariaLabel) effects.push(label.reconfigure(EditorView.contentAttributes.of({ 'aria-label': next.ariaLabel })));
      if (o.vars !== undefined && o.vars !== hooks.current) {
        hooks.current = o.vars;
        effects.push(varsChanged.of(null));
      }
      current = next;
      if (effects.length) view.dispatch({ effects });
    },
    openSearch() {
      view.focus();
      openSearchPanel(view);
    },
    foldAll() {
      foldAll(view);
    },
    unfoldAll() {
      unfoldAll(view);
    },
    focus() {
      view.focus();
    },
    destroy() {
      view.destroy();
    },
  };
}

function foldMarker(open: boolean): HTMLElement {
  const s = document.createElement('span');
  s.className = 'cm-fold-marker';
  s.textContent = open ? '▾' : '▸';
  s.title = open ? 'Fold' : 'Unfold';
  return s;
}

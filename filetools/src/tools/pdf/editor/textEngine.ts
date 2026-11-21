/**
 * Screen-side text engine: layout + save strategy per text box, cached per object and
 * recomputed when fonts finish loading. Uses the same layout code and measurements as
 * the PDF writer (vector boxes) or the rasteriser (canvas boxes).
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { ensureFontsFor, fontLoadError, fontsVersion, getLoadedFont, subscribeFonts } from '../../../lib/fonts/loader';
import { isStandard } from '../../../lib/fonts/registry';
import type { EditorObject, TextObj } from '../../../lib/pdf/editorModel';
import { layoutText, type TextLayout } from '../../../lib/text/layout';
import { canvasMeasure, vectorMeasure, type Canvas2D } from '../../../lib/text/measure';
import type { Paragraph } from '../../../lib/text/model';
import { analyzeText } from '../../../lib/text/scripts';
import { applyStrategyFonts, chooseStrategy, describeStrategy, type BoxStrategy } from '../../../lib/text/strategy';
import { isWinAnsiChar } from '../../../lib/winAnsi';

export interface TextInfo {
  layout: TextLayout;
  strategy: BoxStrategy;
  /** Paragraphs as drawn (standard fonts substituted where needed). */
  drawn: Paragraph[];
  note: string;
  /** All fonts needed for exact measuring are loaded. */
  exact: boolean;
}

let sharedCtx: Canvas2D | null = null;
function canvasCtx(): Canvas2D {
  if (!sharedCtx) {
    const ctx = document.createElement('canvas').getContext('2d') as Canvas2D | null;
    // Fallback for environments without canvas (tests): rough widths.
    sharedCtx =
      ctx ??
      ({
        font: '',
        measureText: (t: string) => ({ width: [...t].length * 55 }),
      } as unknown as Canvas2D);
  }
  return sharedCtx;
}

export function useTextEngine(objects: EditorObject[]) {
  const version = useSyncExternalStore(subscribeFonts, fontsVersion);
  const cache = useRef(new WeakMap<TextObj, TextInfo>());
  const cacheVersion = useRef(version);
  if (cacheVersion.current !== version) {
    cache.current = new WeakMap();
    cacheVersion.current = version;
  }

  // Load fonts the boxes need (own families, and Noto substitutes for non-Latin text in standard fonts).
  const needed = useMemo(() => {
    const out: { font: TextObj['paragraphs'][number]['runs'][number]['marks']['font']; bold: boolean; italic: boolean; unicode: boolean }[] = [];
    for (const o of objects) {
      if (o.type !== 'text') continue;
      const all = o.paragraphs.flatMap((p) => p.runs.map((r) => r.text)).join('');
      const rep = analyzeText(all);
      const complex = rep.complex.length > 0 || rep.emoji || rep.combining;
      for (const p of o.paragraphs)
        for (const r of p.runs) out.push({ font: r.marks.font, bold: r.marks.bold, italic: r.marks.italic, unicode: !complex && isStandard(r.marks.font) && ![...r.text].every(isWinAnsiChar) });
    }
    const seen = new Set<string>();
    return out.filter((x) => {
      const k = `${x.font}|${x.bold}|${x.italic}|${x.unicode}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [objects]);
  useEffect(() => {
    void ensureFontsFor(needed);
  }, [needed]);

  const info = useCallback(
    (t: TextObj): TextInfo => {
      const hit = cache.current.get(t);
      if (hit) return hit;
      let exact = true;
      const coverage = (font: Parameters<typeof getLoadedFont>[0], variant: Parameters<typeof getLoadedFont>[1], cp: number) => {
        const f = getLoadedFont(font, variant);
        if (!f) {
          if (fontLoadError(font, variant)) return false;
          exact = false;
          return true; // provisional until loaded
        }
        return f.fk.hasGlyphForCodePoint(cp);
      };
      const strategy = chooseStrategy(t.paragraphs, coverage);
      let layout: TextLayout;
      let drawn = t.paragraphs;
      if (strategy.kind === 'vector') {
        drawn = applyStrategyFonts(t.paragraphs, strategy);
        const fallback = canvasMeasure(canvasCtx());
        const measure = vectorMeasure((f, v) => {
          const l = getLoadedFont(f, v);
          if (!l) exact = false;
          return l?.fk;
        }, fallback);
        layout = layoutText(drawn, { width: t.w, padding: t.padding }, measure);
      } else {
        layout = layoutText(t.paragraphs, { width: t.w, padding: t.padding }, canvasMeasure(canvasCtx()));
      }
      const res: TextInfo = { layout, strategy, drawn, note: describeStrategy(strategy), exact };
      if (exact) cache.current.set(t, res);
      return res;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  );

  const sizer = useCallback((t: TextObj) => {
    const l = info(t).layout;
    return { w: l.width, h: l.height };
  }, [info]);

  return { info, sizer, version };
}

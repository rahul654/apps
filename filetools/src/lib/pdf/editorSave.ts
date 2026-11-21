/**
 * Writing editor objects and form values into a PDF with pdf-lib.
 * Pure (no DOM) so it's covered by Node tests.
 */
import {
  BlendMode,
  LineCapStyle,
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFRef,
  PDFTextField,
  PDFHexString,
  PDFBool,
  degrees,
  rgb,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import { displayFrame, displayToPdf, pdfToDisplay, type PageGeometry } from '../coords';
import { unsupportedChars } from '../winAnsi';
import { FontCache, writeTextBox, type TextSaveDeps } from '../text/boxWriter';
import { DEFAULT_LINE_HEIGHT, DEFAULT_MARKS, makeParagraph, plainText } from '../text/model';
import { analyzeText } from '../text/scripts';
import { arrowHead, hexToRgb01, smoothPath, type EditorObject, type FormFieldInfo, type FormValue } from './editorModel';
import { isolateExistingContent, loadPdf, pageGeometry, removeUnreachableObjects, type EmbeddableImage } from './ops';

const c3 = (hex: string) => {
  const [r, g, b] = hexToRgb01(hex);
  return rgb(r, g, b);
};

/** Draw one editor object onto a pdf-lib page. */
/** Draw one non-text editor object onto a pdf-lib page (text boxes go through writeTextBox). */
export function drawObject(page: PDFPage, g: PageGeometry, o: EditorObject, deps: { image: (id: string) => PDFImage | undefined }): void {
  const rot = degrees(g.rotation);
  switch (o.type) {
    case 'text':
      return;
    case 'rect':
    case 'ellipse': {
      const common = {
        color: o.fill ? c3(o.fill) : undefined,
        opacity: o.fill ? o.opacity : undefined,
        borderColor: o.stroke ? c3(o.stroke) : undefined,
        borderWidth: o.stroke ? o.strokeWidth : 0,
        borderOpacity: o.stroke ? o.opacity : undefined,
        rotate: rot,
      };
      if (o.type === 'rect') {
        const p = displayToPdf(g, o.x, o.y + o.h);
        page.drawRectangle({ x: p.x, y: p.y, width: o.w, height: o.h, ...common });
      } else {
        const c = displayToPdf(g, o.x + o.w / 2, o.y + o.h / 2);
        page.drawEllipse({ x: c.x, y: c.y, xScale: o.w / 2, yScale: o.h / 2, ...common });
      }
      return;
    }
    case 'cover': {
      const p = displayToPdf(g, o.x, o.y + o.h);
      page.drawRectangle({ x: p.x, y: p.y, width: o.w, height: o.h, color: o.color === 'black' ? rgb(0, 0, 0) : rgb(1, 1, 1), borderWidth: 0, rotate: rot });
      return;
    }
    case 'line': {
      const color = c3(o.color);
      const seg = (x1: number, y1: number, x2: number, y2: number) => {
        const a = displayToPdf(g, x1, y1);
        const b = displayToPdf(g, x2, y2);
        page.drawLine({ start: a, end: b, thickness: o.width, color, opacity: o.opacity, lineCap: LineCapStyle.Round });
      };
      seg(o.x1, o.y1, o.x2, o.y2);
      if (o.arrow) {
        const [ax, ay, bx, by] = arrowHead(o.x1, o.y1, o.x2, o.y2, o.width);
        seg(o.x2, o.y2, ax, ay);
        seg(o.x2, o.y2, bx, by);
      }
      return;
    }
    case 'path': {
      const f = displayFrame(g);
      page.drawSvgPath(smoothPath(o.points), {
        x: f.origin.x,
        y: f.origin.y,
        rotate: degrees(f.rotate),
        borderColor: c3(o.color),
        borderWidth: o.width,
        borderOpacity: o.opacity,
        borderLineCap: LineCapStyle.Round,
        blendMode: o.highlighter ? BlendMode.Multiply : undefined,
      });
      return;
    }
    case 'image': {
      const img = deps.image(o.imageId);
      if (!img) return;
      const p = displayToPdf(g, o.x, o.y + o.h);
      page.drawImage(img, { x: p.x, y: p.y, width: o.w, height: o.h, rotate: rot });
      return;
    }
  }
}

// ---------------------------------------------------------------- forms

/** Detect AcroForm fields and where their widgets are (display space). */
export async function listFormFields(bytes: Uint8Array): Promise<FormFieldInfo[]> {
  const doc = await loadPdf(bytes);
  if (!doc.catalog.get(PDFName.of('AcroForm'))) return [];
  return listFormFieldsOf(doc);
}

export function listFormFieldsOf(doc: PDFDocument): FormFieldInfo[] {
  const form = doc.getForm();
  const pages = doc.getPages();
  const pageIndexByRef = new Map<string, number>();
  pages.forEach((p, i) => pageIndexByRef.set(p.ref.toString(), i));
  const annotPage = new Map<string, number>();
  pages.forEach((p, i) => {
    const annots = p.node.Annots();
    if (!annots) return;
    for (const a of annots.asArray()) if (a instanceof PDFRef) annotPage.set(a.toString(), i);
  });

  const out: FormFieldInfo[] = [];
  for (const field of form.getFields()) {
    const name = field.getName();
    let type: FormFieldInfo['type'] | null = null;
    let value: FormValue = '';
    let options: string[] | undefined;
    let multiline: boolean | undefined;
    let maxLength: number | undefined;
    if (field instanceof PDFTextField) {
      type = 'text';
      value = field.getText() ?? '';
      multiline = field.isMultiline();
      maxLength = field.getMaxLength();
    } else if (field instanceof PDFCheckBox) {
      type = 'checkbox';
      value = field.isChecked();
    } else if (field instanceof PDFRadioGroup) {
      type = 'radio';
      value = field.getSelected() ?? '';
      options = field.getOptions();
    } else if (field instanceof PDFDropdown) {
      type = 'dropdown';
      value = field.getSelected()[0] ?? '';
      options = field.getOptions();
    } else if (field instanceof PDFOptionList) {
      type = 'optionlist';
      value = field.getSelected()[0] ?? '';
      options = field.getOptions();
    }
    if (!type) continue; // buttons and signature fields aren't fillable here
    const widgets = field.acroField.getWidgets();
    widgets.forEach((w, wi) => {
      const ref = doc.context.getObjectRef(w.dict);
      const pRef = w.P();
      let page = pRef ? pageIndexByRef.get(pRef.toString()) : undefined;
      if (page === undefined && ref) page = annotPage.get(ref.toString());
      if (page === undefined) return;
      const r = w.getRectangle();
      const g = pageGeometry(pages[page]);
      const a = pdfToDisplay(g, r.x, r.y);
      const b = pdfToDisplay(g, r.x + r.width, r.y + r.height);
      out.push({
        key: `${name}#${wi}`,
        name,
        type: type!,
        page,
        rect: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) },
        value,
        option: type === 'radio' && options && options.length === widgets.length ? options[wi] : undefined,
        options,
        multiline,
        readOnly: field.isReadOnly(),
        maxLength,
      });
    });
  }
  return out;
}

/** Display-space rects of a field's widgets, per page index. */
function widgetPlacements(doc: PDFDocument, fieldName: string): { page: number; rect: { x: number; y: number; w: number; h: number } }[] {
  return listFormFieldsOf(doc).filter((f) => f.name === fieldName).map((f) => ({ page: f.page, rect: f.rect }));
}

/**
 * Write form values; returns warnings for fields that couldn't be set exactly.
 *
 * Text values outside WinAnsi: if Noto Sans has every glyph (and no shaping is needed),
 * the field appearance is generated with an embedded Noto Sans. Complex scripts can't
 * be shaped by pdf-lib: when flattening, those fields are rasterised (browser canvas)
 * into the page; otherwise the value is stored, the stale appearance removed and
 * NeedAppearances set so the viewer draws it.
 */
export async function applyFormValues(doc: PDFDocument, values: Record<string, FormValue>, flatten: boolean, deps?: TextSaveDeps, sharedCache?: FontCache): Promise<string[]> {
  const warnings: string[] = [];
  const form = doc.getForm();
  const rasterJobs: { name: string; value: string; multiline: boolean }[] = [];
  let noto: Awaited<ReturnType<FontCache['pdfFont']>> | null = null;
  const cache = deps ? (sharedCache ?? new FontCache(doc, deps)) : null;
  let needAppearances = false;
  for (const [name, value] of Object.entries(values)) {
    try {
      const field = form.getField(name);
      if (field instanceof PDFTextField) {
        const text = String(value);
        const bad = unsupportedChars(text);
        if (!bad.length) {
          field.setText(text);
          continue;
        }
        const report = analyzeText(text);
        const complex = report.complex.length > 0 || report.emoji || report.combining;
        let covered = false;
        if (!complex && cache) {
          const fk = await cache.fontkitFont('NotoSans', 'regular');
          covered = [...text].every((ch) => /\s/.test(ch) || fk.hasGlyphForCodePoint(ch.codePointAt(0)!));
        }
        if (covered && cache) {
          noto ??= await cache.pdfFont({ ...DEFAULT_MARKS, font: 'NotoSans' });
          field.setText(text);
          field.updateAppearances(noto);
          continue;
        }
        if (flatten && deps?.rasterize) {
          rasterJobs.push({ name, value: text, multiline: field.isMultiline() });
          continue;
        }
        // Store the value; drop the old appearance so it can't show (or leak) the previous value.
        field.acroField.setValue(PDFHexString.fromText(text));
        for (const w of field.acroField.getWidgets()) w.dict.delete(PDFName.of('AP'));
        needAppearances = true;
        warnings.push(
          flatten
            ? `Field “${name}” uses ${report.complex.join(', ') || 'characters'} that can’t be drawn into a flattened form here; it was left as a fillable field whose appearance depends on the PDF viewer.`
            : `Field “${name}” uses ${report.complex.join(', ') || 'characters'} that need text shaping; the viewer will draw it, so its look may vary between PDF apps.`,
        );
      } else if (field instanceof PDFCheckBox) {
        if (value) field.check();
        else field.uncheck();
      } else if (field instanceof PDFRadioGroup) {
        if (value) field.select(String(value));
        else field.clear();
      } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
        if (value) field.select(String(value));
        else field.clear();
      }
    } catch (e) {
      warnings.push(`Field “${name}” couldn’t be set: ${(e as Error).message}`);
    }
  }

  // Complex-script fields in a flattened form: draw the value as an image, remove the field.
  if (rasterJobs.length && deps?.rasterize && cache) {
    const pages = doc.getPages();
    for (const job of rasterJobs) {
      const field = form.getTextField(job.name);
      const placements = widgetPlacements(doc, job.name);
      form.removeField(field);
      for (const pl of placements) {
        const size = job.multiline ? 10 : Math.max(6, Math.min(pl.rect.h * 0.62, 14));
        const marks = { ...DEFAULT_MARKS, font: 'NotoSans' as const, size, color: '#000000' };
        const paragraphs = job.multiline ? job.value.split('\n').map((l) => makeParagraph(l, marks, 'start', DEFAULT_LINE_HEIGHT)) : [makeParagraph(job.value.replace(/\n/g, ' '), marks, 'start', 1.15)];
        const res = await deps.rasterize({ paragraphs, width: pl.rect.w, padding: 2, background: null, dpi: 300 });
        const page = pages[pl.page];
        const g = pageGeometry(page);
        isolateExistingContent(page);
        const img = await doc.embedPng(res.image.bytes);
        const h = Math.min(res.height, pl.rect.h);
        const w = h < res.height ? (pl.rect.w * h) / res.height : pl.rect.w;
        const top = job.multiline ? pl.rect.y : pl.rect.y + (pl.rect.h - h) / 2;
        const pt = displayToPdf(g, pl.rect.x, top + h);
        page.drawImage(img, { x: pt.x, y: pt.y, width: w, height: h, rotate: degrees(g.rotation) });
      }
      warnings.push(`Field “${job.name}” (${analyzeText(job.value).complex.join(', ') || 'complex text'}) was flattened as an image — its text isn’t selectable.`);
    }
  }
  if (needAppearances) form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);

  try {
    if (flatten) form.flatten();
    // Regenerate appearances now (pdf-lib would otherwise do it during save(), after
    // our clean-up pass, leaving the old values' appearance streams in the file).
    else form.updateFieldAppearances();
  } catch (e) {
    warnings.push(`Couldn’t ${flatten ? 'flatten the form' : 'update the form’s appearance'}: ${(e as Error).message}`);
  }
  return warnings;
}

// ---------------------------------------------------------------- save

export interface EditPayload {
  objects: EditorObject[];
  images: Record<string, EmbeddableImage>;
  formValues?: Record<string, FormValue>;
  flattenForm?: boolean;
}

export interface TextBoxReport {
  id: string;
  page: number;
  kind: 'vector' | 'raster' | 'skipped';
  note: string;
  preview: string;
}

export interface EditResult {
  bytes: Uint8Array;
  /** Pages with "secure redact" boxes: these must be rasterised next. */
  securePages: number[];
  warnings: string[];
  textBoxes: TextBoxReport[];
}

/** Without deps only standard fonts are available (enough for WinAnsi text). */
export async function applyEdits(srcBytes: Uint8Array, payload: EditPayload, deps?: TextSaveDeps): Promise<EditResult> {
  const doc = await loadPdf(srcBytes);
  const pages = doc.getPages();
  const securePages = [...new Set(payload.objects.filter((o) => o.type === 'cover' && o.secure).map((o) => o.page))].sort((a, b) => a - b);
  const warnings: string[] = [];
  const textDeps: TextSaveDeps = deps ?? {
    fontkit: { create: () => { throw new Error('Bundled fonts aren’t available here.'); } },
    fontBytes: () => Promise.reject(new Error('Bundled fonts aren’t available here.')),
  };

  const fontCache = new FontCache(doc, textDeps);
  const hasForm = Boolean(doc.catalog.get(PDFName.of('AcroForm')));
  if (hasForm && (payload.formValues || payload.flattenForm || securePages.length)) {
    const flatten = Boolean(payload.flattenForm || securePages.length);
    if (securePages.length && !payload.flattenForm) warnings.push('The form was flattened because secure redaction turns pages into images.');
    warnings.push(...(await applyFormValues(doc, payload.formValues ?? {}, flatten, deps, deps ? fontCache : undefined)));
  }

  const images = new Map<string, PDFImage>();
  for (const o of payload.objects) {
    if (o.type === 'image' && !images.has(o.imageId)) {
      const img = payload.images[o.imageId];
      if (img) images.set(o.imageId, img.format === 'png' ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes));
    }
  }

  const textBoxes: TextBoxReport[] = [];
  const touched = new Set<number>();
  for (const o of payload.objects) {
    const page = pages[o.page];
    if (!page) continue;
    if (!touched.has(o.page)) {
      isolateExistingContent(page);
      touched.add(o.page);
    }
    const g = pageGeometry(page);
    if (o.type === 'text') {
      const preview = plainText(o.paragraphs).trim().slice(0, 40);
      if (!preview) continue;
      try {
        const res = await writeTextBox(doc, page, g, o, fontCache, textDeps);
        textBoxes.push({ id: o.id, page: o.page, kind: res.written ? res.strategy.kind : 'skipped', note: res.note, preview });
        if (!res.written) warnings.push(`Text box “${preview}” on page ${o.page + 1} needs to be saved as an image, which isn’t possible here; it was left out.`);
      } catch (e) {
        textBoxes.push({ id: o.id, page: o.page, kind: 'skipped', note: String((e as Error).message), preview });
        warnings.push(`Text box “${preview}” on page ${o.page + 1} couldn’t be written: ${(e as Error).message}`);
      }
      continue;
    }
    drawObject(page, g, o, { image: (id) => images.get(id) });
  }
  await doc.flush();
  removeUnreachableObjects(doc);
  const bytes = await doc.save({ useObjectStreams: true, updateFieldAppearances: false });
  return { bytes, securePages, warnings, textBoxes };
}

/**
 * Replace pages with full-page images (secure redaction). The new page has the
 * displayed size of the old one and no rotation; the old page's dictionary and
 * content streams are deleted so their text can't be recovered from the file.
 */
export async function replacePagesWithImages(bytes: Uint8Array, replacements: Map<number, EmbeddableImage>): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const ctx = doc.context;
  for (const [index, image] of replacements) {
    const old = doc.getPage(index);
    const g = pageGeometry(old);
    const dw = g.rotation % 180 ? g.height : g.width;
    const dh = g.rotation % 180 ? g.width : g.height;
    const embedded = image.format === 'png' ? await doc.embedPng(image.bytes) : await doc.embedJpg(image.bytes);
    const fresh = doc.insertPage(index, [dw, dh]);
    fresh.drawImage(embedded, { x: 0, y: 0, width: dw, height: dh });
    doc.removePage(index + 1);
    // Delete the old page's content streams and annotations, then the page itself.
    const contents = old.node.Contents();
    const refs: PDFRef[] = [];
    const raw = old.node.get(PDFName.of('Contents'));
    if (raw instanceof PDFRef) refs.push(raw);
    if (contents && 'asArray' in contents) for (const c of contents.asArray()) if (c instanceof PDFRef) refs.push(c);
    const annots = old.node.Annots();
    if (annots) for (const a of annots.asArray()) if (a instanceof PDFRef) refs.push(a);
    for (const r of refs) ctx.delete(r);
    ctx.delete(old.ref);
  }
  await doc.flush();
  removeUnreachableObjects(doc);
  return doc.save({ useObjectStreams: true });
}

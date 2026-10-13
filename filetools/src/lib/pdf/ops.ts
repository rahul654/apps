/**
 * PDF operations built on pdf-lib. Pure (no DOM), so they run in Node for tests.
 * Inputs and outputs are Uint8Array bytes.
 */
import {
  EncryptedPDFError,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFPage,
  PDFRef,
  PDFStream,
  StandardFonts,
  degrees,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  type PDFFont,
} from 'pdf-lib';
import { displaySize, displayToPdf, normalizeRotation, type PageGeometry } from '../coords';
import { unsupportedChars } from '../winAnsi';

/** An error whose message is safe and helpful to show to the user as-is. */
export class PdfUserError extends Error {
  readonly code: 'encrypted' | 'invalid' | 'font' | 'other';
  constructor(code: PdfUserError['code'], message: string) {
    super(message);
    this.code = code;
    this.name = 'PdfUserError';
  }
}

export const ENCRYPTED_MESSAGE =
  'This PDF is password-protected or encrypted. Editing tools here can’t modify encrypted PDFs. ' +
  'Remove the protection first (e.g. open it in a PDF viewer and “Print to PDF”), then try again. ' +
  '“PDF → Images” can still open it with the password.';

/** Load for modification. Keeps the existing metadata untouched (no Producer/ModDate rewrite). */
export async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    if (e instanceof EncryptedPDFError || /encrypt/i.test(String((e as Error)?.message))) {
      throw new PdfUserError('encrypted', ENCRYPTED_MESSAGE);
    }
    throw new PdfUserError('invalid', `This file couldn’t be read as a PDF (${(e as Error)?.message ?? e}).`);
  }
}

export function pageGeometry(page: PDFPage): PageGeometry {
  const box = page.getCropBox();
  return { x0: box.x, y0: box.y, width: box.width, height: box.height, rotation: normalizeRotation(page.getRotation().angle) };
}

/**
 * Wrap a page's existing content in q … Q so anything we draw afterwards starts from
 * a clean graphics state. Some PDFs leave the CTM changed at the end of their content
 * stream, which would otherwise shift or scale our additions.
 */
export function isolateExistingContent(page: PDFPage): void {
  const ctx = page.doc.context;
  page.node.normalize();
  if (!page.node.Contents()) return;
  const start = ctx.register(ctx.contentStream([pushGraphicsState()]));
  const end = ctx.register(ctx.contentStream([popGraphicsState()]));
  page.node.wrapContentStreams(start, end);
}

/**
 * Delete every indirect object that isn't reachable from the trailer (Root/Info).
 * pdf-lib otherwise writes orphaned objects (deleted pages, old metadata) back out,
 * so "removed" content would still be in the file.
 */
export function removeUnreachableObjects(doc: PDFDocument): number {
  const ctx = doc.context;
  const seen = new Set<string>();
  const stack: unknown[] = [ctx.trailerInfo.Root, ctx.trailerInfo.Info];
  while (stack.length) {
    const obj = stack.pop();
    if (!obj) continue;
    if (obj instanceof PDFRef) {
      const key = obj.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      stack.push(ctx.lookup(obj));
    } else if (obj instanceof PDFDict) {
      for (const [, v] of obj.entries()) stack.push(v);
    } else if (obj instanceof PDFArray) {
      for (const v of obj.asArray()) stack.push(v);
    } else if (obj instanceof PDFStream) {
      stack.push(obj.dict);
    }
  }
  let removed = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!seen.has(ref.toString())) {
      ctx.delete(ref);
      removed++;
    }
  }
  return removed;
}

/** Save after embedding pending fonts/images and dropping orphaned objects. */
export async function saveClean(doc: PDFDocument): Promise<Uint8Array> {
  await doc.flush();
  removeUnreachableObjects(doc);
  return doc.save({ useObjectStreams: true });
}

function copyInfo(from: PDFDocument, to: PDFDocument) {
  const title = from.getTitle();
  const author = from.getAuthor();
  const subject = from.getSubject();
  const keywords = from.getKeywords();
  if (title) to.setTitle(title);
  if (author) to.setAuthor(author);
  if (subject) to.setSubject(subject);
  if (keywords) to.setKeywords(keywords.split(/\s*[,;]\s*|\s+/).filter(Boolean));
}

// ---------------------------------------------------------------- organize / split

export type PlanItem =
  | { kind: 'page'; index: number; rotate?: number }
  | { kind: 'blank'; width: number; height: number; rotate?: number };

/**
 * Build a new PDF from a plan: pages in this order (reordered, duplicated, deleted by
 * omission), extra clockwise rotation per page, and inserted blank pages. Uses a fresh
 * document so content of removed pages is really gone. Form fields and bookmarks
 * aren't carried over.
 */
export async function buildFromPlan(srcBytes: Uint8Array, plan: PlanItem[]): Promise<Uint8Array> {
  if (plan.length === 0) throw new PdfUserError('other', 'The result would have no pages.');
  const src = await loadPdf(srcBytes);
  const out = await PDFDocument.create();
  copyInfo(src, out);
  const count = src.getPageCount();
  const indices = plan.flatMap((p) => (p.kind === 'page' ? [p.index] : []));
  for (const i of indices) if (i < 0 || i >= count) throw new PdfUserError('other', `Page ${i + 1} doesn’t exist.`);
  const copied = await out.copyPages(src, indices);
  let c = 0;
  for (const item of plan) {
    if (item.kind === 'page') {
      const page = out.addPage(copied[c++]);
      if (item.rotate) page.setRotation(degrees(normalizeRotation(page.getRotation().angle + item.rotate)));
    } else {
      const page = out.addPage([item.width, item.height]);
      if (item.rotate) page.setRotation(degrees(normalizeRotation(item.rotate)));
    }
  }
  return out.save({ useObjectStreams: true });
}

/** One PDF per group of 0-based page indices. */
export async function splitPdf(srcBytes: Uint8Array, groups: number[][]): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for (const g of groups) out.push(await buildFromPlan(srcBytes, g.map((index) => ({ kind: 'page' as const, index }))));
  return out;
}

export async function getPageCount(bytes: Uint8Array): Promise<number> {
  return (await loadPdf(bytes)).getPageCount();
}

// ---------------------------------------------------------------- images & merge

/** An image ready for pdf-lib: PNG or baseline JPEG bytes (EXIF orientation already applied). */
export interface EmbeddableImage {
  bytes: Uint8Array;
  format: 'png' | 'jpg';
  /** Pixel size. */
  width: number;
  height: number;
}

export type PageSizeName = 'A4' | 'Letter' | 'fit';
export type Orientation = 'auto' | 'portrait' | 'landscape';

export const PAGE_SIZES: Record<Exclude<PageSizeName, 'fit'>, [number, number]> = {
  A4: [595.28, 841.89],
  Letter: [612, 792],
};

/** 1 CSS px = 0.75 pt (96 dpi). Used for "fit page to image". */
export const PX_TO_PT = 0.75;

export interface ImageLayout {
  pageWidth: number;
  pageHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where an image goes on its page (PDF points, bottom-left origin). Never upscales beyond the box. */
export function layoutImageOnPage(imgW: number, imgH: number, size: PageSizeName, orientation: Orientation, marginPt: number): ImageLayout {
  const m = Math.max(0, marginPt);
  const iw = imgW * PX_TO_PT;
  const ih = imgH * PX_TO_PT;
  if (size === 'fit') {
    return { pageWidth: iw + 2 * m, pageHeight: ih + 2 * m, x: m, y: m, width: iw, height: ih };
  }
  let [pw, ph] = PAGE_SIZES[size];
  const landscape = orientation === 'landscape' || (orientation === 'auto' && imgW > imgH);
  if (landscape) [pw, ph] = [ph, pw];
  const bw = Math.max(1, pw - 2 * m);
  const bh = Math.max(1, ph - 2 * m);
  const scale = Math.min(bw / iw, bh / ih, 1);
  const w = iw * scale;
  const h = ih * scale;
  return { pageWidth: pw, pageHeight: ph, x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h };
}

async function embedImage(doc: PDFDocument, img: EmbeddableImage) {
  return img.format === 'png' ? doc.embedPng(img.bytes) : doc.embedJpg(img.bytes);
}

export interface ImagesToPdfOptions {
  pageSize: PageSizeName;
  orientation: Orientation;
  marginPt: number;
}

export async function addImagePages(doc: PDFDocument, images: EmbeddableImage[], opts: ImagesToPdfOptions) {
  for (const img of images) {
    const embedded = await embedImage(doc, img);
    const l = layoutImageOnPage(img.width, img.height, opts.pageSize, opts.orientation, opts.marginPt);
    const page = doc.addPage([l.pageWidth, l.pageHeight]);
    page.drawImage(embedded, { x: l.x, y: l.y, width: l.width, height: l.height });
  }
}

export async function imagesToPdf(images: EmbeddableImage[], opts: ImagesToPdfOptions): Promise<Uint8Array> {
  if (images.length === 0) throw new PdfUserError('other', 'Add at least one image.');
  const doc = await PDFDocument.create();
  await addImagePages(doc, images, opts);
  return doc.save({ useObjectStreams: true });
}

export type MergeInput = { kind: 'pdf'; bytes: Uint8Array; name: string } | { kind: 'image'; image: EmbeddableImage; name: string };

export async function mergeInputs(inputs: MergeInput[], imageOpts: ImagesToPdfOptions): Promise<Uint8Array> {
  if (inputs.length === 0) throw new PdfUserError('other', 'Add at least one file.');
  const out = await PDFDocument.create();
  for (const input of inputs) {
    if (input.kind === 'pdf') {
      let src: PDFDocument;
      try {
        src = await loadPdf(input.bytes);
      } catch (e) {
        throw new PdfUserError(e instanceof PdfUserError ? e.code : 'invalid', `${input.name}: ${(e as Error).message}`);
      }
      const pages = await out.copyPages(src, src.getPageIndices());
      for (const p of pages) out.addPage(p);
    } else {
      await addImagePages(out, [input.image], imageOpts);
    }
  }
  return out.save({ useObjectStreams: true });
}

// ---------------------------------------------------------------- stamps

export type StampPosition = 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';

export interface PageNumberOptions {
  /** Tokens: {n} = page number, {total} = page count. */
  format: string;
  position: StampPosition;
  startAt: number;
  fontSize: number;
  marginPt: number;
  /** 0-based page indices to number; undefined = all. */
  pages?: number[];
  color?: [number, number, number];
}

export function formatPageNumber(format: string, n: number, total: number): string {
  return format.replace(/\{n\}/g, String(n)).replace(/\{total\}/g, String(total));
}

/** Draw `text` at a display-space baseline point so it reads upright on rotated pages. */
function drawUprightText(page: PDFPage, text: string, font: PDFFont, size: number, dx: number, dyBaseline: number, extra: { opacity?: number; color?: [number, number, number] } = {}) {
  const g = pageGeometry(page);
  const p = displayToPdf(g, dx, dyBaseline);
  const c = extra.color ?? [0, 0, 0];
  page.drawText(text, { x: p.x, y: p.y, size, font, rotate: degrees(g.rotation), opacity: extra.opacity, color: rgb(c[0], c[1], c[2]) });
}

function assertEncodable(text: string) {
  const bad = unsupportedChars(text);
  if (bad.length) {
    throw new PdfUserError('font', `These characters can’t be written with the standard PDF fonts: ${bad.join(' ')}. Only Latin (Windows-1252) characters are supported.`);
  }
}

export async function addPageNumbers(bytes: Uint8Array, opts: PageNumberOptions): Promise<Uint8Array> {
  assertEncodable(opts.format);
  const doc = await loadPdf(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const targets = opts.pages ?? pages.map((_, i) => i);
  const total = opts.startAt - 1 + pages.length;
  for (const i of targets) {
    const page = pages[i];
    if (!page) continue;
    isolateExistingContent(page);
    const text = formatPageNumber(opts.format, opts.startAt + i, total);
    const { width: dw, height: dh } = displaySize(pageGeometry(page));
    const tw = font.widthOfTextAtSize(text, opts.fontSize);
    const ascent = font.heightAtSize(opts.fontSize, { descender: false });
    const [v, h] = opts.position.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right'];
    const x = h === 'left' ? opts.marginPt : h === 'right' ? dw - opts.marginPt - tw : (dw - tw) / 2;
    const y = v === 'top' ? opts.marginPt + ascent : dh - opts.marginPt;
    drawUprightText(page, text, font, opts.fontSize, x, y, { color: opts.color });
  }
  return saveClean(doc);
}

export interface WatermarkOptions {
  text: string;
  fontSize: number;
  /** 0–1 */
  opacity: number;
  /** Visual rotation in degrees, counter-clockwise (45 = diagonal bottom-left → top-right). */
  angle: number;
  position: 'center' | 'top' | 'bottom';
  color: [number, number, number];
  bold?: boolean;
  pages?: number[];
}

export async function addWatermark(bytes: Uint8Array, opts: WatermarkOptions): Promise<Uint8Array> {
  if (!opts.text.trim()) throw new PdfUserError('other', 'Enter watermark text.');
  assertEncodable(opts.text);
  const doc = await loadPdf(bytes);
  const font = await doc.embedFont(opts.bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
  const pages = doc.getPages();
  const targets = opts.pages ?? pages.map((_, i) => i);
  const tw = font.widthOfTextAtSize(opts.text, opts.fontSize);
  const capH = font.heightAtSize(opts.fontSize, { descender: false });
  for (const i of targets) {
    const page = pages[i];
    if (!page) continue;
    isolateExistingContent(page);
    const g = pageGeometry(page);
    const { width: dw, height: dh } = displaySize(g);
    const cy = opts.position === 'top' ? dh * 0.15 : opts.position === 'bottom' ? dh * 0.85 : dh / 2;
    const c = displayToPdf(g, dw / 2, cy);
    // Total rotation in PDF space = page rotation (to look upright) + requested angle.
    const phi = ((g.rotation + opts.angle) * Math.PI) / 180;
    const ox = -tw / 2;
    const oy = -capH / 2;
    const x = c.x + ox * Math.cos(phi) - oy * Math.sin(phi);
    const y = c.y + ox * Math.sin(phi) + oy * Math.cos(phi);
    page.drawText(opts.text, {
      x,
      y,
      size: opts.fontSize,
      font,
      rotate: degrees(g.rotation + opts.angle),
      opacity: opts.opacity,
      color: rgb(opts.color[0], opts.color[1], opts.color[2]),
    });
  }
  return saveClean(doc);
}

// ---------------------------------------------------------------- metadata

export interface PdfMetadata {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
  creationDate?: Date;
  modificationDate?: Date;
  hasXmp: boolean;
  pageCount: number;
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

export async function readMetadata(bytes: Uint8Array): Promise<PdfMetadata> {
  const doc = await loadPdf(bytes);
  return {
    title: safe(() => doc.getTitle()) ?? '',
    author: safe(() => doc.getAuthor()) ?? '',
    subject: safe(() => doc.getSubject()) ?? '',
    keywords: safe(() => doc.getKeywords()) ?? '',
    creator: safe(() => doc.getCreator()) ?? '',
    producer: safe(() => doc.getProducer()) ?? '',
    creationDate: safe(() => doc.getCreationDate()),
    modificationDate: safe(() => doc.getModificationDate()),
    hasXmp: Boolean(doc.catalog.get(PDFName.of('Metadata'))),
    pageCount: doc.getPageCount(),
  };
}

const INFO_KEYS = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate', 'Trapped'];

function removeXmp(doc: PDFDocument) {
  doc.catalog.delete(PDFName.of('Metadata'));
}

export interface MetadataEdit {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
}

/**
 * Write the document info fields. The XMP metadata stream (if any) is removed,
 * because it would otherwise still show the old values in many viewers.
 */
export async function writeMetadata(bytes: Uint8Array, meta: MetadataEdit): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const info = infoDict(doc);
  for (const k of ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer']) info?.delete(PDFName.of(k));
  if (meta.title) doc.setTitle(meta.title);
  if (meta.author) doc.setAuthor(meta.author);
  if (meta.subject) doc.setSubject(meta.subject);
  if (meta.keywords.trim()) doc.setKeywords(meta.keywords.split(',').map((s) => s.trim()).filter(Boolean));
  if (meta.creator) doc.setCreator(meta.creator);
  if (meta.producer) doc.setProducer(meta.producer);
  doc.setModificationDate(new Date());
  removeXmp(doc);
  return saveClean(doc);
}

/** Remove all document info fields and the XMP metadata stream. */
export async function stripMetadata(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const info = infoDict(doc);
  if (info) for (const k of INFO_KEYS) info.delete(PDFName.of(k));
  removeXmp(doc);
  return saveClean(doc);
}

function infoDict(doc: PDFDocument): PDFDict | undefined {
  const ref = doc.context.trailerInfo.Info;
  const obj = ref ? doc.context.lookup(ref) : undefined;
  return obj instanceof PDFDict ? obj : undefined;
}

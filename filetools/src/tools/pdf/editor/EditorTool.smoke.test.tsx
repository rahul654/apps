// @vitest-environment jsdom
/**
 * End-to-end-ish test of the editor UI in jsdom: open a PDF, add a text box with
 * the Text tool, fill a form field, undo/redo, save, and check the saved PDF.
 * (jsdom has no canvas, so pages don't paint — the overlay logic still runs.)
 */
import { PDFDocument, PDFRawStream, decodePDFRawStream, degrees } from 'pdf-lib';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { fontDef } from '../../../lib/fonts/registry';
import { DEFAULT_LINE_HEIGHT } from '../../../lib/text/model';
import EditorTool from './EditorTool';

beforeAll(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  class Observer {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('IntersectionObserver', Observer);
  vi.stubGlobal('ResizeObserver', Observer);
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  // ProseMirror asks for layout rects that jsdom doesn't implement.
  const rects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList;
  Range.prototype.getClientRects = rects;
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
  Element.prototype.scrollIntoView = () => {};
  document.elementFromPoint = () => null;
  // jsdom's Blob has no arrayBuffer(); polyfill via FileReader.
  Blob.prototype.arrayBuffer ??= function (this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as ArrayBuffer);
      r.onerror = () => reject(r.error);
      r.readAsArrayBuffer(this);
    });
  };
  // pdf.js: run the worker in-process (no Worker in jsdom).
  await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
});

const wait = (ms = 20) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

async function until(cond: () => boolean, label: string) {
  for (let i = 0; i < 300; i++) {
    if (cond()) return;
    await wait();
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

function pointer(el: Element, type: string, x: number, y: number, target: EventTarget = el) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.assign(ev, { pointerId: 1, pointerType: 'mouse' });
  target.dispatchEvent(ev);
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('EditorTool (jsdom)', () => {
  it('adds text, fills a form, undoes/redoes and saves', async () => {
    const src = await PDFDocument.create();
    src.addPage([400, 500]);
    const p2 = src.addPage([400, 500]);
    p2.setRotation(degrees(90));
    src.getForm().createTextField('name').addToPage(src.getPage(0), { x: 50, y: 400, width: 200, height: 24 });
    const bytes = await src.save();

    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => {
      blobs.push(b);
      return `blob:test/${blobs.length}`;
    }) as never;
    URL.revokeObjectURL = vi.fn();
    HTMLAnchorElement.prototype.click = vi.fn();

    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => {
      root.render(
        <MemoryRouter>
          <EditorTool />
        </MemoryRouter>,
      );
    });

    const input = el.querySelector('input[type=file]') as HTMLInputElement;
    const file = new File([bytes], 'form.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await until(() => el.querySelectorAll('.editor-page').length === 2, 'pages');
    await until(() => !!el.querySelector('input[aria-label="Form field name"]'), 'form field');

    // Fill the form field.
    const field = el.querySelector('input[aria-label="Form field name"]') as HTMLInputElement;
    await act(async () => setNativeValue(field, 'Asha'));

    // Text tool → click on page 2 (rotated) → type through ProseMirror → bold "Hello".
    const textBtn = [...el.querySelectorAll('button.tool-btn')].find((b) => b.textContent?.includes('Text'))!;
    await act(async () => (textBtn as HTMLButtonElement).click());
    const overlay = el.querySelectorAll('.overlay')[1];
    await act(async () => pointer(overlay, 'pointerdown', 40, 80));
    const box = el.querySelector('.rte-box') as HTMLElement & { firstChild: HTMLElement & { pmView?: EditorView } };
    expect(box).toBeTruthy();
    const view = (box as unknown as { pmView: EditorView }).pmView;
    await act(async () => view.dispatch(view.state.tr.insertText('Hello PDF')));
    await act(async () => {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
      (el.querySelector('button[aria-label="Bold"]') as HTMLButtonElement).click(); // toolbar while editing
    });
    await act(async () => el.querySelector('.rte-wrap')!.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null })));
    await until(() => !el.querySelector('.rte-box'), 'edit finished');
    const words = () => [...el.querySelectorAll('.obj-textbox text')].map((t) => `${t.textContent}:${t.getAttribute('font-weight')}`);
    expect(words()).toEqual(['Hello:700', 'PDF:400']);

    // App-level undo removes the whole new box; redo restores it with its formatting.
    const undo = el.querySelector('button[aria-label="Undo"]') as HTMLButtonElement;
    const redo = el.querySelector('button[aria-label="Redo"]') as HTMLButtonElement;
    await act(async () => undo.click());
    expect(el.querySelector('.obj-textbox')).toBeNull();
    await act(async () => redo.click());
    expect(words()).toEqual(['Hello:700', 'PDF:400']);

    // Box-level formatting (selected, not editing): italic for the whole box, then undo/redo it.
    const select = [...el.querySelectorAll('button.tool-btn')].find((b) => b.textContent?.includes('Select'))!;
    await act(async () => (select as HTMLButtonElement).click());
    // (The new box is still selected after redo.)
    const italic = el.querySelector('button[aria-label="Italic (whole box)"]') as HTMLButtonElement;
    expect(italic).toBeTruthy();
    await act(async () => italic.click());
    const styles = () => [...el.querySelectorAll('.obj-textbox text')].map((t) => t.getAttribute('font-style'));
    expect(styles()).toEqual(['italic', 'italic']);
    await act(async () => undo.click());
    expect(styles()).toEqual(['normal', 'normal']);
    await act(async () => redo.click());
    expect(styles()).toEqual(['italic', 'italic']);
    await act(async () => italic.click()); // back to upright for the PDF checks below
    expect(styles()).toEqual(['normal', 'normal']);

    // Draw a white-out box on page 1 by dragging.
    const coverBtn = [...el.querySelectorAll('button.tool-btn')].find((b) => b.textContent?.includes('White-out'))!;
    await act(async () => (coverBtn as HTMLButtonElement).click());
    const overlay1 = el.querySelectorAll('.overlay')[0];
    await act(async () => pointer(overlay1, 'pointerdown', 10, 10));
    await act(async () => pointer(overlay1, 'pointermove', 60, 40, window));
    await act(async () => pointer(overlay1, 'pointerup', 60, 40, window));

    // Save.
    const save = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Save PDF')) as HTMLButtonElement;
    await act(async () => save.click());
    await until(() => el.textContent?.includes('Saved form_edited.pdf') ?? false, 'saved');
    expect(el.textContent).toContain('White-out and cover boxes only hide content visually');
    const dl = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Download')) as HTMLButtonElement;
    await act(async () => dl.click());
    const out = blobs[blobs.length - 1];
    const doc = await PDFDocument.load(new Uint8Array(await out.arrayBuffer()));
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getForm().getTextField('name').getText()).toBe('Asha');
    let content = '';
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFRawStream) {
        try {
          content += new TextDecoder('latin1').decode(decodePDFRawStream(obj).decode());
        } catch {
          /* not a decodable stream */
        }
      }
    }
    expect(content).toContain('<48656C6C6F> Tj'); // "Hello" (bold run)
    expect(content).toContain('<20504446> Tj'); // " PDF" (regular run)
    expect(content).toContain('/Helvetica-Bold');
    expect(content).toMatch(/1 1 1 rg\n[^\n]*\n?[\s\S]*?\nf\n/); // filled white-out rectangle

    // The text clicked at screen (40, 80) on rotated page 2 must land at that spot
    // when the saved PDF is displayed (jsdom's page rect is at 0,0).
    const zoom = Number(el.querySelector('.zoom-label')!.textContent!.replace('%', '')) / 100;
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await out.arrayBuffer()), verbosity: 0 }).promise;
    const page = await pdf.getPage(2);
    const vp = page.getViewport({ scale: 1 });
    // (pdf.js in jsdom lacks font data and may truncate the extracted string; the
    // content stream check below verifies the full text.)
    const item = (await page.getTextContent()).items.find((i) => 'str' in i && i.str.startsWith('Hel'));
    if (!item || !('transform' in item)) throw new Error('text not found in saved PDF');
    const [x, y] = vp.convertToViewportPoint(item.transform[4], item.transform[5]);
    const pad = 2;
    const lineH = 14 * DEFAULT_LINE_HEIGHT;
    const asc = fontDef('Helvetica').ascent * 14;
    const desc = fontDef('Helvetica').descent * 14;
    expect(x).toBeCloseTo(40 / zoom + pad, 1);
    expect(y).toBeCloseTo(80 / zoom - 14 * 0.7 + pad + (lineH - (asc + desc)) / 2 + asc, 1);
    await pdf.destroy();

    await act(async () => root.unmount());
  });
});

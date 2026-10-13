import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DownloadButton, ToolHeader } from '../../../components/common';
import { errorMessage, Loading, Notice, ProgressBar } from '../../../components/Feedback';
import { uid } from '../../../lib/array';
import { bytesToBlob, pdfBlob, type OutputFile } from '../../../lib/download';
import { baseName, formatBytes } from '../../../lib/format';
import { translateObject, type EditorObject, type FormFieldInfo, type FormValue, type TextObj } from '../../../lib/pdf/editorModel';
import { ensureFontsFor, getFontkit, licenceLinks, loadFont } from '../../../lib/fonts/loader';
import type { TextSaveDeps } from '../../../lib/text/boxWriter';
import { plainText, type Paragraph } from '../../../lib/text/model';
import { domCanvasEnv, rasterizeTextBox } from '../../../lib/text/rasterize';
import { TextBoxPanel, TextToolPanel } from './TextBoxPanel';
import { useTextEngine } from './textEngine';
import { applyEdits, listFormFields, replacePagesWithImages } from '../../../lib/pdf/editorSave';
import type { EmbeddableImage } from '../../../lib/pdf/ops';
import { prepareImageForPdf } from '../../../lib/pdf/prepareImage';
import { rasterizePages, REDACT_DPI } from '../../../lib/pdf/secureRedact';
import { PageThumb, PdfPickerView, usePdfPicker } from '../shared';
import { PageView } from './PageView';
import { SignatureModal } from './SignatureModal';
import { DEFAULT_STYLE, type ImageAsset, type PageInfo, type Tool, type ToolStyle } from './types';
import { useHistory } from './useHistory';

const TOOLBAR: { tool: Tool; icon: string; label: string; title: string }[] = [
  { tool: 'select', icon: '🖱️', label: 'Select', title: 'Select, move and resize (Esc)' },
  { tool: 'text', icon: '🔤', label: 'Text', title: 'Click on the page to add a text box' },
  { tool: 'whiteout', icon: '⬜', label: 'White-out', title: 'Drag to cover content with a white box' },
  { tool: 'cover', icon: '⬛', label: 'Cover', title: 'Black box — covers visually, NOT secure redaction' },
  { tool: 'redact', icon: '🛡️', label: 'Redact', title: 'Secure redact — flattens the page to an image on save' },
  { tool: 'highlight', icon: '🖍️', label: 'Highlight', title: 'Freehand highlighter' },
  { tool: 'pen', icon: '✏️', label: 'Pen', title: 'Freehand pen' },
  { tool: 'rect', icon: '▭', label: 'Rect', title: 'Rectangle (Shift = square)' },
  { tool: 'ellipse', icon: '◯', label: 'Ellipse', title: 'Ellipse (Shift = circle)' },
  { tool: 'line', icon: '╱', label: 'Line', title: 'Line (Shift snaps to 45°)' },
  { tool: 'arrow', icon: '➚', label: 'Arrow', title: 'Arrow (Shift snaps to 45°)' },
];

const COLORS = ['#111111', '#e11d48', '#2563eb', '#16a34a', '#f59e0b', '#7c3aed', '#ffffff'];
const HIGHLIGHTS = ['#ffe14d', '#7cf29c', '#7cd3ff', '#ff9ee5'];
const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];

const OBJ_LABEL: Record<EditorObject['type'], string> = { text: 'Text', rect: 'Rectangle', ellipse: 'Ellipse', cover: 'Box', line: 'Line', path: 'Drawing', image: 'Image' };

function describe(o: EditorObject): string {
  if (o.type === 'text') return `🔤 ${plainText(o.paragraphs).split('\n')[0].slice(0, 28) || '(empty text)'}`;
  if (o.type === 'cover') return o.secure ? '🛡️ Secure redaction' : o.color === 'white' ? '⬜ White-out' : '⬛ Cover box';
  if (o.type === 'image') return o.signature ? '✍️ Signature' : '🖼️ Image';
  if (o.type === 'line') return o.arrow ? '➚ Arrow' : '╱ Line';
  if (o.type === 'path') return o.highlighter ? '🖍️ Highlight' : '✏️ Drawing';
  return o.type === 'rect' ? '▭ Rectangle' : '◯ Ellipse';
}

function Swatches({ colors, value, onChange, label }: { colors: string[]; value: string | null; onChange: (c: string) => void; label: string }) {
  return (
    <div className="row" role="group" aria-label={label}>
      <div className="swatches">
        {colors.map((c) => (
          <button key={c} type="button" className="swatch" style={{ background: c }} aria-pressed={value?.toLowerCase() === c} aria-label={`${label} ${c}`} onClick={() => onChange(c)} />
        ))}
      </div>
      <input type="color" className="input" aria-label={`Custom ${label.toLowerCase()}`} value={value ?? '#000000'} onChange={(e) => onChange(e.target.value)} style={{ width: 40, minHeight: 30 }} />
    </div>
  );
}

/** Keep per-page arrays referentially stable when a page's objects didn't change (so memoised pages skip re-rendering). */
function useObjectsByPage(objects: EditorObject[], pageCount: number): EditorObject[][] {
  const cache = useRef<EditorObject[][]>([]);
  return useMemo(() => {
    const next: EditorObject[][] = Array.from({ length: pageCount }, () => []);
    for (const o of objects) next[o.page]?.push(o);
    const out = next.map((arr, i) => {
      const prev = cache.current[i];
      return prev && prev.length === arr.length && prev.every((x, j) => x === arr[j]) ? prev : arr;
    });
    cache.current = out;
    return out;
  }, [objects, pageCount]);
}

const EMPTY_FIELDS: FormFieldInfo[] = [];

export default function EditorTool() {
  const picker = usePdfPicker({ requireWritable: true });
  const { pdf } = picker;
  const history = useHistory<EditorObject[]>([]);
  const objects = history.value;
  const [pages, setPages] = useState<PageInfo[] | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [style, setStyle] = useState<ToolStyle>(DEFAULT_STYLE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [currentPage, setCurrentPage] = useState(0);
  const [images, setImages] = useState<Record<string, ImageAsset>>({});
  const [fields, setFields] = useState<FormFieldInfo[]>([]);
  const [formValues, setFormValues] = useState<Record<string, FormValue>>({});
  const [flatten, setFlatten] = useState(false);
  const [sigOpen, setSigOpen] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [output, setOutput] = useState<{ file: OutputFile; notes: string[] } | null>(null);
  const [propsCollapsed, setPropsCollapsed] = useState(true);
  const [showHint, setShowHint] = useState(true);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pageEls = useRef(new Map<number, HTMLDivElement>());
  const imageInput = useRef<HTMLInputElement>(null);
  const newTextRef = useRef<string | null>(null);
  const dirty = objects.length > 0 || Object.keys(formValues).length > 0;

  // Release image object URLs when they're no longer needed.
  const imagesRef = useRef(images);
  imagesRef.current = images;
  useEffect(() => () => Object.values(imagesRef.current).forEach((a) => URL.revokeObjectURL(a.url)), []);

  useEffect(() => {
    if (!dirty || output) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, output]);

  // Load page sizes and form fields when a PDF is opened.
  useEffect(() => {
    setPages(null);
    history.reset([]);
    setSelectedId(null);
    setEditingId(null);
    setFields([]);
    setFormValues({});
    setOutput(null);
    setSaveError(null);
    if (!pdf) return;
    let alive = true;
    (async () => {
      const list: PageInfo[] = [];
      for (let i = 1; i <= pdf.doc.numPages; i++) {
        const vp = (await pdf.doc.getPage(i)).getViewport({ scale: 1 });
        list.push({ width: vp.width, height: vp.height });
      }
      if (!alive) return;
      setPages(list);
      const avail = (viewportRef.current?.clientWidth || window.innerWidth) - 48;
      const maxW = Math.max(...list.map((p) => p.width));
      setZoom(Math.max(0.25, Math.min(2, Math.floor((avail / maxW) * 100) / 100)));
      try {
        const f = await listFormFields(pdf.bytes);
        if (alive) setFields(f);
      } catch {
        /* no usable form */
      }
    })().catch((e) => picker.setError(errorMessage(e)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf]);

  // Track which page is most visible.
  useEffect(() => {
    if (!pages) return;
    const ratios = new Map<number, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) ratios.set(Number((e.target as HTMLElement).dataset.page), e.intersectionRatio);
        let best = 0;
        let bestR = -1;
        for (const [k, r] of ratios) if (r > bestR) { best = k; bestR = r; }
        setCurrentPage(best);
      },
      { root: viewportRef.current, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    pageEls.current.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [pages, zoom]);

  const engine = useTextEngine(objects);
  const measure = engine.sizer;

  const registerEl = useCallback((i: number, el: HTMLDivElement | null) => {
    if (el) pageEls.current.set(i, el);
    else pageEls.current.delete(i);
  }, []);

  const editingRef = useRef<string | null>(null);
  editingRef.current = editingId;
  const objectsRef = useRef(objects);
  objectsRef.current = objects;

  const finishTextEdit = useCallback(() => {
    const id = editingRef.current;
    if (!id) return;
    editingRef.current = null;
    setEditingId(null);
    const isNew = newTextRef.current === id;
    newTextRef.current = null;
    const t = objectsRef.current.find((o) => o.id === id);
    if (t && t.type === 'text' && !plainText(t.paragraphs).trim()) {
      // Empty text box: remove it (a brand-new one leaves no undo step behind).
      history.transient((l) => l.filter((o) => o.id !== id));
      if (isNew) history.cancel();
      else history.end();
      setSelectedId((sel) => (sel === id ? null : sel));
    } else {
      history.end(); // one undo step for the whole edit
    }
  }, [history.transient, history.cancel, history.end]);

  const onSelect = useCallback(
    (id: string | null) => {
      if (editingRef.current && editingRef.current !== id) finishTextEdit();
      setSelectedId(id);
    },
    [finishTextEdit],
  );

  const onCreate = useCallback(
    (o: EditorObject, edit?: boolean) => {
      finishTextEdit();
      if (edit && o.type === 'text') {
        history.begin();
        history.transient((l) => [...l, o]);
        newTextRef.current = o.id;
        setSelectedId(o.id);
        setEditingId(o.id);
        return;
      }
      history.set((l) => [...l, o]);
      if (o.type !== 'path') setSelectedId(o.id);
    },
    [history.begin, history.transient, history.set, finishTextEdit],
  );

  const onTransient = useCallback((o: EditorObject) => history.transient((l) => l.map((x) => (x.id === o.id ? o : x))), [history.transient]);

  const onEditText = useCallback(
    (id: string | null) => {
      if (id === null) return finishTextEdit();
      if (editingRef.current === id) return;
      finishTextEdit();
      history.begin();
      setSelectedId(id);
      setEditingId(id);
    },
    [finishTextEdit, history.begin],
  );

  const onTextChange = useCallback((id: string, paragraphs: Paragraph[]) => history.transient((l) => l.map((x) => (x.id === id && x.type === 'text' ? { ...x, paragraphs } : x))), [history.transient]);

  const onFormChange = useCallback((name: string, value: FormValue) => {
    setFormValues((v) => ({ ...v, [name]: value }));
    setOutput(null);
  }, []);

  const selected = objects.find((o) => o.id === selectedId) ?? null;

  const updateSelected = (patch: Partial<EditorObject>) => {
    if (!selected) return;
    history.set((l) => l.map((o) => (o.id === selected.id ? ({ ...o, ...patch } as EditorObject) : o)));
  };
  const deleteSelected = useCallback(() => {
    setSelectedId((id) => {
      if (id) history.set((l) => l.filter((o) => o.id !== id));
      return null;
    });
  }, [history.set]);

  const reorder = (dir: 'front' | 'back') => {
    if (!selected) return;
    history.set((l) => {
      const rest = l.filter((o) => o.id !== selected.id);
      return dir === 'front' ? [...rest, selected] : [selected, ...rest];
    });
  };

  const duplicate = () => {
    if (!selected) return;
    const copy = { ...translateObject(selected, 12, 12), id: uid('o') } as EditorObject;
    history.set((l) => [...l, copy]);
    setSelectedId(copy.id);
  };

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest?.('input, textarea, select, [contenteditable="true"], .modal')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) history.redo();
        else history.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        history.redo();
        return;
      }
      if (mod) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        deleteSelected();
      } else if (e.key.startsWith('Arrow') && selectedId) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        history.set((l) => l.map((o) => (o.id === selectedId ? translateObject(o, dx, dy) : o)));
      } else if (e.key === 'Escape') {
        if (selectedId) setSelectedId(null);
        else setTool('select');
      } else if (e.key === 'Enter' && selected?.type === 'text') {
        e.preventDefault();
        onEditText(selected.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, selected, deleteSelected, history.undo, history.redo, history.set, onEditText]);

  const placeImage = (img: EmbeddableImage, signature: boolean) => {
    if (!pages) return;
    const id = uid('img');
    const url = URL.createObjectURL(bytesToBlob(img.bytes, img.format === 'png' ? 'image/png' : 'image/jpeg'));
    setImages((m) => ({ ...m, [id]: { image: img, url } }));
    const page = pages[currentPage];
    const maxW = page.width * (signature ? 0.3 : 0.45);
    const w = Math.min(maxW, img.width * 0.75);
    const h = (w * img.height) / img.width;
    // Centre in the visible part of the current page.
    let cy = page.height / 2;
    const el = pageEls.current.get(currentPage);
    const vp = viewportRef.current;
    if (el && vp) {
      const top = (vp.scrollTop - el.offsetTop) / zoom;
      const visTop = Math.max(0, top);
      const visBottom = Math.min(page.height, top + vp.clientHeight / zoom);
      if (visBottom > visTop) cy = (visTop + visBottom) / 2;
    }
    const obj: EditorObject = { id: uid('o'), page: currentPage, type: 'image', x: (page.width - w) / 2, y: Math.max(0, cy - h / 2), w, h, imageId: id, signature };
    history.set((l) => [...l, obj]);
    setTool('select');
    setSelectedId(obj.id);
  };

  const scrollToPage = (i: number) => pageEls.current.get(i)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const setZoomKeepingCenter = (z: number) => {
    const vp = viewportRef.current;
    const ratio = z / zoom;
    const cx = vp ? vp.scrollLeft + vp.clientWidth / 2 : 0;
    const cy = vp ? vp.scrollTop + vp.clientHeight / 2 : 0;
    setZoom(z);
    requestAnimationFrame(() => {
      if (!vp) return;
      vp.scrollLeft = cx * ratio - vp.clientWidth / 2;
      vp.scrollTop = cy * ratio - vp.clientHeight / 2;
    });
  };
  const zoomStep = (dir: 1 | -1) => {
    const next = dir > 0 ? ZOOMS.find((z) => z > zoom + 0.001) : [...ZOOMS].reverse().find((z) => z < zoom - 0.001);
    if (next) setZoomKeepingCenter(next);
  };
  const fitWidth = () => {
    if (!pages) return;
    const avail = (viewportRef.current?.clientWidth || window.innerWidth) - 48;
    setZoomKeepingCenter(Math.max(0.25, Math.min(4, Math.floor((avail / Math.max(...pages.map((p) => p.width))) * 100) / 100)));
  };

  const rasterBoxes = objects.filter((o): o is TextObj => o.type === 'text' && plainText(o.paragraphs).trim() !== '' && engine.info(o).strategy.kind === 'raster');
  const securePages = [...new Set(objects.filter((o) => o.type === 'cover' && o.secure).map((o) => o.page))];
  const hasPlainCovers = objects.some((o) => o.type === 'cover' && !o.secure);

  const save = async () => {
    if (!pdf) return;
    finishTextEdit();
    setSaveError(null);
    setOutput(null);
    setSaving(0.05);
    try {
      const imgMap: Record<string, EmbeddableImage> = {};
      for (const [id, a] of Object.entries(images)) imgMap[id] = a.image;
      const current = objects.filter((o) => !(o.type === 'text' && !plainText(o.paragraphs).trim()));
      const fontkit = await getFontkit();
      const deps: TextSaveDeps = {
        fontkit,
        fontBytes: async (font, variant) => (await loadFont(font, variant)).bytes,
        rasterize: async (req) => {
          // Canvas only uses fonts that are already loaded.
          await ensureFontsFor(req.paragraphs.flatMap((p) => p.runs.map((r) => ({ font: r.marks.font, bold: r.marks.bold, italic: r.marks.italic }))));
          return rasterizeTextBox(req, domCanvasEnv);
        },
      };
      const res = await applyEdits(pdf.bytes, { objects: current, images: imgMap, formValues: Object.keys(formValues).length ? formValues : undefined, flattenForm: flatten && fields.length > 0 }, deps);
      let bytes = res.bytes;
      const notes = [...res.warnings];
      const asImages = res.textBoxes.filter((t) => t.kind === 'raster');
      if (asImages.length) notes.push(`Saved as images (text not selectable or searchable): ${asImages.map((t) => `“${t.preview}” (page ${t.page + 1})`).join(', ')}.`);
      const substituted = [...new Set(res.textBoxes.filter((t) => t.kind === 'vector' && /instead of/.test(t.note)).map((t) => t.note))];
      notes.push(...substituted);
      if (res.securePages.length) {
        setSaving(0.3);
        const raster = await rasterizePages(bytes, res.securePages, REDACT_DPI, (f) => setSaving(0.3 + f * 0.6));
        bytes = await replacePagesWithImages(bytes, raster);
        notes.push(`Securely redacted page${res.securePages.length > 1 ? 's' : ''} ${res.securePages.map((p) => p + 1).join(', ')}: flattened to ${REDACT_DPI}-dpi images. The text under the boxes is gone from the file; text on those pages is no longer selectable or searchable, and their links/comments were removed.`);
      }
      if (current.some((o) => o.type === 'cover' && !o.secure)) notes.push('White-out and cover boxes only hide content visually — the original text is still in the file and can be copied or extracted. Use “Redact” for sensitive information.');
      if (flatten && fields.length) notes.push('Form fields were flattened into the page and can no longer be edited.');
      setOutput({ file: { name: `${baseName(pdf.file.name)}_edited.pdf`, blob: pdfBlob(bytes) }, notes });
      setPropsCollapsed(false);
    } catch (e) {
      setSaveError(errorMessage(e));
      setPropsCollapsed(false);
    } finally {
      setSaving(null);
    }
  };

  const byPage = useObjectsByPage(objects, pages?.length ?? 0);
  const fieldsByPage = useMemo(() => {
    const m = new Map<number, FormFieldInfo[]>();
    for (const f of fields) m.set(f.page, [...(m.get(f.page) ?? []), f]);
    return m;
  }, [fields]);

  if (!pdf) {
    return (
      <div className="main">
        <ToolHeader emoji="✍️" title="Edit PDF">
          Add text, images and signatures, draw shapes, highlight, fill in forms, white-out or securely redact — then save a new PDF.
        </ToolHeader>
        <div className="stack" style={{ maxWidth: 720 }}>
          <PdfPickerView picker={picker} />
          <Notice kind="info">
            <span className="small">
              Editing existing text in place isn’t supported. To change existing text: cover it with a white box and add a new text box on top. Text boxes support mixed styles and nine font families; Latin, Cyrillic, Greek and Vietnamese are saved as real text, other scripts (Hindi, Arabic, Chinese, emoji…) as an image of the box.
            </span>
          </Notice>
        </div>
      </div>
    );
  }

  const textStyleTarget = selected?.type === 'text' ? selected : null;
  const strokeTarget = selected && (selected.type === 'rect' || selected.type === 'ellipse' || selected.type === 'line' || selected.type === 'path') ? selected : null;

  return (
    <div className="editor">
      <div className="editor-toolbar" role="toolbar" aria-label="Editing tools">
        {TOOLBAR.map((t) => (
          <button key={t.tool} type="button" className="tool-btn" aria-pressed={tool === t.tool} title={t.title} onClick={() => { finishTextEdit(); setTool(t.tool); if (t.tool !== 'select') setSelectedId(null); }}>
            <span className="ti" aria-hidden="true">{t.icon}</span>
            {t.label}
          </button>
        ))}
        <button type="button" className="tool-btn" title="Insert an image (logo, stamp…)" onClick={() => imageInput.current?.click()}>
          <span className="ti" aria-hidden="true">🖼️</span>Image
        </button>
        <button type="button" className="tool-btn" title="Draw, type or upload a signature" onClick={() => setSigOpen(true)}>
          <span className="ti" aria-hidden="true">✍️</span>Sign
        </button>
        <input
          ref={imageInput}
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              placeImage(await prepareImageForPdf(f), false);
            } catch (err) {
              setSaveError(`${f.name}: ${errorMessage(err)}`);
            }
          }}
        />
        <span className="sep" />
        <button type="button" className="btn ghost small icon" onClick={history.undo} disabled={!history.canUndo} aria-label="Undo" title="Undo (Ctrl/⌘+Z)">↶</button>
        <button type="button" className="btn ghost small icon" onClick={history.redo} disabled={!history.canRedo} aria-label="Redo" title="Redo (Ctrl/⌘+Shift+Z)">↷</button>
        <span className="sep" />
        <button type="button" className="btn ghost small icon" onClick={() => zoomStep(-1)} aria-label="Zoom out">−</button>
        <span className="zoom-label" aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button type="button" className="btn ghost small icon" onClick={() => zoomStep(1)} aria-label="Zoom in">+</button>
        <button type="button" className="btn ghost small" onClick={fitWidth}>Fit</button>
        <span className="spacer" style={{ flex: 1, minWidth: 8 }} />
        <button type="button" className="btn small" onClick={() => { if (!dirty || confirm('Discard your changes and open another file?')) picker.reset(); }}>Close</button>
        <button type="button" className="btn primary small" onClick={save} disabled={saving !== null || !pages}>
          {saving !== null ? 'Saving…' : '💾 Save PDF'}
        </button>
      </div>

      <div className="editor-body">
        <nav className="editor-thumbs" aria-label="Pages">
          {pages?.map((_, i) => (
            <button key={i} type="button" className={i === currentPage ? 'current' : ''} onClick={() => scrollToPage(i)} aria-label={`Go to page ${i + 1}`} aria-current={i === currentPage ? 'page' : undefined}>
              <PageThumb doc={pdf.doc} pageNumber={i + 1} maxSize={120} />
              {i + 1}
            </button>
          ))}
        </nav>

        <div className="editor-viewport" ref={viewportRef}>
          {!pages ? (
            <Loading label="Preparing pages…" />
          ) : (
            <div className="editor-pages">
              {pages.map((pg, i) => (
                <PageView
                  key={i}
                  index={i}
                  doc={pdf.doc}
                  width={pg.width}
                  height={pg.height}
                  zoom={zoom}
                  objects={byPage[i] ?? []}
                  selectedId={byPage[i]?.some((o) => o.id === selectedId) ? selectedId : null}
                  editingId={byPage[i]?.some((o) => o.id === editingId) ? editingId : null}
                  tool={tool}
                  style={style}
                  images={images}
                  fields={fieldsByPage.get(i) ?? EMPTY_FIELDS}
                  formValues={formValues}
                  hasForm={fields.length > 0}
                  measure={measure}
                  textInfo={engine.info}
                  onSelect={onSelect}
                  onCreate={onCreate}
                  onBegin={history.begin}
                  onTransient={onTransient}
                  onEnd={history.end}
                  onEditText={onEditText}
                  onTextChange={onTextChange}
                  onFormChange={onFormChange}
                  registerEl={registerEl}
                />
              ))}
            </div>
          )}
        </div>

        <aside className={`editor-props${propsCollapsed ? ' collapsed' : ''}`} aria-label="Properties">
          <button type="button" className="btn small mobile-props-toggle" onClick={() => setPropsCollapsed((c) => !c)} aria-expanded={!propsCollapsed}>
            {propsCollapsed ? '▲ Show properties & save options' : '▼ Hide properties'}
          </button>

          {saving !== null && <ProgressBar value={saving} label="Saving" />}
          {saveError && <Notice kind="error" onDismiss={() => setSaveError(null)}>{saveError}</Notice>}
          {output && (
            <div className="stack-sm">
              <Notice kind="success">Saved {output.file.name} ({formatBytes(output.file.blob.size)}).</Notice>
              {output.notes.map((n, i) => <Notice key={i} kind="warn"><span className="small">{n}</span></Notice>)}
              <DownloadButton files={[output.file]} />
            </div>
          )}

          {selected ? (
            <section className="stack-sm" aria-label="Selected object">
              <h3>{OBJ_LABEL[selected.type]}{selected.type === 'cover' ? (selected.secure ? ' · secure redaction' : selected.color === 'white' ? ' · white-out' : ' · cover') : ''}</h3>
              {textStyleTarget && (
                <TextBoxPanel obj={textStyleTarget} info={engine.info(textStyleTarget)} onEdit={() => onEditText(textStyleTarget.id)} onChange={(next) => history.set((l) => l.map((o) => (o.id === next.id ? next : o)))} />
              )}
              {strokeTarget && (
                <>
                  <span className="field-label">{strokeTarget.type === 'path' && strokeTarget.highlighter ? 'Highlight colour' : 'Line colour'}</span>
                  <Swatches
                    label="Line colour"
                    colors={strokeTarget.type === 'path' && strokeTarget.highlighter ? HIGHLIGHTS : COLORS}
                    value={'stroke' in strokeTarget ? strokeTarget.stroke : strokeTarget.color}
                    onChange={(c) => updateSelected(strokeTarget.type === 'rect' || strokeTarget.type === 'ellipse' ? { stroke: c } : { color: c })}
                  />
                  {(strokeTarget.type === 'rect' || strokeTarget.type === 'ellipse') && (
                    <>
                      <label className="check small"><input type="checkbox" checked={strokeTarget.stroke === null} onChange={(e) => updateSelected({ stroke: e.target.checked ? null : '#111111' })} /> No outline</label>
                      <span className="field-label">Fill</span>
                      <Swatches label="Fill colour" colors={COLORS} value={strokeTarget.fill} onChange={(c) => updateSelected({ fill: c })} />
                      <label className="check small"><input type="checkbox" checked={strokeTarget.fill === null} onChange={(e) => updateSelected({ fill: e.target.checked ? null : '#ffe14d' })} /> No fill</label>
                    </>
                  )}
                  <label className="field">
                    <span>Thickness: {'strokeWidth' in strokeTarget ? strokeTarget.strokeWidth : strokeTarget.width}pt</span>
                    <input type="range" min={0.5} max={strokeTarget.type === 'path' && strokeTarget.highlighter ? 40 : 20} step={0.5} value={'strokeWidth' in strokeTarget ? strokeTarget.strokeWidth : strokeTarget.width} onChange={(e) => updateSelected(strokeTarget.type === 'rect' || strokeTarget.type === 'ellipse' ? { strokeWidth: Number(e.target.value) } : { width: Number(e.target.value) })} />
                  </label>
                  <label className="field">
                    <span>Opacity: {Math.round(strokeTarget.opacity * 100)}%</span>
                    <input type="range" min={0.1} max={1} step={0.05} value={strokeTarget.opacity} onChange={(e) => updateSelected({ opacity: Number(e.target.value) })} />
                  </label>
                  {strokeTarget.type === 'line' && (
                    <label className="check small"><input type="checkbox" checked={strokeTarget.arrow} onChange={(e) => updateSelected({ arrow: e.target.checked })} /> Arrow head</label>
                  )}
                </>
              )}
              {selected.type === 'cover' && (
                <>
                  <div className="row">
                    <button type="button" className="btn small" aria-pressed={selected.color === 'white'} onClick={() => updateSelected({ color: 'white' })}>White</button>
                    <button type="button" className="btn small" aria-pressed={selected.color === 'black'} onClick={() => updateSelected({ color: 'black' })}>Black</button>
                  </div>
                  <label className="check small"><input type="checkbox" checked={selected.secure} onChange={(e) => updateSelected({ secure: e.target.checked })} /> Secure redact (flattens page to image)</label>
                  <p className="tiny muted">
                    {selected.secure
                      ? 'On save, this whole page is turned into an image with the box burned in, so the covered text is really removed. The page’s text becomes unselectable.'
                      : 'Cover (not secure redaction): the box hides content visually, but the original text stays in the file and can be copied or extracted.'}
                  </p>
                </>
              )}
              {selected.type === 'image' && <p className="tiny muted">Drag a corner to resize (aspect ratio is kept).</p>}
              <div className="row">
                <button type="button" className="btn small" onClick={duplicate}>Duplicate</button>
                <button type="button" className="btn small" onClick={() => reorder('front')}>To front</button>
                <button type="button" className="btn small" onClick={() => reorder('back')}>To back</button>
                <button type="button" className="btn small danger" onClick={deleteSelected}>Delete</button>
              </div>
              <p className="tiny muted">Arrow keys nudge (Shift = 10pt). Delete removes.</p>
            </section>
          ) : (
            <section className="stack-sm" aria-label="Tool settings">
              <h3>{TOOLBAR.find((t) => t.tool === tool)?.label ?? 'Select'} tool</h3>
              {tool === 'select' && <p className="small muted">Pick a tool above, or click an object to select it. Double-click (or tap twice) text to edit it.</p>}
              {tool === 'text' && <TextToolPanel style={style} setStyle={setStyle} />}
              {(tool === 'rect' || tool === 'ellipse' || tool === 'line' || tool === 'arrow' || tool === 'pen') && (
                <>
                  <p className="small muted">{tool === 'pen' ? 'Draw freehand on the page.' : 'Drag on the page to draw. Hold Shift to constrain.'}</p>
                  <Swatches label="Line colour" colors={COLORS} value={style.stroke} onChange={(c) => setStyle({ ...style, stroke: c })} />
                  <label className="field">
                    <span>Thickness: {style.strokeWidth}pt</span>
                    <input type="range" min={0.5} max={20} step={0.5} value={style.strokeWidth} onChange={(e) => setStyle({ ...style, strokeWidth: Number(e.target.value) })} />
                  </label>
                  {(tool === 'rect' || tool === 'ellipse') && (
                    <>
                      <span className="field-label">Fill</span>
                      <Swatches label="Fill colour" colors={COLORS} value={style.fill} onChange={(c) => setStyle({ ...style, fill: c })} />
                      <label className="check small"><input type="checkbox" checked={style.fill === null} onChange={(e) => setStyle({ ...style, fill: e.target.checked ? null : '#ffe14d' })} /> No fill</label>
                    </>
                  )}
                </>
              )}
              {tool === 'highlight' && (
                <>
                  <p className="small muted">Drag over text to highlight it.</p>
                  <Swatches label="Highlight colour" colors={HIGHLIGHTS} value={style.highlight} onChange={(c) => setStyle({ ...style, highlight: c })} />
                  <label className="field">
                    <span>Width: {style.highlightWidth}pt</span>
                    <input type="range" min={4} max={40} value={style.highlightWidth} onChange={(e) => setStyle({ ...style, highlightWidth: Number(e.target.value) })} />
                  </label>
                </>
              )}
              {tool === 'whiteout' && <p className="small muted">Drag over content to hide it with a white box. Note: this only hides it visually — the original text stays in the file.</p>}
              {tool === 'cover' && <p className="small muted"><b>Cover (not secure redaction).</b> A black box hides content visually, but the text underneath can still be copied or extracted.</p>}
              {tool === 'redact' && <p className="small muted"><b>Secure redact.</b> On save, each page with a redaction box is flattened to an image ({REDACT_DPI} dpi) with the box burned in, so the covered content is really removed. That page’s text won’t be selectable afterwards.</p>}
            </section>
          )}

          {fields.length > 0 && (
            <section className="stack-sm" aria-label="Form">
              <h3>Form</h3>
              <p className="small muted">{new Set(fields.map((f) => f.name)).size} fillable field{fields.length === 1 ? '' : 's'} detected — type directly into them on the page (Select tool).</p>
              <label className="check small"><input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} /> Flatten form on save (no longer editable)</label>
            </section>
          )}

          {pages && (
            <section className="stack-sm" aria-label="Objects on this page">
              <h3>Page {currentPage + 1} objects</h3>
              {(byPage[currentPage] ?? []).length === 0 ? (
                <p className="tiny muted">Nothing added on this page yet.</p>
              ) : (
                <ul className="obj-list">
                  {[...(byPage[currentPage] ?? [])].reverse().map((o) => (
                    <li key={o.id}>
                      <button type="button" className={o.id === selectedId ? 'active' : ''} onClick={() => { setTool('select'); setSelectedId(o.id); }}>{describe(o)}</button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {rasterBoxes.length > 0 && <Notice kind="info"><span className="small">{rasterBoxes.length} text box{rasterBoxes.length > 1 ? 'es' : ''} will be saved as {rasterBoxes.length > 1 ? 'images' : 'an image'} (complex script or emoji) — not selectable in the PDF.</span></Notice>}
          {securePages.length > 0 && <Notice kind="info"><span className="small">Page{securePages.length > 1 ? 's' : ''} {securePages.map((p) => p + 1).join(', ')} will be flattened to images for secure redaction.</span></Notice>}
          {hasPlainCovers && !output && <p className="tiny muted">White-out / cover boxes are not secure redaction.</p>}
          {showHint && (
            <Notice kind="info" onDismiss={() => setShowHint(false)}>
              <span className="small">To change existing text: cover it with a white box and add a new text box.</span>
            </Notice>
          )}
          <p className="tiny muted">{objects.length} object{objects.length === 1 ? '' : 's'} added in total.</p>
          <details className="tiny muted">
            <summary>Font licences</summary>
            <p>Bundled fonts are licensed under the SIL Open Font License 1.1:</p>
            <ul>{licenceLinks().map((l) => <li key={l.label}><a href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a></li>)}</ul>
          </details>
        </aside>
      </div>

      {sigOpen && (
        <SignatureModal
          onClose={() => setSigOpen(false)}
          onDone={(img) => {
            setSigOpen(false);
            placeImage(img, true);
          }}
        />
      )}
    </div>
  );
}

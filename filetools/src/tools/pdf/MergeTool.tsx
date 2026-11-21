import { useState } from 'react';
import { DownloadButton, Segmented, ToolHeader, useObjectUrl } from '../../components/common';
import { DropZone } from '../../components/DropZone';
import { errorMessage, Notice, ProgressBar } from '../../components/Feedback';
import { SortableList } from '../../components/SortableList';
import { uid } from '../../lib/array';
import { pdfBlob, type OutputFile } from '../../lib/download';
import { formatBytes } from '../../lib/format';
import { getPageCount, mergeInputs, PdfUserError, type MergeInput, type PageSizeName } from '../../lib/pdf/ops';
import { isImageFile, isPdfFile, prepareImageForPdf, readBytes } from '../../lib/pdf/prepareImage';

interface Item {
  id: string;
  file: File;
  kind: 'pdf' | 'image';
  pages?: number;
  error?: string;
}

function Thumb({ item }: { item: Item }) {
  const url = useObjectUrl(item.kind === 'image' ? item.file : null);
  return <span className="thumb">{url ? <img src={url} alt="" /> : '📄'}</span>;
}

export default function MergeTool() {
  const [items, setItems] = useState<Item[]>([]);
  const [pageSize, setPageSize] = useState<PageSizeName>('A4');
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<OutputFile | null>(null);

  const add = async (files: File[]) => {
    setOutput(null);
    const fresh: Item[] = files.map((file) => ({ id: uid('m'), file, kind: isPdfFile(file) ? 'pdf' : 'image' }));
    setItems((l) => [...l, ...fresh]);
    for (const it of fresh) {
      if (it.kind !== 'pdf') continue;
      try {
        const pages = await getPageCount(await readBytes(it.file));
        setItems((l) => l.map((x) => (x.id === it.id ? { ...x, pages } : x)));
      } catch (e) {
        setItems((l) => l.map((x) => (x.id === it.id ? { ...x, error: errorMessage(e) } : x)));
      }
    }
  };

  const merge = async () => {
    setError(null);
    setOutput(null);
    setBusy(0);
    try {
      const inputs: MergeInput[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        setBusy(i / (items.length + 1));
        if (it.kind === 'pdf') inputs.push({ kind: 'pdf', bytes: await readBytes(it.file), name: it.file.name });
        else {
          try {
            inputs.push({ kind: 'image', image: await prepareImageForPdf(it.file), name: it.file.name });
          } catch (e) {
            throw new PdfUserError('other', `${it.file.name}: ${errorMessage(e)}`);
          }
        }
      }
      setBusy(items.length / (items.length + 1));
      const bytes = await mergeInputs(inputs, { pageSize, orientation: 'auto', marginPt: pageSize === 'fit' ? 0 : 24 });
      setOutput({ name: 'merged.pdf', blob: pdfBlob(bytes) });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const bad = items.filter((i) => i.error);
  const totalPages = items.reduce((s, i) => s + (i.kind === 'pdf' ? i.pages ?? 0 : 1), 0);

  return (
    <>
      <ToolHeader emoji="📚" title="Merge PDFs">
        Combine PDFs and images into a single PDF, in the order you choose.
      </ToolHeader>
      <div className="stack" style={{ maxWidth: 820 }}>
        <DropZone
          accept="application/pdf,.pdf,image/*"
          filter={(f) => isPdfFile(f) || isImageFile(f)}
          onFiles={add}
          paste
          hint="PDFs and images (each image becomes a page)"
        />
        {items.length > 0 && (
          <div className="card stack">
            <div className="row">
              <h2 className="grow" style={{ margin: 0 }}>
                {items.length} file{items.length > 1 ? 's' : ''} · {totalPages} page{totalPages === 1 ? '' : 's'}
              </h2>
              <button type="button" className="btn small" onClick={() => { setItems([]); setOutput(null); }}>
                Clear
              </button>
            </div>
            <p className="small muted">Drag to reorder, or use the arrows.</p>
            <SortableList
              label="Files to merge"
              items={items}
              onChange={(l) => { setItems(l); setOutput(null); }}
              onRemove={(it) => { setItems((l) => l.filter((x) => x.id !== it.id)); setOutput(null); }}
              render={(it) => (
                <>
                  <Thumb item={it} />
                  <div className="grow">
                    <div className="name">{it.file.name}</div>
                    <div className="small muted">
                      {formatBytes(it.file.size)} · {it.kind === 'pdf' ? (it.pages !== undefined ? `${it.pages} page${it.pages === 1 ? '' : 's'}` : it.error ? '' : 'reading…') : 'image → 1 page'}
                    </div>
                    {it.error && <div className="small danger-text">{it.error}</div>}
                  </div>
                </>
              )}
            />
            {items.some((i) => i.kind === 'image') && (
              <div className="field">
                <span>Page size for images</span>
                <Segmented label="Page size for images" value={pageSize} onChange={setPageSize} options={[{ value: 'A4', label: 'A4' }, { value: 'Letter', label: 'Letter' }, { value: 'fit', label: 'Fit image' }]} />
              </div>
            )}
            <p className="tiny muted">Pages are copied as-is. Form fields, bookmarks and the original documents’ metadata aren’t carried over into the merged file.</p>
            {busy !== null && <ProgressBar value={busy} label="Merging" />}
            {error && <Notice kind="error">{error}</Notice>}
            {bad.length > 0 && <Notice kind="warn">Remove the files with errors before merging.</Notice>}
            <div className="row">
              <button type="button" className="btn primary" disabled={busy !== null || items.length === 0 || bad.length > 0} onClick={merge}>
                {busy !== null ? 'Merging…' : 'Merge into one PDF'}
              </button>
              {output && <DownloadButton files={[output]} label={`Download merged.pdf (${formatBytes(output.blob.size)})`} />}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

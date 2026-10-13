import { useEffect, useState } from 'react';
import { DownloadButton, Segmented, ToolHeader } from '../../components/common';
import { errorMessage, Notice, ProgressBar } from '../../components/Feedback';
import { moveItem, uid } from '../../lib/array';
import { pdfBlob, type OutputFile } from '../../lib/download';
import { baseName, formatBytes } from '../../lib/format';
import { buildFromPlan, PAGE_SIZES, type PlanItem } from '../../lib/pdf/ops';
import { describePages, parsePageRanges, planSplitEvery, splitFileNames } from '../../lib/pageRanges';
import { PageThumb, PdfFileBar, PdfPickerView, usePdfPicker } from './shared';

interface Tile {
  id: string;
  /** 0-based source page, or null for an inserted blank page. */
  src: number | null;
  /** Extra clockwise rotation. */
  rotate: number;
  selected: boolean;
  /** Unrotated size, for blank pages. */
  size?: [number, number];
}

type SplitMode = 'every' | 'ranges';

export default function OrganizeTool() {
  const picker = usePdfPicker({ requireWritable: true });
  const { pdf } = picker;
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<OutputFile[]>([]);
  const [splitMode, setSplitMode] = useState<SplitMode>('every');
  const [everyN, setEveryN] = useState('1');
  const [ranges, setRanges] = useState('');
  const [sizes, setSizes] = useState<[number, number][]>([]);

  useEffect(() => {
    if (!pdf) return;
    setTiles(Array.from({ length: pdf.doc.numPages }, (_, i) => ({ id: uid('p'), src: i, rotate: 0, selected: false })));
    setOutputs([]);
    setError(null);
    let alive = true;
    (async () => {
      const s: [number, number][] = [];
      for (let i = 1; i <= pdf.doc.numPages; i++) {
        const p = await pdf.doc.getPage(i);
        s.push([p.view[2] - p.view[0], p.view[3] - p.view[1]]);
      }
      if (alive) setSizes(s);
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [pdf]);

  const change = (next: Tile[]) => {
    setTiles(next);
    setOutputs([]);
  };
  const patch = (id: string, p: Partial<Tile>) => change(tiles.map((t) => (t.id === id ? { ...t, ...p } : t)));
  const selected = tiles.filter((t) => t.selected);
  const base = pdf ? baseName(pdf.file.name) : 'document';

  const blankAfter = (index: number) => {
    const ref = tiles[index];
    const size: [number, number] = ref?.src != null && sizes[ref.src] ? sizes[ref.src] : PAGE_SIZES.A4;
    const next = tiles.slice();
    next.splice(index + 1, 0, { id: uid('b'), src: null, rotate: 0, selected: false, size });
    change(next);
  };

  const toPlan = (list: Tile[]): PlanItem[] =>
    list.map((t) => (t.src === null ? { kind: 'blank', width: t.size![0], height: t.size![1], rotate: t.rotate } : { kind: 'page', index: t.src, rotate: t.rotate }));

  const exec = async (fn: () => Promise<OutputFile[]>) => {
    setError(null);
    setOutputs([]);
    setBusy(0);
    try {
      setOutputs(await fn());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const saveAll = () => exec(async () => [{ name: `${base}_organized.pdf`, blob: pdfBlob(await buildFromPlan(pdf!.bytes, toPlan(tiles))) }]);
  const extract = () => exec(async () => [{ name: `${base}_extract.pdf`, blob: pdfBlob(await buildFromPlan(pdf!.bytes, toPlan(selected))) }]);
  const split = () =>
    exec(async () => {
      let groups: number[][];
      if (splitMode === 'every') {
        const n = Number(everyN);
        if (!Number.isInteger(n) || n < 1) throw new Error('Pages per file must be a whole number of at least 1.');
        groups = planSplitEvery(tiles.length, n);
      } else {
        const r = parsePageRanges(ranges, tiles.length);
        if (!r.ok) throw new Error(r.error);
        groups = r.ranges;
      }
      const names = splitFileNames(base, groups);
      const out: OutputFile[] = [];
      for (let i = 0; i < groups.length; i++) {
        setBusy(i / groups.length);
        out.push({ name: names[i], blob: pdfBlob(await buildFromPlan(pdf!.bytes, toPlan(groups[i].map((g) => tiles[g])))) });
      }
      return out;
    });

  const splitPreview = (() => {
    if (!tiles.length) return '';
    if (splitMode === 'every') {
      const n = Number(everyN);
      if (!Number.isInteger(n) || n < 1) return 'Enter a whole number.';
      const g = planSplitEvery(tiles.length, n);
      return `${g.length} file${g.length === 1 ? '' : 's'}: ${g.slice(0, 6).map(describePages).join(' | ')}${g.length > 6 ? ' | …' : ''}`;
    }
    if (!ranges.trim()) return 'e.g. 1-3,5,8-10 → one file per range';
    const r = parsePageRanges(ranges, tiles.length);
    return r.ok ? `${r.ranges.length} file${r.ranges.length === 1 ? '' : 's'}` : r.error;
  })();

  if (!pdf) {
    return (
      <>
        <ToolHeader emoji="🗂️" title="Organize & split PDF">
          Reorder, rotate, delete, duplicate and insert pages — then save, extract selected pages, or split into several files.
        </ToolHeader>
        <div style={{ maxWidth: 720 }}>
          <PdfPickerView picker={picker} />
        </div>
      </>
    );
  }

  return (
    <>
      <ToolHeader emoji="🗂️" title="Organize & split PDF" />
      <div className="tool-layout">
        <div className="stack">
          <PdfFileBar pdf={pdf} onClose={picker.reset} />
          <div className="row">
            <button type="button" className="btn small" onClick={() => change(tiles.map((t) => ({ ...t, selected: true })))}>Select all</button>
            <button type="button" className="btn small" onClick={() => change(tiles.map((t) => ({ ...t, selected: false })))} disabled={!selected.length}>Select none</button>
            <span className="small muted">{selected.length} selected</span>
            <span className="spacer" />
            <button type="button" className="btn small" disabled={!selected.length} onClick={() => change(tiles.map((t) => (t.selected ? { ...t, rotate: (t.rotate + 270) % 360 } : t)))}>⟲ Rotate</button>
            <button type="button" className="btn small" disabled={!selected.length} onClick={() => change(tiles.map((t) => (t.selected ? { ...t, rotate: (t.rotate + 90) % 360 } : t)))}>⟳ Rotate</button>
            <button type="button" className="btn small danger" disabled={!selected.length || selected.length === tiles.length} onClick={() => change(tiles.filter((t) => !t.selected))}>🗑 Delete</button>
          </div>
          <p className="small muted">Drag pages to reorder (or use ◀ ▶). Click a thumbnail to select it.</p>
          <div className="page-grid" role="list" aria-label="Pages">
            {tiles.map((t, i) => (
              <div
                key={t.id}
                role="listitem"
                className={`page-tile${t.selected ? ' selected' : ''}${dragIndex === i ? ' dragging' : ''}${overIndex === i && dragIndex !== i ? ' drop-target' : ''}`}
                draggable
                onDragStart={(e) => { setDragIndex(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.id); }}
                onDragOver={(e) => { if (dragIndex !== null) { e.preventDefault(); setOverIndex(i); } }}
                onDrop={(e) => { e.preventDefault(); if (dragIndex !== null && dragIndex !== i) change(moveItem(tiles, dragIndex, i)); setDragIndex(null); setOverIndex(null); }}
                onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
              >
                <input type="checkbox" className="sel" checked={t.selected} onChange={(e) => patch(t.id, { selected: e.target.checked })} aria-label={`Select page ${i + 1}`} />
                <div className="thumb-box" onClick={() => patch(t.id, { selected: !t.selected })}>
                  {t.src === null ? (
                    <div className="blank-page" style={{ transform: t.rotate ? `rotate(${t.rotate}deg)` : undefined }}>blank</div>
                  ) : (
                    <PageThumb doc={pdf.doc} pageNumber={t.src + 1} extraRotation={t.rotate} />
                  )}
                </div>
                <div className="page-no">
                  {i + 1}
                  {t.src === null ? ' · blank' : t.src !== i ? ` · was ${t.src + 1}` : ''}
                  {t.rotate ? ` · ${t.rotate}°` : ''}
                </div>
                <div className="tile-actions">
                  <button type="button" className="btn ghost small icon" disabled={i === 0} onClick={() => change(moveItem(tiles, i, i - 1))} aria-label={`Move page ${i + 1} earlier`} title="Move earlier">◀</button>
                  <button type="button" className="btn ghost small icon" onClick={() => patch(t.id, { rotate: (t.rotate + 90) % 360 })} aria-label={`Rotate page ${i + 1} clockwise`} title="Rotate">⟳</button>
                  <button
                    type="button"
                    className="btn ghost small icon"
                    onClick={() => { const n = tiles.slice(); n.splice(i + 1, 0, { ...t, id: uid('d'), selected: false }); change(n); }}
                    aria-label={`Duplicate page ${i + 1}`}
                    title="Duplicate"
                  >⧉</button>
                  <button type="button" className="btn ghost small icon" onClick={() => blankAfter(i)} aria-label={`Insert blank page after page ${i + 1}`} title="Insert blank page after">＋</button>
                  <button type="button" className="btn ghost small icon danger" disabled={tiles.length === 1} onClick={() => change(tiles.filter((x) => x.id !== t.id))} aria-label={`Delete page ${i + 1}`} title="Delete">✕</button>
                  <button type="button" className="btn ghost small icon" disabled={i === tiles.length - 1} onClick={() => change(moveItem(tiles, i, i + 1))} aria-label={`Move page ${i + 1} later`} title="Move later">▶</button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <aside className="stack">
          <div className="card stack">
            <h2 style={{ margin: 0 }}>Save</h2>
            <button type="button" className="btn primary" onClick={saveAll} disabled={busy !== null}>Save {tiles.length}-page PDF</button>
            <button type="button" className="btn" onClick={extract} disabled={busy !== null || !selected.length}>Extract {selected.length || ''} selected page{selected.length === 1 ? '' : 's'}</button>
          </div>
          <div className="card stack">
            <h2 style={{ margin: 0 }}>Split</h2>
            <Segmented label="Split mode" value={splitMode} onChange={setSplitMode} options={[{ value: 'every', label: 'Every N pages' }, { value: 'ranges', label: 'By ranges' }]} />
            {splitMode === 'every' ? (
              <label className="field">
                <span>Pages per file</span>
                <input className="input" inputMode="numeric" value={everyN} onChange={(e) => setEveryN(e.target.value.replace(/\D/g, ''))} />
              </label>
            ) : (
              <label className="field">
                <span>Page ranges (one file each)</span>
                <input className="input" placeholder="1-3,5,8-10" value={ranges} onChange={(e) => setRanges(e.target.value)} />
              </label>
            )}
            <span className="tiny muted">{splitPreview} · page numbers refer to the current order.</span>
            <button type="button" className="btn" onClick={split} disabled={busy !== null}>Split into files (ZIP)</button>
          </div>
          {busy !== null && <ProgressBar value={busy || undefined} label="Building PDF" />}
          {error && <Notice kind="error">{error}</Notice>}
          {outputs.length > 0 && (
            <div className="card stack">
              <Notice kind="success">
                Ready: {outputs.length === 1 ? outputs[0].name : `${outputs.length} files`} ({formatBytes(outputs.reduce((s, o) => s + o.blob.size, 0))})
              </Notice>
              <DownloadButton files={outputs} zipName={`${base}_split.zip`} />
            </div>
          )}
          <p className="tiny muted">The result is a fresh PDF containing only the pages you keep — deleted pages are really removed. Form fields and bookmarks aren’t carried over.</p>
        </aside>
      </div>
    </>
  );
}

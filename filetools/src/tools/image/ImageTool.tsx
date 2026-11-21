import { useEffect, useMemo, useRef, useState } from 'react';
import { CompareSlider } from '../../components/CompareSlider';
import { DownloadButton, Segmented, ToolHeader, useObjectUrl } from '../../components/common';
import { DropZone } from '../../components/DropZone';
import { errorMessage, Notice, ProgressBar } from '../../components/Feedback';
import { uid } from '../../lib/array';
import { baseName, formatBytes, percentSaved, savedLabel } from '../../lib/format';
import { FORMAT_EXT, FORMAT_LABEL, type ImageJobOptions, type ImageJobResult, type OutputFormat } from '../../lib/image/process';
import { detectEncodeSupport, processImage } from '../../lib/image/runner';
import type { ResizeMode, Rotation } from '../../lib/resize';

type Status = 'queued' | 'working' | 'done' | 'error';

interface Item {
  id: string;
  file: File;
  status: Status;
  result?: ImageJobResult;
  outName?: string;
  error?: string;
  /** Settings signature the result was produced with. */
  sig?: string;
}

type FormatChoice = 'auto' | OutputFormat;
type ResizeKind = 'none' | 'fit' | 'percent';

const ACCEPT = 'image/*,.jpg,.jpeg,.png,.webp,.gif,.bmp,.avif,.heic,.heif';
const CONCURRENCY = 2;

function autoFormat(file: File, support: Record<OutputFormat, boolean>): OutputFormat {
  const t = file.type.toLowerCase();
  if (t === 'image/png' || t === 'image/gif' || t === 'image/bmp') return 'image/png';
  if (t === 'image/webp' && support['image/webp']) return 'image/webp';
  if (t === 'image/avif' && support['image/avif']) return 'image/avif';
  if (t === 'image/webp' || t === 'image/avif') return 'image/png';
  return 'image/jpeg';
}

function ItemThumb({ file, result }: { file: File; result?: ImageJobResult }) {
  const url = useObjectUrl(result?.blob ?? file);
  const [broken, setBroken] = useState(false);
  return <span className="thumb">{url && !broken ? <img src={url} alt="" loading="lazy" onError={() => setBroken(true)} /> : '🖼️'}</span>;
}

export default function ImageTool() {
  const [items, setItems] = useState<Item[]>([]);
  const [support, setSupport] = useState<Record<OutputFormat, boolean> | null>(null);
  const [format, setFormat] = useState<FormatChoice>('auto');
  const [quality, setQuality] = useState(80);
  const [resizeKind, setResizeKind] = useState<ResizeKind>('none');
  const [maxW, setMaxW] = useState('1920');
  const [maxH, setMaxH] = useState('1920');
  const [percent, setPercent] = useState(50);
  const [rotate, setRotate] = useState<Rotation>(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [background, setBackground] = useState('#ffffff');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const cancelRef = useRef(false);

  useEffect(() => {
    detectEncodeSupport().then(setSupport);
    return () => {
      cancelRef.current = true;
    };
  }, []);

  const resize: ResizeMode = useMemo(() => {
    if (resizeKind === 'fit') return { kind: 'fit', maxWidth: Number(maxW) || undefined, maxHeight: Number(maxH) || undefined };
    if (resizeKind === 'percent') return { kind: 'percent', percent };
    return { kind: 'none' };
  }, [resizeKind, maxW, maxH, percent]);

  const sig = JSON.stringify({ format, quality, resize, rotate, flipH, flipV, background });

  const optionsFor = (file: File): ImageJobOptions => {
    const fmt = format === 'auto' ? autoFormat(file, support ?? { 'image/jpeg': true, 'image/png': true, 'image/webp': false, 'image/avif': false }) : format;
    return { format: fmt, quality: quality / 100, resize, rotate, flipH, flipV, background: fmt === 'image/jpeg' ? background : 'transparent' };
  };

  const update = (id: string, patch: Partial<Item>) => setItems((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const run = async (targets: Item[]) => {
    if (targets.length === 0) return;
    setRunning(true);
    cancelRef.current = false;
    const queue = [...targets];
    const currentSig = sig;
    const worker = async () => {
      while (queue.length && !cancelRef.current) {
        const it = queue.shift()!;
        update(it.id, { status: 'working', error: undefined });
        try {
          const opts = optionsFor(it.file);
          const result = await processImage(it.file, opts);
          update(it.id, { status: 'done', result, outName: `${baseName(it.file.name)}.${FORMAT_EXT[opts.format]}`, sig: currentSig });
        } catch (e) {
          update(it.id, { status: 'error', error: errorMessage(e), result: undefined });
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setRunning(false);
  };

  const addFiles = (files: File[]) => {
    const fresh = files.map((file) => ({ id: uid('img'), file, status: 'queued' as Status }));
    setItems((list) => [...list, ...fresh]);
    if (!selectedId && fresh[0]) setSelectedId(fresh[0].id);
  };

  const done = items.filter((i) => i.status === 'done' && i.result);
  const stale = done.some((i) => i.sig !== sig);
  const pending = items.filter((i) => i.status === 'queued' || i.status === 'error');
  const totalBefore = done.reduce((s, i) => s + i.file.size, 0);
  const totalAfter = done.reduce((s, i) => s + (i.result?.blob.size ?? 0), 0);
  const progress = items.length ? items.filter((i) => i.status === 'done' || i.status === 'error').length / items.length : 0;
  const selected = items.find((i) => i.id === selectedId) ?? null;
  const beforeUrl = useObjectUrl(selected?.file);
  const afterUrl = useObjectUrl(selected?.result?.blob);
  const anyGif = items.some((i) => /gif$/i.test(i.file.type) || /\.gif$/i.test(i.file.name));
  const lossy = format !== 'image/png';

  const formatOptions: { value: FormatChoice; label: string; disabled?: boolean }[] = [
    { value: 'auto', label: 'Same as input' },
    { value: 'image/jpeg', label: 'JPEG' },
    { value: 'image/png', label: 'PNG' },
    { value: 'image/webp', label: 'WebP', disabled: support ? !support['image/webp'] : false },
  ];
  if (support?.['image/avif']) formatOptions.push({ value: 'image/avif', label: 'AVIF' });

  return (
    <>
      <ToolHeader emoji="🖼️" title="Compress & convert images">
        Shrink photos, convert formats, resize, rotate or flip — in batches.
      </ToolHeader>
      <div className="tool-layout">
        <div className="stack">
          <DropZone accept={ACCEPT} onFiles={addFiles} paste hint="JPEG, PNG, WebP, GIF (first frame), BMP, AVIF; HEIC where your browser supports it" />
          {items.length > 0 && (
            <div className="card stack">
              <div className="row">
                <h2 className="grow" style={{ margin: 0 }}>
                  {items.length} image{items.length > 1 ? 's' : ''}
                </h2>
                <button type="button" className="btn small" onClick={() => { cancelRef.current = true; setItems([]); setSelectedId(null); }}>
                  Clear all
                </button>
              </div>
              {running && <ProgressBar value={progress} label="Processing images" />}
              <ul className="file-list" aria-label="Images">
                {items.map((it) => {
                  const r = it.result;
                  const grew = r && r.blob.size > it.file.size;
                  return (
                    <li key={it.id} className={`file-item${it.id === selectedId ? ' selected' : ''}`}>
                      <ItemThumb file={it.file} result={r} />
                      <button type="button" className="grow btn ghost" style={{ justifyContent: 'flex-start', textAlign: 'left', padding: 0, minHeight: 0, whiteSpace: 'normal', display: 'block' }} onClick={() => setSelectedId(it.id)} aria-label={`Preview ${it.file.name}`}>
                        <div className="name">{it.file.name}</div>
                        <div className="small muted">
                          {formatBytes(it.file.size)}
                          {r && (
                            <>
                              {' → '}
                              <b className={grew ? 'warn-text' : 'ok-text'}>{formatBytes(r.blob.size)}</b> ({savedLabel(it.file.size, r.blob.size)}) · {r.width}×{r.height}
                              {r.srcWidth !== r.width || r.srcHeight !== r.height ? ` (was ${r.srcWidth}×${r.srcHeight})` : ''}
                            </>
                          )}
                          {it.status === 'working' && ' · processing…'}
                          {it.status === 'queued' && ' · ready'}
                        </div>
                        {it.error && <div className="small danger-text">{it.error}</div>}
                        {grew && <div className="small warn-text">Larger than the original — try a lower quality or a different format.</div>}
                        {r?.clamped && <div className="small warn-text">Scaled down to fit this browser’s maximum canvas size.</div>}
                      </button>
                      {r && it.outName && <DownloadButton files={[{ name: it.outName, blob: r.blob }]} label="Save" primary={false} small />}
                      <button type="button" className="btn ghost small icon danger" aria-label={`Remove ${it.file.name}`} onClick={() => setItems((l) => l.filter((x) => x.id !== it.id))}>
                        ✕
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {selected && beforeUrl && (
            <div className="card stack">
              <h2 style={{ margin: 0 }}>Preview: {selected.file.name}</h2>
              {afterUrl ? (
                <CompareSlider before={beforeUrl} after={afterUrl} beforeLabel={`Original · ${formatBytes(selected.file.size)}`} afterLabel={`Result · ${formatBytes(selected.result!.blob.size)}`} />
              ) : (
                <p className="muted small">Run the conversion to compare before and after.</p>
              )}
              <p className="tiny muted">The comparison stretches both images to the same box, so rotated or resized results line up only roughly.</p>
            </div>
          )}
        </div>

        <aside className="card stack">
          <h2 style={{ margin: 0 }}>Settings</h2>
          <div className="field">
            <span>Output format</span>
            <Segmented label="Output format" value={format} onChange={setFormat} options={formatOptions} />
            {support && !support['image/webp'] && <span className="tiny muted">This browser can’t encode WebP.</span>}
            {support && !support['image/avif'] && <span className="tiny muted">AVIF output isn’t supported by this browser.</span>}
          </div>
          <label className="field">
            <span>
              Quality: {quality}% {lossy ? '' : '(PNG is lossless — quality not used)'}
            </span>
            <input type="range" min={10} max={100} value={quality} onChange={(e) => setQuality(Number(e.target.value))} disabled={!lossy} />
          </label>
          <div className="field">
            <span>Resize</span>
            <Segmented
              label="Resize mode"
              value={resizeKind}
              onChange={setResizeKind}
              options={[
                { value: 'none', label: 'Original' },
                { value: 'fit', label: 'Max size' },
                { value: 'percent', label: 'Percent' },
              ]}
            />
          </div>
          {resizeKind === 'fit' && (
            <div className="grid-2">
              <label className="field">
                <span>Max width (px)</span>
                <input className="input" inputMode="numeric" value={maxW} onChange={(e) => setMaxW(e.target.value.replace(/\D/g, ''))} />
              </label>
              <label className="field">
                <span>Max height (px)</span>
                <input className="input" inputMode="numeric" value={maxH} onChange={(e) => setMaxH(e.target.value.replace(/\D/g, ''))} />
              </label>
              <span className="tiny muted" style={{ gridColumn: '1 / -1' }}>Keeps aspect ratio. Smaller images are not enlarged.</span>
            </div>
          )}
          {resizeKind === 'percent' && (
            <label className="field">
              <span>Scale: {percent}%</span>
              <input type="range" min={5} max={200} step={5} value={percent} onChange={(e) => setPercent(Number(e.target.value))} />
            </label>
          )}
          <div className="field">
            <span>Rotate & flip</span>
            <div className="row">
              <Segmented label="Rotate" value={rotate} onChange={setRotate} options={[0, 90, 180, 270].map((r) => ({ value: r as Rotation, label: `${r}°` }))} />
            </div>
            <div className="row">
              <label className="check"><input type="checkbox" checked={flipH} onChange={(e) => setFlipH(e.target.checked)} /> Flip horizontal</label>
              <label className="check"><input type="checkbox" checked={flipV} onChange={(e) => setFlipV(e.target.checked)} /> Flip vertical</label>
            </div>
          </div>
          {(format === 'image/jpeg' || format === 'auto') && (
            <label className="field">
              <span>Background for transparent areas (JPEG)</span>
              <input type="color" className="input" value={background} onChange={(e) => setBackground(e.target.value)} />
            </label>
          )}
          <Notice kind="info">
            <span className="small">
              EXIF metadata (camera, date, GPS location) is removed from every output; the photo’s orientation is applied to the pixels first.
              {anyGif && ' GIFs keep only their first frame (animation is lost).'}
            </span>
          </Notice>
          <div className="stack-sm">
            <button type="button" className="btn primary" disabled={running || items.length === 0 || (pending.length === 0 && !stale)} onClick={() => run(stale ? items : pending)}>
              {running ? 'Working…' : stale ? `Re-run with new settings (${items.length})` : `Convert ${pending.length || ''} image${pending.length === 1 ? '' : 's'}`}
            </button>
            {running && (
              <button type="button" className="btn" onClick={() => (cancelRef.current = true)}>
                Stop
              </button>
            )}
            {stale && !running && <span className="tiny warn-text">Settings changed since the last run.</span>}
          </div>
          {done.length > 0 && (
            <div className="stack-sm">
              <div className="stats">
                <div className="stat"><span className="tiny muted">Before</span><b>{formatBytes(totalBefore)}</b></div>
                <div className="stat"><span className="tiny muted">After</span><b>{formatBytes(totalAfter)}</b></div>
                <div className="stat"><span className="tiny muted">Saved</span><b className={totalAfter > totalBefore ? 'warn-text' : 'ok-text'}>{percentSaved(totalBefore, totalAfter)}%</b></div>
              </div>
              <DownloadButton files={done.map((i) => ({ name: i.outName!, blob: i.result!.blob }))} zipName="images.zip" />
            </div>
          )}
          <p className="tiny muted">Output formats your browser can encode: {support ? (Object.keys(support) as OutputFormat[]).filter((f) => support[f]).map((f) => FORMAT_LABEL[f]).join(', ') : '…'}</p>
        </aside>
      </div>
    </>
  );
}

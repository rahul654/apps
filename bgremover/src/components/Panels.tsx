import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { COLOR_PRESETS, parseColor, toHex } from '../lib/color';
import { FORMAT_INFO, formatBytes, outputName, type ExportFormat } from '../lib/format';
import { DEFAULT_REFINE } from '../lib/mask';
import type { BackgroundKind } from '../lib/prefs';
import type { QueueItem } from '../lib/queue';
import { canEncodeWebp, canvasToBlob, composeExport, decodeImage, downloadBlob } from '../lib/render';
import { useApp } from '../store/AppStore';
import { IconAlert, IconDownload, IconImage, IconZip } from './Icons';

function Range({ label, value, min, max, step = 1, onChange, format, disabled }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format: (v: number) => string; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="range-row">
      <label htmlFor={id}>{label}</label>
      <output htmlFor={id} className="mono tiny">
        {format(value)}
      </output>
      <input id={id} type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} aria-valuetext={format(value)} />
    </div>
  );
}

function Panel({ title, children, id }: { title: string; children: ReactNode; id: string }) {
  return (
    <section className="card stack-sm panel" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function RefinePanel({ item }: { item: QueueItem }) {
  const { dispatch } = useApp();
  const r = item.refine;
  const disabled = item.status !== 'done';
  const changed = r.threshold !== DEFAULT_REFINE.threshold || r.softness !== DEFAULT_REFINE.softness;
  return (
    <Panel title="Refine edges" id="refine-h">
      <Range label="Threshold" value={r.threshold} min={0.05} max={0.95} step={0.01} format={pct} disabled={disabled} onChange={(threshold) => dispatch({ type: 'refine', id: item.id, refine: { ...r, threshold } })} />
      <Range label="Softness" value={r.softness} min={0} max={1} step={0.01} format={(v) => (v === 0 ? 'Hard' : pct(v))} disabled={disabled} onChange={(softness) => dispatch({ type: 'refine', id: item.id, refine: { ...r, softness } })} />
      <p className="tiny muted">Raise the threshold to drop faint background, lower it to keep more. Less softness gives crisper, harder edges.</p>
      {changed && (
        <button type="button" className="btn small self-start" onClick={() => dispatch({ type: 'refine', id: item.id, refine: { ...DEFAULT_REFINE } })}>
          Reset to model’s edges
        </button>
      )}
    </Panel>
  );
}

const BG_OPTIONS: { id: BackgroundKind; label: string }[] = [
  { id: 'transparent', label: 'None' },
  { id: 'color', label: 'Colour' },
  { id: 'blur', label: 'Blur' },
  { id: 'image', label: 'Image' },
];

export function BackgroundPanel() {
  const { prefs, setPrefs, bgImage, setBgImage } = useApp();
  const [hexText, setHexText] = useState(prefs.color);
  const [bgError, setBgError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => setHexText(prefs.color), [prefs.color]);
  const hexValid = parseColor(hexText) !== null;

  return (
    <Panel title="Background" id="bg-h">
      <div className="segmented full" role="group" aria-label="Background type">
        {BG_OPTIONS.map((o) => (
          <button key={o.id} type="button" aria-pressed={prefs.background === o.id} onClick={() => setPrefs({ background: o.id })}>
            {o.label}
          </button>
        ))}
      </div>

      {prefs.background === 'transparent' && <p className="tiny muted">Transparent. PNG and WebP keep it; JPEG gets a white background.</p>}

      {prefs.background === 'color' && (
        <div className="stack-sm">
          <div className="swatches" role="group" aria-label="Preset colours">
            {COLOR_PRESETS.map((c) => (
              <button key={c.hex} type="button" className="swatch" style={{ background: c.hex }} aria-label={c.name} aria-pressed={prefs.color === c.hex} title={c.name} onClick={() => setPrefs({ color: c.hex })} />
            ))}
          </div>
          <div className="row">
            <label className="color-pick">
              <span className="sr-only">Pick a colour</span>
              <input type="color" value={prefs.color} onChange={(e) => setPrefs({ color: e.target.value })} />
            </label>
            <label className="field grow">
              <span className="sr-only">Colour code</span>
              <input
                className={`input mono${hexValid ? '' : ' invalid'}`}
                value={hexText}
                spellCheck={false}
                aria-invalid={!hexValid}
                aria-describedby={hexValid ? undefined : 'hex-err'}
                onChange={(e) => {
                  setHexText(e.target.value);
                  const c = parseColor(e.target.value);
                  if (c) setPrefs({ color: toHex(c) });
                }}
              />
            </label>
          </div>
          {!hexValid && (
            <span id="hex-err" className="field-error">
              Use #rgb, #rrggbb or rgb(r, g, b)
            </span>
          )}
        </div>
      )}

      {prefs.background === 'blur' && <Range label="Blur strength" value={prefs.blur} min={0.2} max={8} step={0.1} format={(v) => v.toFixed(1)} onChange={(blur) => setPrefs({ blur })} />}

      {prefs.background === 'image' && (
        <div className="stack-sm">
          {bgImage ? (
            <div className="row">
              <img src={bgImage.url} alt="" className="bg-thumb" />
              <span className="grow clip small" title={bgImage.name}>
                {bgImage.name}
              </span>
              <button type="button" className="btn small" onClick={() => fileRef.current?.click()}>
                Change
              </button>
            </div>
          ) : (
            <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
              <IconImage size={16} /> Choose background image
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              setBgError(null);
              setBgImage(f).catch(() => setBgError('That image couldn’t be opened.'));
            }}
          />
          <p className="tiny muted">Scaled to fill the frame. Stays on this device and is forgotten when you close the tab.</p>
          {bgError && <p className="field-error">{bgError}</p>}
        </div>
      )}

      <label className="check">
        <input type="checkbox" checked={prefs.shadow} onChange={(e) => setPrefs({ shadow: e.target.checked })} />
        <span>Drop shadow</span>
      </label>
      {prefs.shadow && (
        <div className="stack-sm indent">
          <Range label="Opacity" value={prefs.shadowOpacity} min={0.05} max={1} step={0.05} format={pct} onChange={(shadowOpacity) => setPrefs({ shadowOpacity })} />
          <Range label="Softness" value={prefs.shadowBlur} min={0} max={10} step={0.1} format={(v) => v.toFixed(1)} onChange={(shadowBlur) => setPrefs({ shadowBlur })} />
          <Range label="Offset" value={prefs.shadowOffset} min={-10} max={10} step={0.1} format={(v) => v.toFixed(1)} onChange={(shadowOffset) => setPrefs({ shadowOffset })} />
        </div>
      )}
    </Panel>
  );
}

const nextFrame = () => new Promise((r) => setTimeout(r, 0));

export function ExportPanel({ item }: { item: QueueItem | null }) {
  const app = useApp();
  const { prefs, setPrefs, queue, bgImage } = app;
  const [webp, setWebp] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    canEncodeWebp().then(setWebp);
  }, []);
  const done = queue.items.filter((i) => i.status === 'done');
  const formats: ExportFormat[] = webp ? ['png', 'webp', 'jpeg'] : ['png', 'jpeg'];
  const format = formats.includes(prefs.format) ? prefs.format : 'png';
  const needsBgImage = prefs.background === 'image' && !bgImage;

  const render = async (it: QueueItem): Promise<Blob> => {
    const d = app.data(it.id);
    if (!d?.mask) throw new Error(`${it.name} has no result yet`);
    const bitmap = await decodeImage(d.file);
    try {
      const canvas = composeExport({ bitmap, raw: d.mask, edits: d.edits, refine: it.refine, prefs: { ...prefs, format }, bgImage: bgImage?.bitmap ?? null }, format);
      const blob = await canvasToBlob(canvas, format, prefs.quality);
      canvas.width = canvas.height = 0;
      return blob;
    } finally {
      bitmap.close();
    }
  };

  const downloadOne = async () => {
    if (!item) return;
    setError(null);
    setBusy('Preparing download…');
    try {
      downloadBlob(await render(item), outputName(item.name, format));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const downloadAll = async () => {
    setError(null);
    try {
      const { makeZip } = await import('../lib/zip');
      const taken = new Set<string>();
      const entries: { name: string; data: Uint8Array }[] = [];
      for (let i = 0; i < done.length; i++) {
        setBusy(`Preparing ${i + 1} of ${done.length}…`);
        await nextFrame();
        const blob = await render(done[i]);
        entries.push({ name: outputName(done[i].name, format, taken), data: new Uint8Array(await blob.arrayBuffer()) });
      }
      setBusy('Zipping…');
      await nextFrame();
      const zip = makeZip(entries);
      downloadBlob(new Blob([zip as BlobPart], { type: 'application/zip' }), 'backgrounds-removed.zip');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel title="Export" id="export-h">
      <div className="segmented full" role="group" aria-label="File format">
        {formats.map((f) => (
          <button key={f} type="button" aria-pressed={format === f} onClick={() => setPrefs({ format: f })}>
            {FORMAT_INFO[f].label}
          </button>
        ))}
      </div>
      {format !== 'png' && <Range label="Quality" value={prefs.quality} min={0.5} max={1} step={0.01} format={pct} onChange={(quality) => setPrefs({ quality })} />}
      {format === 'jpeg' && prefs.background === 'transparent' && <p className="tiny muted">JPEG has no transparency, so the background will be white.</p>}
      <label className="check">
        <input type="checkbox" checked={prefs.crop} onChange={(e) => setPrefs({ crop: e.target.checked })} />
        <span>Crop to subject</span>
      </label>
      {prefs.crop && (
        <div className="indent">
          <Range label="Padding" value={prefs.padding} min={0} max={50} step={1} format={(v) => `${v}%`} onChange={(padding) => setPrefs({ padding })} />
        </div>
      )}
      <p className="tiny muted">Exported at the original resolution{prefs.crop ? ' (cropped)' : ''}.</p>
      {needsBgImage && (
        <p className="note warn small">
          <IconAlert size={16} />
          <span>Choose a background image first, or the background will be transparent.</span>
        </p>
      )}
      <div className="stack-sm">
        <button type="button" className="btn primary" onClick={downloadOne} disabled={!item || item.status !== 'done' || Boolean(busy)}>
          <IconDownload size={16} /> Download {FORMAT_INFO[format].label}
        </button>
        <button type="button" className="btn" onClick={downloadAll} disabled={done.length < 2 || Boolean(busy)}>
          <IconZip size={16} /> Download all ({done.length}) as .zip
        </button>
      </div>
      {busy && (
        <p className="small row tight" role="status">
          <span className="spinner" aria-hidden="true" /> {busy}
        </p>
      )}
      {error && (
        <p className="note warn small" role="alert">
          <IconAlert size={16} />
          <span>{error}</span>
        </p>
      )}
      {item?.status === 'done' && item.width && item.height && <p className="tiny muted">Output: up to {item.width} × {item.height}px · source {formatBytes(item.bytes)}</p>}
    </Panel>
  );
}

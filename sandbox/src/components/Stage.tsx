import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { clampSize, fitScale, frameSize, VIEWPORT_PRESETS } from '../lib/viewports';
import type { Viewport } from '../types';
import { IconRotate } from './Icons';

const PAD = 24;

/**
 * Hosts a frame either filling the stage or at a fixed device size, scaled down to fit.
 * The element structure is the same in every mode so switching size never remounts
 * (and so never reloads) the iframe inside.
 */
export function Stage({ viewport, children, overlay }: { viewport: Viewport; children: ReactNode; overlay?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setAvail({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const size = frameSize(viewport);
  const scale = size ? fitScale(size, { width: avail.width - PAD * 2, height: avail.height - PAD * 2 }, viewport.fit) : 1;
  return (
    <div ref={ref} className={size ? 'stage device' : 'stage fill'}>
      <div className="device-box" style={size ? { width: size.width * scale, height: size.height * scale } : undefined}>
        <div className="device-inner" style={size ? { width: size.width, height: size.height, transform: scale === 1 ? undefined : `scale(${scale})` } : undefined}>
          {children}
        </div>
      </div>
      {size && (
        <div className="stage-caption mono" aria-hidden="true">
          {size.width} × {size.height}
          {scale < 1 ? ` · ${Math.round(scale * 100)}%` : ''}
        </div>
      )}
      {overlay}
    </div>
  );
}

export function ViewportControls({ viewport, onChange }: { viewport: Viewport; onChange: (vp: Viewport) => void }) {
  const size = frameSize(viewport);
  const id = useId();
  const set = (patch: Partial<Viewport>) => onChange({ ...viewport, ...patch });
  return (
    <div className="viewport-controls">
      <label className="sr-only" htmlFor={id}>
        Viewport size
      </label>
      <select
        id={id}
        className="input compact"
        value={viewport.preset}
        onChange={(e) => {
          const preset = e.target.value;
          // Seed the custom size from whatever is showing now.
          if (preset === 'custom' && size) set({ preset, width: size.width, height: size.height, landscape: false });
          else set({ preset });
        }}
      >
        {VIEWPORT_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
            {p.width ? ` · ${p.width}×${p.height}` : ''}
          </option>
        ))}
      </select>
      {viewport.preset === 'custom' && (
        <span className="row nowrap custom-size">
          <SizeInput label="Width" value={viewport.width} onCommit={(width) => set({ width })} />
          <span className="muted" aria-hidden="true">
            ×
          </span>
          <SizeInput label="Height" value={viewport.height} onCommit={(height) => set({ height })} />
        </span>
      )}
      {size && (
        <>
          <button type="button" className="btn small icon" onClick={() => set({ landscape: !viewport.landscape })} aria-pressed={viewport.landscape} title="Rotate" aria-label="Rotate">
            <IconRotate size={16} />
          </button>
          <button type="button" className="btn small" onClick={() => set({ fit: !viewport.fit })} aria-pressed={viewport.fit} title="Scale the frame down to fit the window">
            Fit
          </button>
        </>
      )}
    </div>
  );
}

function SizeInput({ label, value, onCommit }: { label: string; value: number; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setDraft(String(value));
  }
  const commit = () => {
    const n = clampSize(Number(draft));
    setDraft(String(n));
    if (n !== value) onCommit(n);
  };
  return (
    <input
      className="input compact size-input mono"
      inputMode="numeric"
      aria-label={`${label} in pixels`}
      value={draft}
      onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}

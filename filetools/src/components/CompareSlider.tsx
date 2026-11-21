import { useState } from 'react';

/** Before/after image comparison with a draggable (and keyboard-operable) divider. */
export function CompareSlider({ before, after, beforeLabel = 'Before', afterLabel = 'After' }: { before: string; after: string; beforeLabel?: string; afterLabel?: string }) {
  const [pos, setPos] = useState(50);
  return (
    <div className="compare">
      <img src={before} alt="Original" className="before-img" />
      <div className="after" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
        <img src={after} alt="Result" />
      </div>
      <div className="divider" style={{ left: `${pos}%` }} />
      <span className="label" style={{ left: 8 }}>{beforeLabel}</span>
      <span className="label" style={{ right: 8 }}>{afterLabel}</span>
      <input type="range" min={0} max={100} step={0.5} value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label="Compare position: left shows the original, right shows the result" />
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';

/** Mic level meter, polled on animation frames while active. */
export function LevelMeter({ active, read }: { active: boolean; read: () => number }) {
  const bar = useRef<HTMLDivElement>(null);
  const [aria, setAria] = useState(0);
  useEffect(() => {
    if (!active) {
      if (bar.current) bar.current.style.transform = 'scaleX(0)';
      setAria(0);
      return;
    }
    let raf = 0;
    let last = 0;
    let smooth = 0;
    const loop = (t: number) => {
      const level = read();
      smooth += (level - smooth) * (level > smooth ? 0.6 : 0.12);
      if (bar.current) bar.current.style.transform = `scaleX(${smooth.toFixed(3)})`;
      if (t - last > 1000) {
        last = t;
        setAria(Math.round(smooth * 100));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, read]);
  return (
    <div className="meter" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={aria}>
      <div ref={bar} className="meter-fill" />
    </div>
  );
}

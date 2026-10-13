import { useEffect, useRef, useState } from 'react';
import { useController } from '../store/RecorderContext';

/** Mic level meter, polled on animation frames while visible. */
export function LevelMeter({ active, muted }: { active: boolean; muted?: boolean }) {
  const c = useController();
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
    const loop = (t: number) => {
      const level = c.readLevel();
      if (bar.current) bar.current.style.transform = `scaleX(${level.toFixed(3)})`;
      if (t - last > 1000) {
        last = t;
        setAria(Math.round(level * 100));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, c]);
  return (
    <div className={muted ? 'meter muted-meter' : 'meter'} role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={aria}>
      <div ref={bar} className="meter-fill" />
    </div>
  );
}

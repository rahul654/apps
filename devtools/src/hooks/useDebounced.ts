import { useEffect, useState } from 'react';

/** Value that follows `value` after it stops changing for `delay` ms (immediate when delay is 0). */
export function useDebounced<T>(value: T, delay: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    if (delay <= 0) {
      setV(value);
      return;
    }
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return delay <= 0 ? value : v;
}

/** Debounce delay that grows with input size, so small inputs feel instant. */
export const sizeDelay = (len: number) => (len < 20_000 ? 0 : len < 500_000 ? 120 : len < 2_000_000 ? 250 : 450);

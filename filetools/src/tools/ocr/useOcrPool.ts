import { useCallback, useEffect, useRef } from 'react';
import { OcrPool, type PageSegMode } from '../../lib/ocr/engine';
import type { OcrModel } from '../../lib/ocr/langs';

/**
 * One OCR worker pool per tool: reused while the settings stay the same, recreated when
 * they change, terminated on Cancel and when the tool is left.
 */
export function useOcrPool() {
  const pool = useRef<{ pool: OcrPool; key: string } | null>(null);
  const abort = useRef<AbortController | null>(null);

  const terminate = useCallback(async () => {
    abort.current?.abort();
    abort.current = null;
    const p = pool.current;
    pool.current = null;
    await p?.pool.terminate();
  }, []);

  useEffect(() => () => void terminate(), [terminate]);

  const get = useCallback(
    async (codes: string[], model: OcrModel, psm: PageSegMode, onStatus?: (label: string, f?: number) => void, size?: number): Promise<OcrPool> => {
      const key = JSON.stringify([codes, model, psm, size]);
      if (pool.current?.key === key) return pool.current.pool;
      await terminate();
      const ctrl = new AbortController();
      abort.current = ctrl;
      const p = await OcrPool.create({ codes, model, psm, size, onStatus, signal: ctrl.signal });
      pool.current = { pool: p, key };
      return p;
    },
    [terminate],
  );

  return { get, cancel: terminate, signal: () => abort.current?.signal };
}

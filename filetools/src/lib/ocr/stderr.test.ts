import { describe, expect, it, vi } from 'vitest';
import { isBenignTesseractMessage, workerWrapperSource } from './stderr';

describe('Tesseract stderr filter', () => {
  it('recognises the known benign lines only', () => {
    expect(isBenignTesseractMessage('Warning: Parameter not found: classify_misfit_junk_penalty')).toBe(true);
    expect(isBenignTesseractMessage('Warning: Parameter not found: merge_fragments_in_matrix')).toBe(true);
    expect(isBenignTesseractMessage('Estimating resolution as 511')).toBe(true);
    expect(isBenignTesseractMessage('Detected 12 diacritics')).toBe(true);
    expect(isBenignTesseractMessage('Error opening data file ./eng.traineddata')).toBe(false);
    expect(isBenignTesseractMessage('Failed loading language eng')).toBe(false);
  });

  it('wrapper drops benign lines, downgrades others to console.warn, then loads the worker', () => {
    const src = workerWrapperSource('worker.min.js');
    expect(src).toContain('importScripts("worker.min.js")');
    const fakeConsole = { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), log: vi.fn() };
    const importScripts = vi.fn();
    new Function('console', 'importScripts', src)(fakeConsole, importScripts);
    expect(importScripts).toHaveBeenCalledWith('worker.min.js');
    fakeConsole.error('Estimating resolution as 511');
    fakeConsole.error('Warning: Parameter not found: classify_misfit_junk_penalty');
    expect(fakeConsole.warn).not.toHaveBeenCalled();
    expect(fakeConsole.debug).toHaveBeenCalledTimes(2);
    fakeConsole.error('Error opening data file ./eng.traineddata');
    expect(fakeConsole.warn).toHaveBeenCalledWith('[tesseract]', 'Error opening data file ./eng.traineddata');
  });
});

import { describe, expect, it } from 'vitest';
import { BOUNDS, DEFAULT_LAYOUT, dragFraction, dragKvColumns, dragWidth, parseLayout } from './layout';

describe('layout prefs', () => {
  it('falls back to defaults and clamps stored values', () => {
    expect(parseLayout(undefined)).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('junk')).toEqual(DEFAULT_LAYOUT);
    const p = parseLayout({ sidebar: 5000, orientation: 'side', requestStacked: -1, requestSide: 0.7, kvKey: NaN, kvDesc: 99, envList: 300.4 });
    expect(p).toEqual({ sidebar: BOUNDS.sidebar.max, orientation: 'side', requestStacked: BOUNDS.request.min, requestSide: 0.7, kvKey: BOUNDS.kvKey.def, kvDesc: BOUNDS.kvDesc.max, envList: 300 });
    expect(parseLayout({ orientation: 'diagonal' }).orientation).toBe('stacked');
  });

  it('drags a side column within bounds and leaves room for the editor', () => {
    expect(dragWidth(290, 50, BOUNDS.sidebar, 1600)).toBe(340);
    expect(dragWidth(290, -500, BOUNDS.sidebar, 1600)).toBe(BOUNDS.sidebar.min);
    expect(dragWidth(290, 2000, BOUNDS.sidebar, 1600)).toBe(BOUNDS.sidebar.max);
    expect(dragWidth(290, 400, BOUNDS.sidebar, 900)).toBe(900 - 360);
    expect(dragWidth(290, 400, BOUNDS.sidebar, 300)).toBe(BOUNDS.sidebar.min);
  });

  it('drags a split as a fraction of the container', () => {
    expect(dragFraction(0.5, 100, 1000)).toBeCloseTo(0.6);
    expect(dragFraction(0.5, -1000, 1000)).toBe(BOUNDS.request.min);
    expect(dragFraction(0.5, 1000, 1000)).toBe(BOUNDS.request.max);
    expect(dragFraction(0.42, 50, 0)).toBe(0.42);
    // Near the top it snaps shut (the request pane closes); a little lower it doesn't.
    expect(dragFraction(0.5, -480, 1000)).toBe(0);
    expect(dragFraction(0.5, -460, 1000)).toBeCloseTo(0.04);
  });

  it('resizes key/value columns and always leaves room for Value', () => {
    expect(dragKvColumns({ key: 28, desc: 24 }, 'key', 10, true)).toEqual({ key: 38, desc: 24 });
    expect(dragKvColumns({ key: 28, desc: 24 }, 'value', 10, true)).toEqual({ key: 28, desc: 14 });
    expect(dragKvColumns({ key: 28, desc: 24 }, 'value', -40, true)).toEqual({ key: 28, desc: BOUNDS.kvDesc.max });
    const wide = dragKvColumns({ key: 28, desc: 40 }, 'key', 50, true);
    expect(wide.key + wide.desc).toBeLessThanOrEqual(85);
    expect(dragKvColumns({ key: 28, desc: 24 }, 'key', 100, false).key).toBe(BOUNDS.kvKey.max);
  });
});

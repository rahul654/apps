/**
 * Resizable panes (Postman-style): bounds, defaults and the maths the drag handles use. Sizes are
 * saved in prefs.layout. Pixel sizes for side columns, fractions for splits that should keep their
 * proportion when the window changes, percentages for table columns.
 */

export type SplitOrientation = 'stacked' | 'side';

export interface LayoutPrefs {
  /** Requests sidebar width, px. */
  sidebar: number;
  /** Request/response arrangement: response below (stacked) or to the right (side). */
  orientation: SplitOrientation;
  /** Fraction of the editor taken by the request pane, per orientation. */
  requestStacked: number;
  requestSide: number;
  /** Key/value tables: Key and Description column widths, % of the table. */
  kvKey: number;
  kvDesc: number;
  /** Environments page: list width, px. */
  envList: number;
}

export const BOUNDS = {
  sidebar: { min: 180, max: 640, def: 290 },
  /** min 0: the request pane can close completely (drag the divider up to the tab strip). */
  request: { min: 0, max: 0.9, def: 0.5 },
  kvKey: { min: 12, max: 60, def: 28 },
  kvDesc: { min: 10, max: 50, def: 24 },
  envList: { min: 180, max: 560, def: 260 },
} as const;

export const DEFAULT_LAYOUT: LayoutPrefs = {
  sidebar: BOUNDS.sidebar.def,
  orientation: 'stacked',
  requestStacked: BOUNDS.request.def,
  requestSide: BOUNDS.request.def,
  kvKey: BOUNDS.kvKey.def,
  kvDesc: BOUNDS.kvDesc.def,
  envList: BOUNDS.envList.def,
};

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

const num = (v: unknown, b: { min: number; max: number; def: number }) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, b.min, b.max) : b.def);

/** Validate stored layout prefs; anything missing or broken falls back to the default. */
export function parseLayout(v: unknown): LayoutPrefs {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  return {
    sidebar: Math.round(num(o.sidebar, BOUNDS.sidebar)),
    orientation: o.orientation === 'side' ? 'side' : 'stacked',
    requestStacked: num(o.requestStacked, BOUNDS.request),
    requestSide: num(o.requestSide, BOUNDS.request),
    kvKey: num(o.kvKey, BOUNDS.kvKey),
    kvDesc: num(o.kvDesc, BOUNDS.kvDesc),
    envList: Math.round(num(o.envList, BOUNDS.envList)),
  };
}

/** Width of a side column after dragging its edge by `delta` px, kept within its bounds and
 * leaving at least `keep` px for the rest of the window. */
export function dragWidth(start: number, delta: number, b: { min: number; max: number }, available: number, keep = 360): number {
  return Math.round(clamp(start + delta, b.min, Math.max(b.min, Math.min(b.max, available - keep))));
}

/** Split fraction after dragging the divider by `delta` px across a container of `size` px. */
export function dragFraction(start: number, delta: number, size: number, b: { min: number; max: number } = BOUNDS.request): number {
  if (!(size > 0)) return start;
  const v = clamp(start + delta / size, b.min, b.max);
  // Close to the minimum snaps to it, so the request pane can be closed completely.
  return b.min === 0 && v < COLLAPSE_SNAP ? 0 : v;
}

/** Below this fraction the request pane snaps shut. */
export const COLLAPSE_SNAP = 0.03;

/**
 * Key/value table columns. The Key column's right edge moves Key ⇄ Value; the Value column's
 * right edge moves Value ⇄ Description (dragging right shrinks Description). The Value column
 * always keeps at least 15% of the table.
 */
export function dragKvColumns(start: { key: number; desc: number }, edge: 'key' | 'value', deltaPct: number, withDesc: boolean): { key: number; desc: number } {
  const desc = withDesc ? start.desc : 0;
  if (edge === 'key') {
    const key = clamp(start.key + deltaPct, BOUNDS.kvKey.min, Math.min(BOUNDS.kvKey.max, 85 - desc));
    return { key, desc: start.desc };
  }
  const d = clamp(start.desc - deltaPct, BOUNDS.kvDesc.min, Math.min(BOUNDS.kvDesc.max, 85 - start.key));
  return { key: start.key, desc: d };
}

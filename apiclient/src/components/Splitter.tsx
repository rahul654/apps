/**
 * Drag handle between two panes (Postman-style). While dragging, `onDrag` gets the pixel offset
 * from where the drag started and should apply the size *without* a React render (set a CSS
 * variable on a ref); `onCommit` runs once at the end to save it. Arrow keys move it by `keyStep`
 * px (Shift: ×4) and commit straight away; double-click (or Home) resets.
 */
import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { useAppStore } from '../store/AppStore';
import type { LayoutPrefs } from '../lib/layout';

export function Splitter({
  axis,
  label,
  className = '',
  valueNow,
  valueMin,
  valueMax,
  onDrag,
  onCommit,
  onReset,
  keyStep = 16,
}: {
  /** 'x': drag left/right (a vertical bar between columns); 'y': drag up/down. */
  axis: 'x' | 'y';
  label: string;
  className?: string;
  /** For assistive tech, e.g. a percentage. */
  valueNow?: number;
  valueMin?: number;
  valueMax?: number;
  onDrag: (deltaPx: number) => void;
  onCommit: () => void;
  onReset?: () => void;
  keyStep?: number;
}) {
  const start = useRef<number | null>(null);
  const moved = useRef(false);

  const end = (e: PointerEvent<HTMLDivElement>) => {
    if (start.current === null) return;
    start.current = null;
    document.body.classList.remove('resizing', 'resizing-x', 'resizing-y');
    e.currentTarget.classList.remove('dragging');
    if (moved.current) onCommit();
  };

  return (
    <div
      className={`splitter splitter-${axis} ${className}`}
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={valueNow}
      aria-valuemin={valueMin}
      aria-valuemax={valueMax}
      tabIndex={0}
      title={`${label}: drag to resize, double-click to reset`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        start.current = axis === 'x' ? e.clientX : e.clientY;
        moved.current = false;
        // Keeps the resize cursor and stops text selection while the pointer is over other panes.
        document.body.classList.add('resizing', `resizing-${axis}`);
        e.currentTarget.classList.add('dragging');
      }}
      onPointerMove={(e) => {
        if (start.current === null) return;
        const delta = (axis === 'x' ? e.clientX : e.clientY) - start.current;
        if (delta !== 0) moved.current = true;
        onDrag(delta);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={onReset}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        const back = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
        const fwd = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
        if (e.key === back || e.key === fwd) {
          e.preventDefault();
          onDrag((e.key === fwd ? 1 : -1) * keyStep * (e.shiftKey ? 4 : 1));
          onCommit();
        } else if (e.key === 'Home' && onReset) {
          e.preventDefault();
          onReset();
        }
      }}
    />
  );
}

/** The saved pane sizes, and a setter that merges into them. */
export function useLayoutPrefs(): [LayoutPrefs, (patch: Partial<LayoutPrefs>) => void] {
  const { state, dispatch, getState } = useAppStore();
  return [
    state.prefs.layout,
    // Read the latest prefs at call time: a drag can end after other prefs changed.
    (patch) => {
      const prefs = getState().prefs;
      dispatch({ type: 'prefs/set', prefs: { ...prefs, layout: { ...prefs.layout, ...patch } } });
    },
  ];
}

import { useCallback, useRef, useState } from 'react';

interface State<T> {
  past: T[];
  present: T;
  future: T[];
}

const LIMIT = 200;

/**
 * Undo/redo over immutable snapshots. `set` commits a step. For drags, call
 * `begin()` at pointer-down, `transient()` while moving (no history), and `end()`
 * at pointer-up, which records one step from the snapshot taken by `begin()`.
 */
export function useHistory<T>(initial: T) {
  const [state, setState] = useState<State<T>>({ past: [], present: initial, future: [] });
  const gesture = useRef<T | null>(null);
  const presentRef = useRef(state.present);
  presentRef.current = state.present;

  const set = useCallback((updater: T | ((prev: T) => T)) => {
    setState((s) => {
      const next = typeof updater === 'function' ? (updater as (p: T) => T)(s.present) : updater;
      if (next === s.present) return s;
      return { past: [...s.past, s.present].slice(-LIMIT), present: next, future: [] };
    });
  }, []);

  const transient = useCallback((updater: T | ((prev: T) => T)) => {
    setState((s) => ({ ...s, present: typeof updater === 'function' ? (updater as (p: T) => T)(s.present) : updater }));
  }, []);

  const begin = useCallback(() => {
    gesture.current = presentRef.current;
  }, []);

  const end = useCallback(() => {
    const before = gesture.current;
    gesture.current = null;
    if (before === null) return;
    setState((s) => (s.present === before ? s : { past: [...s.past, before].slice(-LIMIT), present: s.present, future: [] }));
  }, []);

  /** Abandon the current gesture without recording a step. */
  const cancel = useCallback(() => {
    gesture.current = null;
  }, []);

  const undo = useCallback(() => {
    setState((s) => (s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] } : s));
  }, []);

  const redo = useCallback(() => {
    setState((s) => (s.future.length ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) } : s));
  }, []);

  const reset = useCallback((value: T) => setState({ past: [], present: value, future: [] }), []);

  return { value: state.present, set, transient, begin, end, cancel, undo, redo, reset, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}

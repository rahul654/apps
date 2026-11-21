import { createContext, useContext, useSyncExternalStore } from 'react';

/**
 * True inside a request/response pane on wide screens: body editors and the response viewer
 * stretch to the pane's height (the pane divider sizes them, like Postman) instead of using their
 * own fixed height and drag grip. False elsewhere (History, narrow screens).
 */
export const PaneFillContext = createContext(false);

export const usePaneFill = (): boolean => useContext(PaneFillContext);

/** Same breakpoint as the CSS that turns the panes into one scrolling column. */
const NARROW = '(max-width: 860px)';
const subscribe = (fn: () => void) => {
  const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(NARROW) : null;
  mq?.addEventListener?.('change', fn);
  return () => mq?.removeEventListener?.('change', fn);
};
const narrowNow = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(NARROW).matches : false);

export function useNarrowScreen(): boolean {
  return useSyncExternalStore(subscribe, narrowNow, () => false);
}

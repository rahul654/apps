/**
 * Request ⇄ response panes with a drag handle, stacked (response below) or side by side, like
 * Postman. Each pane scrolls on its own. The split is a fraction of the editor, saved per
 * orientation in prefs.layout. Narrow screens (≤860px) fall back to one scrolling column (CSS).
 */
import { useRef, type CSSProperties, type ReactNode } from 'react';
import { BOUNDS, dragFraction } from '../lib/layout';
import { IconLayoutColumns, IconLayoutRows } from './Icons';
import { PaneFillContext, useNarrowScreen } from './paneFill';
import { Splitter, useLayoutPrefs } from './Splitter';

export function SplitPanes({ request, response, requestLabel = 'Request', responseLabel = 'Response' }: { request: ReactNode; response: ReactNode; requestLabel?: string; responseLabel?: string }) {
  const [layout, setLayout] = useLayoutPrefs();
  const ref = useRef<HTMLDivElement>(null);
  const side = layout.orientation === 'side';
  const fraction = side ? layout.requestSide : layout.requestStacked;
  const live = useRef(fraction);
  const save = (v: number) => setLayout(side ? { requestSide: v } : { requestStacked: v });
  const fill = !useNarrowScreen();

  return (
    <PaneFillContext.Provider value={fill}>
    <div ref={ref} className={`split-panes ${side ? 'side' : 'stacked'}${fraction === 0 ? ' req-collapsed' : ''}`} style={{ '--req-frac': fraction } as CSSProperties}>
      <div className="pane req-pane" role="region" aria-label={requestLabel}>
        {request}
      </div>
      <Splitter
        axis={side ? 'x' : 'y'}
        label={side ? 'Request and response widths' : 'Request and response heights'}
        className="pane-splitter"
        valueNow={Math.round(fraction * 100)}
        valueMin={BOUNDS.request.min * 100}
        valueMax={BOUNDS.request.max * 100}
        onDrag={(d) => {
          const el = ref.current;
          const size = el ? (side ? el.clientWidth : el.clientHeight) : 0;
          live.current = dragFraction(fraction, d, size);
          el?.style.setProperty('--req-frac', String(live.current));
          el?.classList.toggle('req-collapsed', live.current === 0);
          // Stacked and too short for its content: keep the bottom (the body editor) on the
          // divider and let the top (URL bar, tabs) slide up under the tab strip, like Postman.
          const pane = el?.querySelector<HTMLElement>(':scope > .req-pane');
          if (pane && !side && pane.scrollHeight > pane.clientHeight) pane.scrollTop = pane.scrollHeight;
        }}
        onCommit={() => save(live.current)}
        onReset={() => {
          save(BOUNDS.request.def);
          // Back to the default size: show the request from the top again.
          ref.current?.querySelector<HTMLElement>(':scope > .req-pane')?.scrollTo({ top: 0 });
        }}
      />
      <div className="pane resp-pane" role="region" aria-label={`${responseLabel} pane`}>
        {response}
      </div>
    </div>
    </PaneFillContext.Provider>
  );
}

/** Toggle between response below and response on the right. */
export function SplitOrientationToggle() {
  const [layout, setLayout] = useLayoutPrefs();
  const side = layout.orientation === 'side';
  return (
    <button
      type="button"
      className="btn small icon split-toggle"
      onClick={() => setLayout({ orientation: side ? 'stacked' : 'side' })}
      aria-label={side ? 'Show the response below the request' : 'Show the response beside the request'}
      title={side ? 'Response below' : 'Response on the right'}
    >
      {side ? <IconLayoutRows size={15} /> : <IconLayoutColumns size={15} />}
    </button>
  );
}

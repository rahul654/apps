/**
 * Single-line input that colours `{{variables}}` and opens the variable popover on hover or when
 * the keyboard caret enters one. Used by the URL bar, key-value tables, form fields and auth.
 *
 * It is a native <input> (fast with hundreds of table rows, works before the CodeMirror chunk has
 * loaded, keeps form/IME/autofill behaviour) with an aligned highlight layer underneath: when the
 * value contains a variable, the input's own text turns transparent and the layer draws the text
 * with the variables coloured. Hover finds the token under the pointer with elementsFromPoint, so
 * the layer can stay below the input. Without a VariablesProvider it renders a plain input.
 */
import { useLayoutEffect, useMemo, useRef, type InputHTMLAttributes, type KeyboardEvent } from 'react';
import { variableTokens } from '../../lib/varScope';
import { useVarApi, type VarApi } from './VariablesProvider';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string;
  onChange: (value: string) => void;
  /** Class for the wrapper (e.g. flex sizing in the URL bar). */
  wrapperClassName?: string;
};

const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);
/** The layer copies only the classes that set box metrics and font, so selectors like `.url-input` keep matching just the input. */
const layerClass = (c: string) => c.split(/\s+/).filter((x) => x === 'input' || x === 'mono' || x === 'compact').join(' ');

export function VarInput(props: Props) {
  const api = useVarApi();
  if (!api) {
    const { value, onChange, wrapperClassName: _w, ...rest } = props;
    return <input {...rest} value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  return <VarField {...props} api={api} />;
}

function VarField({ value, onChange, wrapperClassName = '', className = '', type, api, onKeyDown, onKeyUp, onBlur, onScroll, ...rest }: Props & { api: VarApi }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const layerRef = useRef<HTMLSpanElement>(null);
  const frame = useRef(0);
  const masked = type === 'password';
  const tokens = useMemo(() => (masked ? [] : variableTokens(value)), [value, masked]);
  const has = tokens.length > 0;

  const syncScroll = () => {
    if (layerRef.current && inputRef.current) layerRef.current.scrollLeft = inputRef.current.scrollLeft;
  };
  useLayoutEffect(syncScroll);

  const tokenAtCaret = () => {
    const el = inputRef.current;
    if (!el || !has) return null;
    const pos = el.selectionStart ?? -1;
    if (el.selectionEnd !== el.selectionStart) return null;
    const i = tokens.findIndex((t) => pos > t.from && pos < t.to);
    return i < 0 ? null : { i, name: tokens[i].name };
  };
  const checkCaret = () => {
    const el = inputRef.current;
    if (!el) return;
    syncScroll();
    const hit = tokenAtCaret();
    const span = hit ? layerRef.current?.querySelector<HTMLElement>(`[data-i="${hit.i}"]`) : null;
    api.caret(hit?.name ?? null, span?.getBoundingClientRect() ?? null, el);
  };

  let layer: React.ReactNode = null;
  if (has) {
    const parts: React.ReactNode[] = [];
    let last = 0;
    tokens.forEach((t, i) => {
      if (t.from > last) parts.push(value.slice(last, t.from));
      parts.push(
        <span key={i} data-i={i} data-var={t.name} className={`var-tok var-${api.status(t.name)}`}>
          {value.slice(t.from, t.to)}
        </span>,
      );
      last = t.to;
    });
    parts.push(value.slice(last) + ' ');
    layer = parts;
  }

  return (
    <span className={`var-field ${has ? 'has-vars' : ''} ${wrapperClassName}`.trim()}>
      <span ref={layerRef} className={`var-layer ${layerClass(className)}`} aria-hidden="true">
        <span className="var-layer-text">{layer}</span>
      </span>
      <input
        {...rest}
        ref={inputRef}
        type={type}
        className={className}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          syncScroll();
          onScroll?.(e);
        }}
        onMouseMove={(e) => {
          if (!has) return;
          const { clientX, clientY } = e;
          cancelAnimationFrame(frame.current);
          frame.current = requestAnimationFrame(() => {
            const els = typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(clientX, clientY) : [];
            const tok = els.find((x): x is HTMLElement => x instanceof HTMLElement && x.dataset.var !== undefined && !!layerRef.current?.contains(x));
            if (tok && inputRef.current) api.hover(tok.dataset.var!, tok.getBoundingClientRect(), inputRef.current);
            else api.leave();
          });
        }}
        onMouseLeave={() => {
          cancelAnimationFrame(frame.current);
          api.leave();
        }}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (inputRef.current && api.isOpenFor(inputRef.current)) {
            if (e.key === 'ArrowDown' && api.focusPopover()) e.preventDefault();
            else if (e.key === 'Escape') api.caret(null, null, inputRef.current);
          }
          onKeyDown?.(e);
        }}
        onKeyUp={(e) => {
          if (NAV_KEYS.has(e.key)) checkCaret();
          onKeyUp?.(e);
        }}
        onBlur={(e) => {
          api.blur(e.currentTarget, e.relatedTarget);
          onBlur?.(e);
        }}
      />
    </span>
  );
}

/**
 * React wrapper for the CodeMirror editor in ./cm (a separate chunk, loaded on first use). Until it
 * has loaded, or if it fails to, a plain textarea / pre shows the same text, so the page is usable
 * at once. Editable editors can be resized with a drag handle (or the arrow keys on it).
 */
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';
import { clampEditorHeight } from '../../lib/prefs';
import { useVarApi } from '../vars/VariablesProvider';
import type { CmHandle, CodeLanguage, VarHooks } from './cm';

export type { CodeLanguage };

type CmModule = typeof import('./cm');
let loaded: CmModule | null = null;
let loading: Promise<CmModule> | null = null;
export function loadCodeMirror(): Promise<CmModule> {
  if (loaded) return Promise.resolve(loaded);
  loading ??= import('./cm').then((m) => (loaded = m));
  return loading;
}

export interface CodeEditorApi {
  openSearch: () => void;
  foldAll: () => void;
  unfoldAll: () => void;
  focus: () => void;
}

export interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  language?: CodeLanguage;
  readOnly?: boolean;
  wrap?: boolean;
  /** Highlighting, folding and bracket matching (turn off for huge documents). */
  rich?: boolean;
  /** Show JSON errors inline (placeholders allowed). */
  lintJson?: boolean;
  ariaLabel: string;
  placeholder?: string;
  /** Fixed height in px; with onHeightChange a drag handle resizes it. */
  height?: number;
  onHeightChange?: (h: number) => void;
  /** CSS max-height when no fixed height is given (viewers grow with their content). */
  maxHeight?: string;
  /** Colour `{{variables}}` and report them to the variable popover (needs a VariablesProvider). */
  variables?: boolean;
  className?: string;
  apiRef?: Ref<CodeEditorApi>;
}

export function CodeEditor({ value, onChange, language = 'text', readOnly = false, wrap = false, rich = true, lintJson = false, ariaLabel, placeholder, height, onHeightChange, maxHeight, variables = false, className = '', apiRef }: CodeEditorProps) {
  const [mod, setMod] = useState<CmModule | null>(loaded);
  const [failed, setFailed] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<CmHandle | null>(null);
  const varApi = useVarApi();
  const hooks = useMemo<VarHooks | null>(() => (variables && varApi ? { status: varApi.status, hover: varApi.hover, leave: varApi.leave, caret: varApi.caret, focusPopover: varApi.focusPopover } : null), [variables, varApi]);
  const latest = useRef({ value, onChange, language, readOnly, wrap, rich, lintJson, ariaLabel, placeholder, hooks });
  latest.current = { value, onChange, language, readOnly, wrap, rich, lintJson, ariaLabel, placeholder, hooks };

  useEffect(() => {
    if (mod) return;
    let alive = true;
    loadCodeMirror().then(
      (m) => alive && setMod(m),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [mod]);

  useLayoutEffect(() => {
    if (!mod || !host.current) return;
    const l = latest.current;
    const h = mod.createEditor(host.current, { doc: l.value, language: l.language, readOnly: l.readOnly, wrap: l.wrap, rich: l.rich, lintJson: l.lintJson, ariaLabel: l.ariaLabel, placeholder: l.placeholder, vars: l.hooks, onChange: (v) => latest.current.onChange?.(v) });
    handle.current = h;
    return () => {
      h.destroy();
      handle.current = null;
    };
  }, [mod]);

  useEffect(() => {
    handle.current?.setDoc(value);
  }, [value, mod]);
  useEffect(() => {
    handle.current?.update({ language, readOnly, wrap, rich, lintJson, ariaLabel, placeholder, vars: hooks });
  }, [language, readOnly, wrap, rich, lintJson, ariaLabel, placeholder, hooks, mod]);

  useImperativeHandle(
    apiRef,
    () => ({
      openSearch: () => handle.current?.openSearch(),
      foldAll: () => handle.current?.foldAll(),
      unfoldAll: () => handle.current?.unfoldAll(),
      focus: () => handle.current?.focus(),
    }),
    [],
  );

  // Resizing: local height while dragging, saved once on release.
  const [dragH, setDragH] = useState<number | null>(null);
  const h = dragH ?? height;
  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!onHeightChange || height === undefined) return;
    e.preventDefault();
    const startY = e.clientY;
    const start = height;
    const el = e.currentTarget;
    el.setPointerCapture?.(e.pointerId);
    let last = start;
    const move = (ev: PointerEvent) => {
      last = clampEditorHeight(start + ev.clientY - startY);
      setDragH(last);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setDragH(null);
      if (last !== start) onHeightChange(last);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const showFallback = !mod || failed;
  const style: React.CSSProperties = h !== undefined ? { height: h } : { maxHeight };
  return (
    <div className={`code-editor ${readOnly ? 'readonly' : ''} ${className}`.trim()}>
      <div className="code-host" style={style} ref={host} hidden={showFallback} />
      {showFallback &&
        (readOnly ? (
          <pre className={wrap ? 'codeview code-fallback' : 'codeview nowrap code-fallback'} style={style} aria-label={ariaLabel} tabIndex={0}>
            {value}
          </pre>
        ) : (
          <textarea className="input code code-fallback" style={style} value={value} onChange={(e) => onChange?.(e.target.value)} aria-label={ariaLabel} placeholder={placeholder} spellCheck={false} />
        ))}
      {onHeightChange && height !== undefined && (
        <div
          className="code-resize"
          role="separator"
          aria-orientation="horizontal"
          aria-label={`Resize ${ariaLabel.toLowerCase()}`}
          aria-valuenow={h}
          tabIndex={0}
          title="Drag to resize"
          onPointerDown={startDrag}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              onHeightChange(clampEditorHeight(height + (e.key === 'ArrowDown' ? 40 : -40)));
            }
          }}
        />
      )}
    </div>
  );
}

/**
 * Variable highlighting + the Postman-style hover popover for one open request or example.
 *
 * VarInput (single-line fields) and CodeEditor (bodies) read `VarContext` to colour `{{name}}`
 * as resolved / unresolved / dynamic and report hover and keyboard-caret positions here. The
 * popover shows the scope the value comes from (same precedence as sending) and an editable value
 * that is written back to that scope; unresolved names get an "Add to" scope picker.
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { collectionId } from '../../lib/postman/normalize';
import type { PmCollection, PmItem, PmItemGroup } from '../../lib/postman/types';
import { findVariable, setPmVariable, varSources, type VarInfo, type VarStatus, type VarTarget } from '../../lib/varScope';
import { useAppStore } from '../../store/AppStore';
import { variableWriteAction } from '../../store/variableWrite';
import { IconEye, IconEyeOff } from '../Icons';

export interface VarApi {
  status: (name: string) => VarStatus;
  /** Pointer is over a variable: show its popover after a short delay. */
  hover: (name: string, rect: DOMRect, origin: HTMLElement) => void;
  /** Pointer left the variable: hide after a short delay unless it moves onto the popover. */
  leave: () => void;
  /** Keyboard caret moved into (name) or out of (null) a variable: show/hide at once. */
  caret: (name: string | null, rect: DOMRect | null, origin: HTMLElement) => void;
  /** Focus left a field; closes a popover it opened unless focus moved into the popover. */
  blur: (origin: HTMLElement, to: EventTarget | null) => void;
  /** Moves focus into the open popover's value field. Returns false when none is open. */
  focusPopover: () => boolean;
  isOpenFor: (origin: HTMLElement) => boolean;
}

export const VarContext = createContext<VarApi | null>(null);
export const useVarApi = (): VarApi | null => useContext(VarContext);

interface Open {
  name: string;
  rect: DOMRect;
  origin: HTMLElement;
  via: 'hover' | 'keyboard';
  n: number;
}

const SHOW_DELAY = 300;
const HIDE_DELAY = 250;

export function VariablesProvider({ collection, parents, item, onRequestVariable, children }: { collection: PmCollection; parents: PmItemGroup[]; item?: PmItem; onRequestVariable?: (key: string, value: string) => void; children: ReactNode }) {
  const { state, dispatch } = useAppStore();
  const env = state.environments.find((e) => e.id === state.activeEnvironmentId) ?? null;
  const sources = useMemo(() => varSources({ environment: env, collection, parents, item, globals: state.globals }), [env, collection, parents, item, state.globals]);
  const [open, setOpen] = useState<Open | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const popRef = useRef<HTMLDivElement | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counter = useRef(0);
  const clearTimers = () => {
    if (showTimer.current) clearTimeout(showTimer.current);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    showTimer.current = hideTimer.current = null;
  };
  useEffect(() => clearTimers, []);

  const popoverHasFocus = () => !!popRef.current && popRef.current.contains(document.activeElement);
  const close = useCallback((refocus = false) => {
    clearTimers();
    const o = openRef.current;
    setOpen(null);
    if (refocus && o?.origin.isConnected) o.origin.querySelector<HTMLElement>('.cm-content')?.focus() ?? o.origin.focus();
  }, []);

  const api = useMemo<VarApi>(() => {
    const statusCache = new Map<string, VarStatus>();
    return {
      status: (name) => {
        let s = statusCache.get(name);
        if (!s) statusCache.set(name, (s = findVariable(name, sources).status));
        return s;
      },
      hover: (name, rect, origin) => {
        const o = openRef.current;
        if (o && o.name === name && o.origin === origin) {
          if (hideTimer.current) clearTimeout(hideTimer.current);
          hideTimer.current = null;
          return;
        }
        if (showTimer.current) clearTimeout(showTimer.current);
        showTimer.current = setTimeout(() => {
          if (hideTimer.current) clearTimeout(hideTimer.current);
          if (popoverHasFocus()) return;
          setOpen({ name, rect, origin, via: 'hover', n: ++counter.current });
        }, o ? 80 : SHOW_DELAY);
      },
      leave: () => {
        if (showTimer.current) clearTimeout(showTimer.current);
        showTimer.current = null;
        if (!openRef.current || openRef.current.via !== 'hover' || hideTimer.current) return;
        hideTimer.current = setTimeout(() => {
          hideTimer.current = null;
          if (!popoverHasFocus()) setOpen(null);
        }, HIDE_DELAY);
      },
      caret: (name, rect, origin) => {
        if (name && rect) {
          clearTimers();
          const o = openRef.current;
          if (o && o.name === name && o.origin === origin) return;
          setOpen({ name, rect, origin, via: 'keyboard', n: ++counter.current });
        } else if (openRef.current?.origin === origin && !popoverHasFocus()) setOpen(null);
      },
      blur: (origin, to) => {
        const o = openRef.current;
        if (!o || o.origin !== origin) return;
        if (to instanceof Node && popRef.current?.contains(to)) return;
        if (o.via === 'keyboard') setOpen(null);
      },
      focusPopover: () => {
        const input = popRef.current?.querySelector<HTMLElement>('input, select, button');
        if (!input) return false;
        clearTimers();
        input.focus();
        return true;
      },
      isOpenFor: (origin) => openRef.current?.origin === origin,
    };
  }, [sources]);

  // A popover anchored to a scrolled-away field would float in the wrong place.
  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      if (popRef.current?.contains(e.target as Node) || popoverHasFocus()) return;
      setOpen(null);
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  const write = useCallback(
    (target: VarTarget, key: string, value: string) => {
      if (target.kind === 'request') {
        onRequestVariable?.(key, value);
        return;
      }
      const a = variableWriteAction(state, target, key, value);
      if (a) dispatch(a);
    },
    [state, dispatch, onRequestVariable],
  );

  const cid = collectionId(collection);
  const info = open ? findVariable(open.name, sources) : null;
  return (
    <VarContext.Provider value={api}>
      {children}
      {open &&
        info &&
        createPortal(
          <VarPopover
            key={open.n}
            ref={popRef}
            info={info}
            rect={open.rect}
            cid={cid}
            canWriteRequest={!!onRequestVariable}
            envName={env?.name ?? null}
            envId={env?.id ?? null}
            onWrite={write}
            onClose={close}
            onEnter={() => {
              if (hideTimer.current) clearTimeout(hideTimer.current);
              hideTimer.current = null;
            }}
            onLeave={() => openRef.current?.via === 'hover' && api.leave()}
          />,
          document.body,
        )}
    </VarContext.Provider>
  );
}

function targetOf(info: VarInfo, cid: string): VarTarget | null {
  const s = info.source;
  if (!s) return null;
  if (s.kind === 'environment' && s.id) return { kind: 'environment', id: s.id };
  if (s.kind === 'collection') return { kind: 'collection', cid };
  if (s.kind === 'folder' && s.id) return { kind: 'folder', cid, id: s.id };
  if (s.kind === 'globals') return { kind: 'globals' };
  if (s.kind === 'request') return { kind: 'request' };
  return null;
}

interface PopProps {
  info: VarInfo;
  rect: DOMRect;
  cid: string;
  envId: string | null;
  envName: string | null;
  canWriteRequest: boolean;
  onWrite: (t: VarTarget, key: string, value: string) => void;
  onClose: (refocus?: boolean) => void;
  onEnter: () => void;
  onLeave: () => void;
  ref: React.Ref<HTMLDivElement>;
}

function VarPopover({ info, rect, cid, envId, envName, canWriteRequest, onWrite, onClose, onEnter, onLeave, ref }: PopProps) {
  const [value, setValue] = useState(info.value);
  const [reveal, setReveal] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const addTargets: { id: string; label: string; target: VarTarget }[] = [
    ...(envId ? [{ id: 'env', label: `Environment "${envName ?? ''}"`, target: { kind: 'environment', id: envId } as VarTarget }] : []),
    { id: 'collection', label: 'Collection', target: { kind: 'collection', cid } },
    { id: 'globals', label: 'Globals', target: { kind: 'globals' } },
  ];
  const [addTo, setAddTo] = useState(addTargets[0].id);
  const box = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(rect.left, vw - w - 8));
    const below = rect.bottom + 6;
    const top = below + h > vh - 8 && rect.top - h - 6 > 8 ? rect.top - h - 6 : below;
    setPos({ top, left });
  }, [rect]);
  const setRefs = (el: HTMLDivElement | null) => {
    box.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
  };

  const existing = targetOf(info, cid);
  const editable = info.status === 'ok' ? info.editable && !!existing && (existing.kind !== 'request' || canWriteRequest) : info.status === 'missing';
  const save = () => {
    if (info.status === 'ok' && existing) {
      onWrite(existing, info.name, value);
      setSaved(`Saved to ${info.label}`);
    } else if (info.status === 'missing') {
      const t = addTargets.find((x) => x.id === addTo) ?? addTargets[0];
      onWrite(t.target, info.name, value);
      setSaved(`Added to ${t.label}`);
    }
  };
  const masked = info.secret && !reveal;
  return (
    <div
      ref={setRefs}
      className="var-pop"
      role="dialog"
      aria-label={`Variable ${info.name}`}
      style={pos ? { top: pos.top, left: pos.left } : { top: rect.bottom + 6, left: rect.left, visibility: 'hidden' }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose(true);
        }
      }}
    >
      <div className="var-pop-head">
        <code className={`var-pop-name var-${info.status}`}>{info.name}</code>
        <span className={info.status === 'missing' ? 'pill err' : info.status === 'dynamic' ? 'pill muted' : 'pill'}>{info.status === 'missing' ? 'Unresolved' : info.label}</span>
      </div>
      {info.status === 'dynamic' && <p className="tiny muted">Dynamic variable: a new value is generated every time the request is sent.</p>}
      {info.status === 'ok' && !info.editable && <p className="tiny muted">{info.label} values come from the runner and can’t be edited here.</p>}
      {(info.status === 'missing' || (info.status === 'ok' && info.editable)) && (
        <form
          className="stack-sm"
          onSubmit={(e) => {
            e.preventDefault();
            if (editable) save();
          }}
        >
          <div className="row nowrap">
            <input
              className="input compact mono grow"
              type={masked ? 'password' : 'text'}
              value={value}
              placeholder={info.status === 'missing' ? 'Enter value' : ''}
              aria-label={info.status === 'missing' ? `Value for ${info.name}` : `Current value of ${info.name}`}
              onChange={(e) => {
                setValue(e.target.value);
                setSaved(null);
              }}
              disabled={!editable}
              spellCheck={false}
              autoComplete="off"
            />
            {info.secret && (
              <button type="button" className="btn ghost small icon" aria-label={reveal ? 'Hide value' : 'Show value'} aria-pressed={reveal} onClick={() => setReveal((r) => !r)}>
                {reveal ? <IconEyeOff size={15} /> : <IconEye size={15} />}
              </button>
            )}
          </div>
          {info.status === 'missing' && (
            <label className="row nowrap small">
              <span className="muted">Add to</span>
              <select className="input compact grow" value={addTo} onChange={(e) => setAddTo(e.target.value)} aria-label="Add to scope">
                {addTargets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="row nowrap">
            <button type="submit" className="btn small primary" disabled={!editable || (info.status === 'ok' && value === info.value && !saved)}>
              {info.status === 'missing' ? 'Add' : 'Save'}
            </button>
            {saved ? <span className="tiny ok" role="status">{saved}</span> : <span className="tiny muted">Enter saves · Esc closes</span>}
          </div>
        </form>
      )}
    </div>
  );
}

/** Updates a request-level variable in an item (the draft). */
export function withRequestVariable(item: PmItem, key: string, value: string): PmItem {
  return { ...item, variable: setPmVariable(item.variable, key, value) };
}

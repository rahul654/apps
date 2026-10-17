import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { sparklinePath } from '../lib/latency/stats';
import { IconClose, IconPlus } from './Icons';
import { VarInput } from './vars/VarInput';

/** Accessible tab strip; `tabs` ids must be stable. */
export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (t: T) => void; label: string }) {
  const base = useId();
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" id={`${base}-${t.id}`} className="tab" aria-selected={value === t.id} tabIndex={value === t.id ? 0 : -1} onClick={() => onChange(t.id)} onKeyDown={(e) => {
          const i = tabs.findIndex((x) => x.id === value);
          if (e.key === 'ArrowRight') onChange(tabs[(i + 1) % tabs.length].id);
          if (e.key === 'ArrowLeft') onChange(tabs[(i - 1 + tabs.length) % tabs.length].id);
        }}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export interface KVRow {
  key: string;
  value: string;
  disabled?: boolean;
  description?: string;
}

/** Key/value table with enable checkboxes; a trailing empty row is always offered. */
export function KVEditor({ rows, onChange, keyLabel = 'Key', valueLabel = 'Value', withDescription = true, label, secret = false }: { rows: KVRow[]; onChange: (rows: KVRow[]) => void; keyLabel?: string; valueLabel?: string; withDescription?: boolean; label: string; secret?: boolean }) {
  const update = (i: number, patch: Partial<KVRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(rows.filter((_, j) => j !== i));
  return (
    <div>
      <table className="kv">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            <th scope="col" className="c">
              <span className="sr-only">Enabled</span>
            </th>
            <th scope="col">{keyLabel}</th>
            <th scope="col">{valueLabel}</th>
            {withDescription && <th scope="col">Description</th>}
            <th scope="col" className="a">
              <span className="sr-only">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={r.disabled ? 'off' : undefined}>
              <td className="c">
                <input type="checkbox" checked={!r.disabled} onChange={(e) => update(i, { disabled: !e.target.checked })} aria-label={`Enable ${r.key || 'row ' + (i + 1)}`} />
              </td>
              <td>
                <VarInput className="input mono" value={r.key} onChange={(v) => update(i, { key: v })} aria-label={`${keyLabel} ${i + 1}`} placeholder={keyLabel.toLowerCase()} spellCheck={false} />
              </td>
              <td>
                <VarInput className="input mono" type={secret ? 'password' : 'text'} value={r.value} onChange={(v) => update(i, { value: v })} aria-label={`${valueLabel} ${i + 1}`} placeholder={valueLabel.toLowerCase()} spellCheck={false} />
              </td>
              {withDescription && (
                <td>
                  <input className="input" value={r.description ?? ''} onChange={(e) => update(i, { description: e.target.value })} aria-label={`Description ${i + 1}`} placeholder="description" />
                </td>
              )}
              <td className="a">
                <button type="button" className="btn ghost small icon" onClick={() => remove(i)} aria-label={`Remove ${r.key || 'row ' + (i + 1)}`}>
                  <IconClose size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="btn ghost small kv-add" onClick={() => onChange([...rows, { key: '', value: '' }])}>
        <IconPlus size={14} /> Add
      </button>
    </div>
  );
}

export function Sparkline({ values, width = 120, height = 28, label }: { values: number[]; width?: number; height?: number; label?: string }) {
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label ?? `Trend of ${values.length} values`}>
      <path d={sparklinePath(values, width, height)} fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}

export function StatusBadge({ status, text }: { status: number; text?: string }) {
  const cls = `status s${Math.floor(status / 100)}`;
  return (
    <span className={cls}>
      {status || 'Error'} {text}
    </span>
  );
}

export interface ToastAction {
  label: string;
  onClick: () => void;
}

/** A transient status message; with an action (e.g. Undo) it stays longer and shows a button. */
export function useToast(): [ReactNode, (msg: string, action?: ToastAction) => void] {
  const [toast, setToast] = useState<{ msg: string; action?: ToastAction; n: number } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), toast.action ? 10000 : 4000);
    return () => window.clearTimeout(t);
  }, [toast]);
  const show = useCallback((msg: string, action?: ToastAction) => setToast((t) => ({ msg, action, n: (t?.n ?? 0) + 1 })), []);
  const node = toast ? (
    <div className="toast" role="status">
      <span>{toast.msg}</span>
      {toast.action && (
        <button type="button" className="btn small" onClick={() => {
          toast.action!.onClick();
          setToast(null);
        }}>
          {toast.action.label}
        </button>
      )}
    </div>
  ) : null;
  return [node, show];
}

/** Reads a File as text, for imports. */
export function readText(file: File): Promise<string> {
  return file.text();
}

export function MethodTag({ method }: { method: string }) {
  const m = method.toUpperCase();
  return (
    <span className="method" data-m={m}>
      {m.length > 6 ? m.slice(0, 5) + '…' : m}
    </span>
  );
}

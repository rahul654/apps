import { memo, useState } from 'react';
import { childPath } from '../lib/json';

const PAGE = 100;

function summary(v: unknown): string {
  if (Array.isArray(v)) return `Array(${v.length})`;
  if (v !== null && typeof v === 'object') {
    const n = Object.keys(v).length;
    return `{${n} ${n === 1 ? 'key' : 'keys'}}`;
  }
  return '';
}

function Scalar({ value }: { value: unknown }) {
  if (value === null) return <span className="j-null">null</span>;
  switch (typeof value) {
    case 'string':
      return <span className="j-str">{JSON.stringify(value)}</span>;
    case 'number':
      return <span className="j-num">{String(value)}</span>;
    case 'boolean':
      return <span className="j-bool">{String(value)}</span>;
    default:
      return <span>{String(value)}</span>;
  }
}

interface NodeProps {
  name: string | number | null;
  value: unknown;
  path: string;
  depth: number;
  defaultDepth: number;
}

const Node = memo(function Node({ name, value, path, depth, defaultDepth }: NodeProps) {
  const isArr = Array.isArray(value);
  const isObj = value !== null && typeof value === 'object';
  const [open, setOpen] = useState(depth < defaultDepth);
  const [shown, setShown] = useState(PAGE);
  const label =
    name === null ? null : (
      <span className="j-key">
        {typeof name === 'number' ? name : JSON.stringify(name)}
        <span className="j-punct">: </span>
      </span>
    );

  if (!isObj) {
    return (
      <li className="j-leaf" title={path}>
        {label}
        <Scalar value={value} />
      </li>
    );
  }
  const entries: [string | number, unknown][] = isArr ? (value as unknown[]).map((v, i) => [i, v]) : Object.entries(value as object);
  const empty = entries.length === 0;
  return (
    <li title={path}>
      <button type="button" className="j-toggle" aria-expanded={empty ? undefined : open} onClick={() => setOpen(!open)} disabled={empty}>
        <span className="j-caret" aria-hidden="true">
          {empty ? '' : open ? '▾' : '▸'}
        </span>
        {label}
        <span className="j-punct">{isArr ? '[' : '{'}</span>
        {!open || empty ? (
          <>
            {!empty && <span className="j-summary">{summary(value)}</span>}
            <span className="j-punct">{isArr ? ']' : '}'}</span>
          </>
        ) : null}
      </button>
      {open && !empty && (
        <>
          <ul className="j-children">
            {entries.slice(0, shown).map(([k, v]) => (
              <Node key={k} name={k} value={v} path={childPath(path, k)} depth={depth + 1} defaultDepth={defaultDepth} />
            ))}
            {entries.length > shown && (
              <li>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShown(shown + PAGE)}>
                  Show {Math.min(PAGE, entries.length - shown)} more of {entries.length - shown} remaining
                </button>
              </li>
            )}
          </ul>
          <span className="j-punct j-close">{isArr ? ']' : '}'}</span>
        </>
      )}
    </li>
  );
});

/** Collapsible JSON tree. Children render lazily and in pages of 100, so huge documents stay responsive. */
export function JsonTree({ value, defaultDepth = 2 }: { value: unknown; defaultDepth?: number }) {
  return (
    <ul className="json-tree mono" aria-label="JSON tree">
      <Node name={null} value={value} path="$" depth={0} defaultDepth={defaultDepth} />
    </ul>
  );
}

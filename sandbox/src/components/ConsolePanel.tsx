import { useEffect, useRef, useState } from 'react';
import type { ConsoleEntry } from '../lib/consoleBridge';
import { IconTerminal, IconTrash } from './Icons';

export function ConsolePanel({ entries, onClear, scriptsOff }: { entries: ConsoleEntry[]; onClear: () => void; scriptsOff: boolean }) {
  const [open, setOpen] = useState(true);
  const listRef = useRef<HTMLOListElement>(null);
  const errors = entries.filter((e) => e.level === 'error').reduce((n, e) => n + e.count, 0);
  const warnings = entries.filter((e) => e.level === 'warn').reduce((n, e) => n + e.count, 0);

  // Stick to the bottom while new lines arrive, unless the user has scrolled up.
  const pinned = useRef(true);
  useEffect(() => {
    const el = listRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  return (
    <section className={open ? 'console open' : 'console'} aria-label="Console">
      <div className="console-head">
        <button type="button" className="console-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <IconTerminal size={15} /> Console
          {errors > 0 && <span className="count error">{errors}</span>}
          {warnings > 0 && <span className="count warn">{warnings}</span>}
        </button>
        <span className="spacer" />
        {open && (
          <button type="button" className="btn ghost small" onClick={onClear} disabled={!entries.length}>
            <IconTrash size={14} /> Clear
          </button>
        )}
      </div>
      {open && (
        <ol
          ref={listRef}
          className="console-list mono"
          onScroll={(e) => {
            const el = e.currentTarget;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
        >
          {entries.length === 0 && (
            <li className="console-empty">{scriptsOff ? 'JavaScript is off in this sandbox, so nothing is logged.' : 'console.log output and errors from the page show up here.'}</li>
          )}
          {entries.map((e) => (
            <li key={e.id} className={`line ${e.level}`}>
              {e.count > 1 && <span className="repeat">{e.count}</span>}
              <span className="text">{e.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

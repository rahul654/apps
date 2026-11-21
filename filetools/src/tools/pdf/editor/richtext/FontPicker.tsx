import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { fontsVersion, getLoadedFont, subscribeFonts } from '../../../../lib/fonts/loader';
import { cssFontFamily, FONT_FAMILIES, fontDef, type FontId } from '../../../../lib/fonts/registry';

/**
 * Font family picker. Each name is shown in its own font when that font is available
 * (standard fonts always; bundled ones once loaded). Standard fonts are tagged "Latin only".
 */
export function FontPicker({ value, onChange, label = 'Font', compact = false }: { value: FontId | undefined; onChange: (id: FontId) => void; label?: string; compact?: boolean }) {
  useSyncExternalStore(subscribeFonts, fontsVersion);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, FONT_FAMILIES.findIndex((f) => f.id === value)));
    const onDoc = (e: PointerEvent) => {
      if (!listRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDoc, true);
    return () => document.removeEventListener('pointerdown', onDoc, true);
  }, [open, value]);

  useEffect(() => {
    if (open) (listRef.current?.children[active] as HTMLElement | undefined)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open]);

  const styleFor = (fid: FontId) => {
    const def = fontDef(fid);
    const loaded = def.kind === 'standard' || getLoadedFont(fid, 'regular');
    return loaded ? { fontFamily: cssFontFamily(fid) } : undefined;
  };

  const choose = (fid: FontId) => {
    setOpen(false);
    btnRef.current?.focus();
    onChange(fid); // may move focus (e.g. back into the text editor)
  };

  const onKey = (e: KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(FONT_FAMILIES.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(FONT_FAMILIES[active].id); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
  };

  const current = value ? fontDef(value) : null;
  return (
    <div className={`font-picker${compact ? ' compact' : ''}`}>
      <button
        ref={btnRef}
        type="button"
        className="btn small font-picker-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={`${label}: ${current?.label ?? 'mixed'}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKey}
        onMouseDown={(e) => e.preventDefault()}
      >
        <span style={value ? styleFor(value) : undefined}>{current?.label ?? 'Mixed fonts'}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul ref={listRef} id={`${id}-list`} role="listbox" className="font-list" aria-label={label} aria-activedescendant={`${id}-${active}`} tabIndex={-1} onKeyDown={onKey}>
          {FONT_FAMILIES.map((f, i) => (
            <li
              key={f.id}
              id={`${id}-${i}`}
              role="option"
              aria-selected={f.id === value}
              className={`${i === active ? 'active' : ''}${f.id === value ? ' selected' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(f.id)}
            >
              <span className="font-name" style={styleFor(f.id)}>{f.label}</span>
              {f.kind === 'standard' ? <span className="tag">Latin only</span> : !f.files.italic && <span className="tag muted">no italic</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

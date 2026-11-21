import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
  danger?: boolean;
}

/**
 * Accessible menu button: Enter/Space/ArrowDown open it, arrows and Home/End move, Escape or
 * Tab closes it, and focus returns to the button.
 */
export function Menu({ label, items, children, className = 'btn', align = 'end' }: { label: string; items: MenuItem[]; children: ReactNode; className?: string; align?: 'start' | 'end' }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const focusItem = (i: number) => {
    const els = menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    if (!els?.length) return;
    els[(i + els.length) % els.length].focus();
  };

  useEffect(() => {
    if (!open) return;
    focusItem(0);
    const onDown = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    const els = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') focusItem(i + 1);
    else if (e.key === 'ArrowUp') focusItem(i - 1);
    else if (e.key === 'Home') focusItem(0);
    else if (e.key === 'End') focusItem(els.length - 1);
    else if (e.key === 'Escape') close();
    else if (e.key === 'Tab') return close(false);
    else return;
    e.preventDefault();
  };

  return (
    <div className="menu-wrap">
      <button
        ref={btn}
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        title={label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {children}
      </button>
      {open && (
        <div ref={menu} id={id} role="menu" aria-label={label} className={`menu ${align}`} onKeyDown={onMenuKey}>
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={it.danger ? 'menu-item danger' : 'menu-item'}
              onClick={() => {
                close();
                it.onSelect();
              }}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

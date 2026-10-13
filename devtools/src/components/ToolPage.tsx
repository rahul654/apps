import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

interface Props {
  title: string;
  icon: string;
  description: string;
  children: ReactNode;
  /** Optional sub-mode tabs rendered as links (each mode is linkable). */
  tabs?: { to: string; label: string; end?: boolean }[];
}

export function ToolPage({ title, icon, description, children, tabs }: Props) {
  return (
    <article className="tool">
      <header className="tool-header">
        <span className="tool-icon" aria-hidden="true">
          {icon}
        </span>
        <div>
          <h1>{title}</h1>
          <p className="muted">{description}</p>
        </div>
      </header>
      {tabs && (
        <nav className="subtabs" aria-label={`${title} modes`}>
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end ?? true} className={({ isActive }) => `subtab ${isActive ? 'active' : ''}`}>
              {t.label}
            </NavLink>
          ))}
        </nav>
      )}
      {children}
    </article>
  );
}

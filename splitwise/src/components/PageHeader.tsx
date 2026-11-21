import type { ReactNode } from 'react';

export function PageHeader({
  title,
  icon,
  subtitle,
  actions,
}: {
  title: string;
  icon?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div className="page-title">
        {icon && <span className="page-icon">{icon}</span>}
        <div>
          <h1>{title}</h1>
          {subtitle && <div className="page-subtitle">{subtitle}</div>}
        </div>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

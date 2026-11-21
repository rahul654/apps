import type { ReactNode } from 'react';
import { CopyButton } from './CopyButton';

export interface ValueRow {
  label: string;
  value: string;
  extra?: ReactNode;
  highlight?: boolean;
}

/** Label / monospace value / copy rows. */
export function ValueTable({ rows, caption }: { rows: ValueRow[]; caption?: string }) {
  return (
    <div className="value-table" role="table" aria-label={caption}>
      {rows.map((r) => (
        <div className={`value-row ${r.highlight ? 'is-highlight' : ''}`} role="row" key={r.label}>
          <div className="value-label" role="rowheader">
            {r.label}
          </div>
          <div className="value-cell mono" role="cell">
            {r.value}
            {r.extra}
          </div>
          <div role="cell" className="value-copy">
            <CopyButton text={r.value} ariaLabel={`Copy ${r.label}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

import { useState, type ReactNode } from 'react';
import { moveItem } from '../lib/array';

interface Props<T extends { id: string }> {
  items: T[];
  onChange: (items: T[]) => void;
  render: (item: T, index: number) => ReactNode;
  label: string;
  onRemove?: (item: T) => void;
}

/**
 * Reorderable list: drag with a mouse (HTML5 drag and drop) or use the ↑/↓ buttons
 * (keyboard and touch friendly — touch drag-and-drop isn't reliable across browsers).
 */
export function SortableList<T extends { id: string }>({ items, onChange, render, label, onRemove }: Props<T>) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  return (
    <ol className="file-list" aria-label={label}>
      {items.map((item, i) => (
        <li
          key={item.id}
          className={`file-item${dragIndex === i ? ' dragging' : ''}${overIndex === i && dragIndex !== i ? ' drop-target' : ''}`}
          draggable
          onDragStart={(e) => {
            setDragIndex(i);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', item.id);
          }}
          onDragOver={(e) => {
            if (dragIndex === null) return;
            e.preventDefault();
            setOverIndex(i);
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (dragIndex !== null && dragIndex !== i) onChange(moveItem(items, dragIndex, i));
            setDragIndex(null);
            setOverIndex(null);
          }}
          onDragEnd={() => {
            setDragIndex(null);
            setOverIndex(null);
          }}
        >
          <span className="drag-handle" aria-hidden="true" title="Drag to reorder">⋮⋮</span>
          {render(item, i)}
          <span className="row nowrap" style={{ gap: 2 }}>
            <button type="button" className="btn ghost small icon" disabled={i === 0} onClick={() => onChange(moveItem(items, i, i - 1))} aria-label={`Move item ${i + 1} up`}>
              ↑
            </button>
            <button type="button" className="btn ghost small icon" disabled={i === items.length - 1} onClick={() => onChange(moveItem(items, i, i + 1))} aria-label={`Move item ${i + 1} down`}>
              ↓
            </button>
            {onRemove && (
              <button type="button" className="btn ghost small icon danger" onClick={() => onRemove(item)} aria-label={`Remove item ${i + 1}`}>
                ✕
              </button>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

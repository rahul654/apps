import { useState } from 'react';
import { MEDIA_BASE } from '../lib/env';
import { formatBytes, formatDateTime, formatWhen } from '../lib/format';
import { categoryOf, ICONS, mediaUrls, type Item } from '../lib/items';

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot > name.length - 8 ? name.slice(dot + 1).toUpperCase() : '';
}

/** One tile in the grid. The checkbox shows only for a signed-in uploader. */
export function ItemCard({
  item,
  selectable,
  selected,
  onToggle,
  onOpen,
}: {
  item: Item;
  selectable: boolean;
  selected: boolean;
  onToggle: (id: string, range: boolean) => void;
  onOpen: (id: string) => void;
}) {
  const cat = categoryOf(item);
  const urls = mediaUrls(item, MEDIA_BASE);
  const [thumbFailed, setThumbFailed] = useState(false);
  const showThumb = urls.thumb && !thumbFailed;

  return (
    <li className={`card cat-${cat}${selected ? ' selected' : ''}`}>
      <button type="button" className="card-open" onClick={() => onOpen(item.id)} aria-label={`Open ${item.name}`}>
        <div className="card-visual">
          {cat === 'text' ? (
            <p className="card-text">{item.preview || ' '}</p>
          ) : showThumb ? (
            <img src={urls.thumb} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setThumbFailed(true)} />
          ) : (
            <span className="card-icon" aria-hidden="true">
              {ICONS[cat]}
              {extensionOf(item.name) && <span className="card-ext">{extensionOf(item.name)}</span>}
            </span>
          )}
          {cat === 'video' && showThumb && (
            <span className="badge-play" aria-hidden="true">
              ▶
            </span>
          )}
        </div>
        <div className="card-meta">
          <span className="card-name" title={item.name}>
            {cat === 'text' ? '📝 ' : ''}
            {item.name}
          </span>
          <span className="card-sub" title={formatDateTime(item.created)}>
            {formatBytes(item.size)} · {formatWhen(item.created)}
          </span>
        </div>
      </button>
      {selectable && (
        <label className="card-check" title={selected ? 'Deselect' : 'Select'}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => {}}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(item.id, e.shiftKey);
            }}
            aria-label={`Select ${item.name}`}
          />
        </label>
      )}
    </li>
  );
}

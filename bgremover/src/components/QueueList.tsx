import { formatMs } from '../lib/format';
import { getModel } from '../lib/models';
import { queueSummary, type QueueItem } from '../lib/queue';
import { useApp } from '../store/AppStore';
import { IconAlert, IconClose, IconReload } from './Icons';

function StatusText({ item }: { item: QueueItem }) {
  const { status, cached, allowed } = useApp();
  switch (item.status) {
    case 'queued': {
      const waitingForConsent = !cached[item.model] && !allowed.has(item.model);
      return <span className="muted">{waitingForConsent ? 'Waiting for model download' : 'Queued'}</span>;
    }
    case 'processing': {
      const label = status.phase === 'downloading' ? 'Downloading model…' : status.phase === 'initialising' ? 'Starting model…' : 'Removing background…';
      return (
        <span className="row tight">
          <span className="spinner" aria-hidden="true" />
          {label}
        </span>
      );
    }
    case 'done':
      return (
        <span className="ok-text">
          Done · {formatMs(item.ms ?? 0)} · {getModel(item.model).name}
        </span>
      );
    case 'error':
      return (
        <span className="error-text row tight">
          <IconAlert size={14} />
          <span className="clip">{item.error}</span>
        </span>
      );
  }
}

export function QueueList() {
  const { queue, dispatch, data, removeItem, rerun, prefs, clearAll } = useApp();
  const sum = queueSummary(queue);
  if (!queue.items.length) return null;
  return (
    <section className="card queue" aria-labelledby="queue-h">
      <div className="row">
        <h2 id="queue-h" className="grow">
          Images <span className="muted small">({sum.done}/{sum.total} done)</span>
        </h2>
        <button type="button" className="btn ghost small" onClick={clearAll}>
          Clear all
        </button>
      </div>
      <p className="sr-only" aria-live="polite">
        {sum.processing ? 'Processing an image.' : ''} {sum.done} of {sum.total} images done{sum.error ? `, ${sum.error} failed` : ''}.
      </p>
      <ul className="queue-list">
        {queue.items.map((item) => {
          const d = data(item.id);
          const thumb = d?.thumbUrl ?? d?.url;
          const selected = queue.selectedId === item.id;
          return (
            <li key={item.id} className={`queue-item${selected ? ' selected' : ''}`}>
              <button type="button" className="queue-main" aria-current={selected ? 'true' : undefined} onClick={() => dispatch({ type: 'select', id: item.id })}>
                <span className={`thumb${d?.thumbUrl ? ' checker' : ''}`}>{thumb && <img src={thumb} alt="" loading="lazy" decoding="async" />}</span>
                <span className="queue-text">
                  <span className="queue-name" title={item.name}>
                    {item.name}
                  </span>
                  <span className="tiny">
                    <StatusText item={item} />
                  </span>
                </span>
              </button>
              {item.status === 'error' && (
                <button type="button" className="btn ghost icon small" onClick={() => rerun([item.id], prefs.model)} aria-label={`Retry ${item.name}`} title="Retry">
                  <IconReload size={15} />
                </button>
              )}
              <button type="button" className="btn ghost icon small" onClick={() => removeItem(item.id)} aria-label={`Remove ${item.name}`} title="Remove">
                <IconClose size={15} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

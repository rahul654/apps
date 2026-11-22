import { useEffect, useState } from 'react';
import { ApiError } from '../lib/api';
import { MEDIA_BASE } from '../lib/env';
import { formatBytes, formatDateTime } from '../lib/format';
import { categoryOf, ICONS, mediaUrls, type Item } from '../lib/items';
import { loadText } from '../store/library';
import { toast } from '../store/toasts';
import { Modal } from './Modal';

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied.`, 'ok');
  } catch {
    toast(`Couldn’t copy the ${what.toLowerCase()}.`, 'error');
  }
}

/** The full view of one item: picture, player, text or file details, with its actions. */
export function ItemViewer({
  item,
  onClose,
  onPrev,
  onNext,
  canDelete,
  onDelete,
}: {
  item: Item;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  canDelete: boolean;
  onDelete: () => void;
}) {
  const cat = categoryOf(item);
  const urls = mediaUrls(item, MEDIA_BASE);

  // ←/→ move between items (not while typing or inside the Drive player).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || (e.target as HTMLElement)?.closest?.('input, textarea')) return;
      if (e.key === 'ArrowLeft' && onPrev) onPrev();
      if (e.key === 'ArrowRight' && onNext) onNext();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onPrev, onNext]);

  return (
    <Modal title={item.name} onClose={onClose} size="lg" className="viewer" initialFocus=".viewer-close">
      <header className="viewer-head">
        <span className="viewer-icon" aria-hidden="true">
          {ICONS[cat]}
        </span>
        <div className="grow">
          <h2 className="viewer-name" title={item.name}>
            {item.name}
          </h2>
          <p className="muted tiny">
            {formatBytes(item.size)} · {formatDateTime(item.created)}
          </p>
        </div>
        <div className="row">
          <button type="button" className="icon-btn" onClick={onPrev} disabled={!onPrev} aria-label="Previous item" title="Previous (←)">
            ‹
          </button>
          <button type="button" className="icon-btn" onClick={onNext} disabled={!onNext} aria-label="Next item" title="Next (→)">
            ›
          </button>
          <button type="button" className="icon-btn viewer-close" onClick={onClose} aria-label="Close" title="Close (Esc)">
            ✕
          </button>
        </div>
      </header>

      <div className={`viewer-body body-${cat}`}>
        {cat === 'text' ? <TextBody item={item} /> : cat === 'image' ? <ImageBody key={item.id} src={urls.full!} fallback={urls.preview} name={item.name} /> : cat === 'other' ? <OtherBody item={item} /> : <iframe key={item.id} src={urls.preview} title={item.name} allow="autoplay; fullscreen" allowFullScreen referrerPolicy="no-referrer" />}
      </div>

      <footer className="viewer-actions">
        {cat === 'text' ? (
          <TextActions item={item} />
        ) : (
          <>
            <a className="btn" href={urls.download} target="_blank" rel="noreferrer">
              ⬇ Download
            </a>
            <a className="btn ghost" href={urls.open} target="_blank" rel="noreferrer">
              Open in Drive ↗
            </a>
          </>
        )}
        <button type="button" className="btn ghost" onClick={() => copy(location.href, 'Link')}>
          🔗 Copy link
        </button>
        {canDelete && (
          <button type="button" className="btn danger-ghost push" onClick={onDelete}>
            🗑 Delete
          </button>
        )}
      </footer>
    </Modal>
  );
}

function ImageBody({ src, fallback, name }: { src: string; fallback: string; name: string }) {
  // Drive's picture service can't show some formats (or a picture still being processed);
  // its viewer page can.
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  if (failed) return <iframe src={fallback} title={name} referrerPolicy="no-referrer" />;
  return (
    <>
      {!loaded && <div className="spinner" aria-label="Loading" />}
      <img src={src} alt={name} referrerPolicy="no-referrer" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} style={loaded ? undefined : { opacity: 0 }} />
    </>
  );
}

function OtherBody({ item }: { item: Item }) {
  return (
    <div className="other">
      <span className="other-icon" aria-hidden="true">
        {ICONS.other}
      </span>
      <p className="muted small">No preview here. Download it, or open it in Google Drive’s viewer.</p>
      <p className="muted tiny mono">{item.mimeType || 'unknown type'}</p>
    </div>
  );
}

/** Text items: loads the full text (the list only has the first 300 characters). */
function useFullText(item: Item) {
  const [state, setState] = useState<{ id: string; text?: string; error?: string }>({ id: item.id });
  useEffect(() => {
    let live = true;
    loadText(item.id).then(
      (text) => live && setState({ id: item.id, text }),
      (err) => live && setState({ id: item.id, error: err instanceof ApiError ? err.message : 'Couldn’t load the text.' }),
    );
    return () => {
      live = false;
    };
  }, [item.id]);
  return state.id === item.id ? state : { id: item.id };
}

function TextBody({ item }: { item: Item }) {
  const { text, error } = useFullText(item);
  if (error) return <p className="error">{error}</p>;
  return <pre className="text-full">{text ?? item.preview ?? ''}</pre>;
}

function TextActions({ item }: { item: Item }) {
  const { text } = useFullText(item);
  const download = () => {
    if (text === undefined) return;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = item.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  return (
    <>
      <button type="button" className="btn primary" onClick={() => text !== undefined && copy(text, 'Text')} disabled={text === undefined}>
        📋 Copy text
      </button>
      <button type="button" className="btn ghost" onClick={download} disabled={text === undefined}>
        ⬇ Download .txt
      </button>
    </>
  );
}

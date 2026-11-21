import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CopyButton } from '../components/CopyButton';
import { isMobile } from '../lib/device';
import { formatBytes, formatDuration, formatSpeed } from '../lib/format';
import { cancelTransfer, disconnect, removeTransfer, resetSession, sendFiles, sendText, useSession, type Transfer } from '../store/session';

function canShareFile(t: Transfer): boolean {
  if (!t.blob || !isMobile() || typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files: [new File([t.blob], t.name, { type: t.mime })] });
  } catch {
    return false;
  }
}

async function shareFile(t: Transfer) {
  try {
    await navigator.share({ files: [new File([t.blob!], t.name, { type: t.mime })] });
  } catch {
    /* dismissed */
  }
}

function Preview({ t }: { t: Transfer }) {
  if (!t.url) return null;
  // Previews use <img>/<video>/<audio> only: an SVG or HTML file can't run scripts there.
  if (t.mime.startsWith('image/')) return <img className="thumb" src={t.url} alt="" loading="lazy" />;
  if (t.mime.startsWith('video/')) return <video className="thumb" src={t.url} controls preload="metadata" />;
  if (t.mime.startsWith('audio/')) return <audio src={t.url} controls preload="none" />;
  return null;
}

function TransferRow({ t }: { t: Transfer }) {
  const pct = t.size ? Math.min(100, Math.round((t.bytes / t.size) * 100)) : 100;
  const eta = t.speed && t.size > t.bytes ? (t.size - t.bytes) / t.speed : null;
  const arrow = t.direction === 'out' ? '↑' : '↓';
  const statusText: Record<Transfer['status'], string> = {
    queued: 'Waiting',
    active: t.direction === 'out' ? 'Sending' : 'Receiving',
    done: t.direction === 'out' ? (t.kind === 'text' || t.delivered ? 'Sent ✓' : 'Sent') : 'Received',
    cancelled: 'Cancelled',
    failed: t.error ? `Failed: ${t.error}` : 'Failed',
  };

  return (
    <li className={`transfer ${t.status}`}>
      <span className={`dir ${t.direction}`} aria-label={t.direction === 'out' ? 'Sent' : 'Received'}>{arrow}</span>
      <div className="transfer-body">
        {t.kind === 'text' ? (
          <div className="text-msg">{t.text}</div>
        ) : (
          <div className="row between">
            <span className="name break" title={t.name}>{t.name}</span>
            <span className="tiny muted nowrap">{formatBytes(t.size)}</span>
          </div>
        )}
        {(t.status === 'active' || t.status === 'queued') && t.kind === 'file' && (
          <>
            <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${t.name} progress`}>
              <span style={{ width: `${pct}%` }} />
            </div>
            <div className="tiny muted">
              {statusText[t.status]} · {pct}%{t.speed ? ` · ${formatSpeed(t.speed)}` : ''}{eta ? ` · ${formatDuration(eta)} left` : ''}
            </div>
          </>
        )}
        {t.status !== 'active' && t.status !== 'queued' && <div className={`tiny ${t.status === 'failed' ? 'error-text' : 'muted'}`}>{statusText[t.status]}</div>}
        {t.status === 'done' && t.direction === 'in' && <Preview t={t} />}
      </div>
      <div className="transfer-actions">
        {(t.status === 'active' || t.status === 'queued') && (
          <button type="button" className="btn small" onClick={() => cancelTransfer(t.id)}>Cancel</button>
        )}
        {t.status === 'done' && t.kind === 'text' && <CopyButton text={t.text ?? ''} className="btn small" />}
        {t.status === 'done' && t.direction === 'in' && t.url && (
          <>
            <a className="btn small primary" href={t.url} download={t.name}>Save</a>
            {canShareFile(t) && <button type="button" className="btn small" onClick={() => void shareFile(t)}>Share</button>}
          </>
        )}
        {t.status !== 'active' && t.status !== 'queued' && (
          <button type="button" className="btn small ghost" onClick={() => removeTransfer(t.id)} aria-label={`Remove ${t.name} from the list`}>✕</button>
        )}
      </div>
    </li>
  );
}

export function SharePage() {
  const s = useSession();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [dragging, setDragging] = useState(false);
  const connected = s.phase === 'connected';

  useEffect(() => {
    if (s.phase !== 'connected' && s.transfers.length === 0) navigate('/', { replace: true });
  }, [s.phase, s.transfers.length, navigate]);

  // Paste files (screenshots, copied files) anywhere outside a text field.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (!connected || target?.closest('textarea, input')) return;
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) {
        e.preventDefault();
        sendFiles(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [connected]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (connected && e.dataTransfer.files.length) sendFiles([...e.dataTransfer.files]);
  };

  const received = s.transfers.filter((t) => t.direction === 'in' && t.status === 'done' && t.kind === 'file').length;

  return (
    <div className="stack-lg" onDragOver={(e) => { e.preventDefault(); if (connected) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      <div className="row between wrap">
        <div>
          <h1 className="tight">{connected ? `Connected${s.peerName ? ` to ${s.peerName}` : ''}` : 'Disconnected'}</h1>
          {connected && s.route && (
            <span className="pill small" title={`This device: ${s.route.local}\nOther device: ${s.route.remote}`}>
              {s.route.label} · direct, encrypted
            </span>
          )}
        </div>
        {connected ? (
          <button type="button" className="btn" onClick={disconnect}>Disconnect</button>
        ) : (
          <div className="row">
            <Link to="/start" className="btn primary">Pair again</Link>
          </div>
        )}
      </div>

      {!connected && (
        <div className="card warn-card small" role="status">
          {s.error ?? 'The connection is closed.'} {received > 0 && 'Files you received are still here until you close this page.'}
        </div>
      )}

      {connected && (
        <section className="card stack">
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) sendFiles([...e.target.files]);
              e.target.value = '';
            }}
          />
          <button type="button" className={`dropzone ${dragging ? 'over' : ''}`} onClick={() => fileInput.current?.click()}>
            <strong>{isMobile() ? 'Choose files to send' : 'Drop files here or click to choose'}</strong>
            <span className="tiny muted">Photos, videos, documents: any size. You can also paste.</span>
          </button>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (sendText(text)) setText('');
            }}
          >
            <textarea className="input grow" rows={2} placeholder="Send text or a link" value={text} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  if (sendText(text)) setText('');
                }
              }}
              aria-label="Text to send"
            />
            <button type="submit" className="btn" disabled={!text.trim()}>Send</button>
          </form>
        </section>
      )}

      {s.transfers.length > 0 && (
        <section className="stack">
          <h2>Transfers</h2>
          <ul className="transfers">
            {s.transfers.map((t) => <TransferRow key={t.id} t={t} />)}
          </ul>
          {!connected && (
            <button type="button" className="btn ghost small" onClick={() => { resetSession(); navigate('/'); }}>Clear everything</button>
          )}
        </section>
      )}
    </div>
  );
}

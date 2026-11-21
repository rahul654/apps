import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorCallout } from '../components/Callout';
import { IconCheck, IconClose, IconImport, IconMic, IconPencil, IconTrash, IconUpload, IconBolt } from '../components/Icons';
import { useCachedModels } from '../components/Settings';
import { StorageMeter } from '../components/StorageMeter';
import type { ErrorInfo } from '../lib/errors';
import { newId } from '../lib/id';
import { modelById } from '../lib/models';
import { parseTranscript, transcriptStore } from '../lib/storage';
import { formatBytes, formatDuration, plural } from '../lib/time';
import type { TranscriptMeta } from '../types';

function SourceIcon({ source }: { source: TranscriptMeta['source'] }) {
  if (source === 'mic') return <IconMic size={16} />;
  if (source === 'dictation') return <IconBolt size={16} />;
  if (source === 'import') return <IconImport size={16} />;
  return <IconUpload size={16} />;
}

function Row({ m }: { m: TranscriptMeta }) {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [title, setTitle] = useState(m.title);
  const input = useRef<HTMLInputElement>(null);
  const renameBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  const save = async () => {
    if (title.trim() && title !== m.title) await transcriptStore.rename(m.id, title);
    setEditing(false);
    requestAnimationFrame(() => renameBtn.current?.focus());
  };
  const model = modelById(m.model);
  return (
    <li className="lib-row">
      <span className="lib-icon" aria-hidden="true">
        <SourceIcon source={m.source} />
      </span>
      <div className="grow stack-xs">
        {editing ? (
          <form
            className="row nowrap"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label className="sr-only" htmlFor={`rename-${m.id}`}>
              New title
            </label>
            <input
              id={`rename-${m.id}`}
              ref={input}
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setTitle(m.title);
                  setEditing(false);
                }
              }}
            />
            <button type="submit" className="btn small icon" aria-label="Save title">
              <IconCheck size={15} />
            </button>
            <button type="button" className="btn small icon ghost" aria-label="Cancel rename" onClick={() => { setTitle(m.title); setEditing(false); }}>
              <IconClose size={15} />
            </button>
          </form>
        ) : (
          <Link to={`/t/${m.id}`} className="lib-title">
            {m.title || 'Untitled'}
          </Link>
        )}
        <span className="muted tiny">
          {new Date(m.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · {formatDuration(m.duration)} · {plural(m.wordCount, 'word')} ·{' '}
          {m.source === 'dictation' ? 'Dictation' : model ? `Whisper ${model.label}` : m.model}
          {m.partial ? ' · partial' : ''}
          {m.hasAudio && m.audioBytes ? ` · audio ${formatBytes(m.audioBytes)}` : ''}
        </span>
      </div>
      {confirm ? (
        <div className="row nowrap" role="group" aria-label={`Delete ${m.title}?`}>
          <span className="small">Delete?</span>
          <button type="button" className="btn small danger" onClick={() => void transcriptStore.remove(m.id)} autoFocus>
            Delete
          </button>
          <button type="button" className="btn small ghost" onClick={() => setConfirm(false)}>
            Keep
          </button>
        </div>
      ) : (
        <div className="row nowrap">
          <button ref={renameBtn} type="button" className="btn ghost icon small" onClick={() => setEditing(true)} aria-label={`Rename ${m.title}`} title="Rename">
            <IconPencil size={16} />
          </button>
          <button type="button" className="btn ghost icon small" onClick={() => setConfirm(true)} aria-label={`Delete ${m.title}`} title="Delete">
            <IconTrash size={16} />
          </button>
        </div>
      )}
    </li>
  );
}

export function LibraryPage() {
  const [items, setItems] = useState<TranscriptMeta[] | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [version, setVersion] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const models = useCachedModels(version);
  const modelBytes = (models ?? []).reduce((s, m) => s + m.bytes, 0);

  const load = useCallback(() => {
    transcriptStore
      .list()
      .then((l) => {
        setItems(l);
        setVersion((v) => v + 1);
      })
      .catch((e) => {
        setItems([]);
        setError({ title: 'Can’t open the library', message: (e as Error)?.message ?? 'IndexedDB is unavailable (private browsing?).', canRetry: true });
      });
  }, []);

  useEffect(() => {
    document.title = 'Library · Speech to Text';
    load();
    return transcriptStore.subscribe(load);
  }, [load]);

  const importJson = async (f: File) => {
    setError(null);
    try {
      const data = JSON.parse(await f.text());
      const now = Date.now();
      const t = parseTranscript(data, { id: newId(), title: f.name.replace(/\.json$/i, ''), createdAt: now, updatedAt: now, source: 'import', hasAudio: false });
      if (!t || !t.segments.length) throw new Error('No segments found. Import a JSON file exported from this app.');
      await transcriptStore.put({ ...t, id: newId(), hasAudio: false, updatedAt: now });
    } catch (e) {
      setError({ title: 'Couldn’t import that file', message: e instanceof SyntaxError ? 'It isn’t valid JSON.' : (e as Error).message, canRetry: false });
    }
  };

  return (
    <div className="page">
      <header className="page-head row">
        <h1 className="grow">Library</h1>
        <button type="button" className="btn small" onClick={() => fileInput.current?.click()}>
          <IconImport size={15} /> Import JSON
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void importJson(f);
          }}
        />
      </header>
      <p className="muted small">Transcripts and their audio are stored in this browser only (IndexedDB). Clearing site data deletes them.</p>
      <StorageMeter refreshKey={version} extra={modelBytes ? `models ${formatBytes(modelBytes)}` : undefined} />
      {error && <ErrorCallout error={error} onRetry={load} />}
      {items === null ? (
        <p className="muted">Loading…</p>
      ) : items.length === 0 ? (
        <div className="card stack-sm">
          <p>No transcripts yet.</p>
          <Link to="/" className="btn primary self-start">
            Transcribe something
          </Link>
        </div>
      ) : (
        <ul className="lib-list" aria-label="Transcripts">
          {items.map((m) => (
            <Row key={`${m.id}:${m.title}`} m={m} />
          ))}
        </ul>
      )}
    </div>
  );
}

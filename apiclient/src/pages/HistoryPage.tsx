import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ResponsePanel } from '../components/ResponsePanel';
import { MethodTag, StatusBadge } from '../components/ui';
import { IconTrash } from '../components/Icons';
import type { ExecResult } from '../lib/execute';
import { formatBytes, formatMs, formatTime } from '../lib/format';
import { useAppStore } from '../store/AppStore';
import type { HistoryEntry } from '../types';

/** Rebuilds a response-panel result from a stored history entry. */
export function historyToResult(h: HistoryEntry): ExecResult {
  return {
    prepared: { method: h.method, url: h.url, headers: h.request.headers, body: h.request.body === null ? { kind: 'none' } : { kind: 'text', text: h.request.body, contentType: null }, missing: [], warnings: [] },
    response: { ok: h.ok, status: h.status, statusText: h.statusText, headers: h.response.headers, bodyText: h.response.bodyText, binary: h.response.binary, size: h.size, time: h.time, timings: h.timings, contentType: h.response.contentType, via: h.via, truncated: h.response.truncated, setCookie: h.response.setCookie, ...(h.error ? { error: h.error as ExecResult['response']['error'] } : {}) },
    tests: [],
    console: [],
    scriptErrors: [],
    changes: { local: {} },
    history: h,
  };
}

export default function HistoryPage() {
  const { state, dispatch } = useAppStore();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const list = state.history.filter((h) => !q || `${h.method} ${h.url} ${h.requestName ?? ''} ${h.status}`.toLowerCase().includes(q.toLowerCase()));
  const sel = list.find((h) => h.id === open) ?? null;
  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div className="stack-sm">
            <h1>History</h1>
            <p className="muted small">Every send is recorded here (last {state.prefs.historyLimit}). Bodies are kept up to 512 KB. Pick two entries on the <Link to="/compare">Compare</Link> page to diff them.</p>
          </div>
          <div className="row">
            <input className="input compact" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter history" />
            <button type="button" className="btn small danger" disabled={!state.history.length} onClick={() => window.confirm('Clear all history?') && dispatch({ type: 'history/clear' })}>
              Clear
            </button>
          </div>
        </div>
        <div className="table-wrap card tight">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Request</th>
                <th>Status</th>
                <th className="n">Time</th>
                <th className="n">Size</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {list.map((h) => (
                <tr key={h.id} className={h.id === open ? 'selectable selected' : 'selectable'} onClick={() => setOpen(h.id === open ? null : h.id)}>
                  <td className="small" style={{ whiteSpace: 'nowrap' }}>{formatTime(h.at)}</td>
                  <td>
                    <div className="row nowrap">
                      <MethodTag method={h.method} />
                      <span className="ellipsis mono small" title={h.url} style={{ maxWidth: 420 }}>{h.url}</span>
                    </div>
                    {h.requestName && <div className="tiny muted">{h.requestName}{h.runId ? ' · runner' : ''}</div>}
                  </td>
                  <td>{h.error ? <span className="pill err">{h.error.kind}</span> : <StatusBadge status={h.status} />}</td>
                  <td className="n">{formatMs(h.time)}</td>
                  <td className="n">{formatBytes(h.size)}</td>
                  <td>
                    <button type="button" className="btn ghost small icon" aria-label="Delete entry" onClick={(e) => {
                      e.stopPropagation();
                      dispatch({ type: 'history/remove', id: h.id });
                    }}>
                      <IconTrash size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {!list.length && (
                <tr>
                  <td colSpan={6} className="muted small">{state.history.length ? 'Nothing matches the filter.' : 'No requests sent yet.'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {sel && (
          <div className="stack-sm">
            <div className="row">
              <h2>
                <MethodTag method={sel.method} /> <span className="mono small break">{sel.url}</span>
              </h2>
              <span className="spacer" />
              {sel.collectionId && sel.requestId && <Link to={`/r/${sel.collectionId}/${sel.requestId}`} className="btn small">Open request</Link>}
              <Link to={`/compare?a=${sel.id}`} className="btn small">Compare…</Link>
            </div>
            {sel.request.body && (
              <details>
                <summary className="small muted">Request body</summary>
                <pre className="codeview">{sel.request.body}</pre>
              </details>
            )}
            <ResponsePanel result={historyToResult(sel)} sending={false} />
          </div>
        )}
      </div>
    </div>
  );
}

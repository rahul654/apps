import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ExecResult } from '../lib/execute';
import { formatBytes, formatMs } from '../lib/format';
import { prettifyJsonText } from '../lib/jsonText';
import { forbiddenHeaders } from '../lib/request/build';
import { CodeEditor, type CodeEditorApi, type CodeLanguage } from './code/CodeEditor';
import { IconCheck, IconClose, IconSearch, IconWarn } from './Icons';
import { ProxyControl } from './ProxyControl';
import { StatusBadge, Tabs } from './ui';

/** Above this size the response viewer skips pretty printing, highlighting and folding, so it stays responsive. */
export const LARGE_BODY = 1024 * 1024;

function languageFor(contentType: string, text: string): CodeLanguage {
  if (/json/i.test(contentType)) return 'json';
  if (/html/i.test(contentType)) return 'html';
  if (/xml/i.test(contentType)) return 'xml';
  if (/javascript/i.test(contentType)) return 'javascript';
  return /^\s*[[{]/.test(text) ? 'json' : 'text';
}

/** Read-only CodeMirror view of a body with pretty/raw, wrap, find and fold. */
export function BodyViewer({ text, contentType = '', binary = false, size, truncated = false, ariaLabel = 'Response body', defaultWrap = true }: { text: string; contentType?: string; binary?: boolean; size?: number; truncated?: boolean; ariaLabel?: string; defaultWrap?: boolean }) {
  const [pretty, setPretty] = useState(true);
  const [wrap, setWrap] = useState(defaultWrap);
  const api = useRef<CodeEditorApi>(null);
  const large = text.length > LARGE_BODY;
  const lang = binary ? 'text' : languageFor(contentType, text);
  // Token-based pretty printing keeps numbers exactly as sent (no big-int rounding).
  const prettyText = useMemo(() => (binary || large || lang !== 'json' || !text ? null : prettifyJsonText(text).text), [binary, large, lang, text]);
  const shown = binary ? `[binary content, ${formatBytes(size ?? text.length)}${contentType ? `, ${contentType}` : ''}]` : pretty && prettyText !== null ? prettyText : text;
  return (
    <div className="stack-sm">
      <div className="row">
        <div className="segmented" role="group" aria-label="Body view">
          <button type="button" aria-pressed={pretty && prettyText !== null} onClick={() => setPretty(true)} disabled={prettyText === null}>
            Pretty
          </button>
          <button type="button" aria-pressed={!pretty || prettyText === null} onClick={() => setPretty(false)}>
            Raw
          </button>
        </div>
        <label className="check small">
          <input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} /> Wrap
        </label>
        <button type="button" className="btn ghost small" onClick={() => api.current?.openSearch()} title="Find in body (Ctrl+F inside the body)">
          <IconSearch size={14} /> Find
        </button>
        {!large && !binary && (
          <>
            <button type="button" className="btn ghost small" onClick={() => api.current?.foldAll()}>
              Fold all
            </button>
            <button type="button" className="btn ghost small" onClick={() => api.current?.unfoldAll()}>
              Unfold
            </button>
          </>
        )}
        {truncated && <span className="pill warn">truncated for display</span>}
        <span className="tiny muted">{contentType}</span>
      </div>
      {large && !binary && <p className="tiny muted note-inline">Large body ({formatBytes(text.length)}): pretty printing, highlighting and folding are off to keep the viewer responsive.</p>}
      <CodeEditor apiRef={api} value={shown} readOnly language={lang} rich={!large && !binary} wrap={wrap} ariaLabel={ariaLabel} maxHeight="60vh" />
    </div>
  );
}

type Tab = 'body' | 'headers' | 'cookies' | 'tests' | 'console' | 'timing';

export function ResponsePanel({ result, sending, onSaveExample, onCancel }: { result: ExecResult | null; sending: boolean; onSaveExample?: () => void; onCancel?: () => void }) {
  const [tab, setTab] = useState<Tab>('body');
  if (sending) {
    return (
      <section className="card response" aria-live="polite">
        <div className="row">
          <span className="spinner" aria-hidden="true" /> Sending…
          {onCancel && (
            <button type="button" className="btn small" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </section>
    );
  }
  if (!result) {
    return (
      <section className="card response">
        <p className="muted small">
          Send a request to see the response here. <kbd>Ctrl</kbd>+<kbd>Enter</kbd> sends, <kbd>Ctrl</kbd>+<kbd>S</kbd> saves.
        </p>
      </section>
    );
  }
  const { response: r, tests, console: logs, scriptErrors, prepared } = result;
  const failed = tests.filter((t) => !t.passed).length;
  const forbidden = forbiddenHeaders(prepared.headers);
  return (
    <section className="card response" aria-live="polite" aria-label="Response">
      {r.error && (
        <div className={r.error.kind === 'abort' ? 'note info' : 'note error'} role="alert">
          <IconWarn size={16} />
          <div className="stack-sm">
            <strong>{r.error.kind === 'cors' ? 'The browser blocked this request (CORS or network)' : r.error.kind === 'proxy' ? 'Proxy problem' : r.error.kind === 'abort' ? 'Cancelled' : 'Request failed'}</strong>
            <span>{r.error.message}</span>
            {r.error.kind === 'cors' && (
              <>
                <span>
                  A web page can only call APIs that answer with CORS headers for this origin; the browser hides whether it was CORS, DNS, TLS or a refused connection. For any other server, use the <Link to="/proxy">local proxy</Link>: start it here, then send again.
                </span>
                <ProxyControl compact />
              </>
            )}
          </div>
        </div>
      )}
      {!r.error && (
        <div className="response-meta">
          <StatusBadge status={r.status} text={r.statusText} />
          <span>{formatMs(r.time)}</span>
          <span>{formatBytes(r.size)}</span>
          <span className="pill muted">{r.via === 'proxy' ? 'via proxy' : 'direct'}</span>
          {tests.length > 0 && <span className={failed ? 'pill err' : 'pill ok'}>{failed ? `${failed} of ${tests.length} tests failed` : `${tests.length} tests passed`}</span>}
          <span className="spacer" />
          {onSaveExample && (
            <button type="button" className="btn small" onClick={onSaveExample}>
              Save as example
            </button>
          )}
        </div>
      )}
      {forbidden.length > 0 && r.via === 'direct' && (
        <div className="note warn">
          <IconWarn size={16} />
          <span>
            The browser does not let a page set {forbidden.join(', ')}; those headers were dropped. Use the <Link to="/proxy">proxy</Link> to send them.
          </span>
        </div>
      )}
      {prepared.missing.length > 0 && (
        <div className="note warn">
          <IconWarn size={16} />
          <span>Unresolved variables: {prepared.missing.map((m) => `{{${m}}}`).join(', ')}</span>
        </div>
      )}
      {prepared.warnings.map((w) => (
        <div className="note warn" key={w}>
          <IconWarn size={16} />
          <span>{w}</span>
        </div>
      ))}
      {scriptErrors.map((e, i) => (
        <div className="note error" key={i} role="alert">
          <IconWarn size={16} />
          <span>{e}</span>
        </div>
      ))}
      <Tabs<Tab>
        label="Response sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'body', label: 'Body' },
          { id: 'headers', label: <>Headers <span className="pill muted">{r.headers.length}</span></> },
          { id: 'cookies', label: <>Cookies {r.setCookie?.length ? <span className="pill muted">{r.setCookie.length}</span> : null}</> },
          { id: 'tests', label: <>Tests {tests.length ? <span className={failed ? 'pill err' : 'pill ok'}>{tests.length - failed}/{tests.length}</span> : null}</> },
          { id: 'console', label: <>Console {logs.length ? <span className="pill muted">{logs.length}</span> : null}</> },
          { id: 'timing', label: 'Timing' },
        ]}
      />
      <div className="tabpanel" role="tabpanel">
        {tab === 'body' && <BodyViewer text={r.bodyText} contentType={r.contentType} binary={r.binary} size={r.size} truncated={r.truncated} />}
        {tab === 'headers' && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Header</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {r.headers.map((h, i) => (
                  <tr key={i}>
                    <td className="mono">{h.key}</td>
                    <td className="mono break">{h.value}</td>
                  </tr>
                ))}
                {!r.headers.length && (
                  <tr>
                    <td colSpan={2} className="muted">No headers readable. In direct mode the browser only exposes CORS-safelisted headers unless the server sends Access-Control-Expose-Headers.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {tab === 'cookies' && (
          <div className="stack-sm">
            {r.setCookie?.length ? (
              <ul className="list">
                {r.setCookie.map((c, i) => (
                  <li key={i} className="mono small break">{c}</li>
                ))}
              </ul>
            ) : (
              <p className="small muted">{r.via === 'proxy' ? 'The server did not set any cookies.' : 'Browsers never expose Set-Cookie to page scripts. Send through the local proxy to see cookies.'}</p>
            )}
          </div>
        )}
        {tab === 'tests' && (
          <ul className="tests-list">
            {tests.map((t, i) => (
              <li key={i} className={t.passed ? 'pass' : 'fail'}>
                {t.passed ? <IconCheck size={16} className="ok" /> : <IconClose size={16} className="error-text" />}
                <span>
                  {t.name}
                  {t.error && <span className="muted"> — {t.error}</span>}
                </span>
              </li>
            ))}
            {!tests.length && <li className="muted small">No tests ran. Add pm.test(…) calls in the Scripts tab.</li>}
          </ul>
        )}
        {tab === 'console' && (
          <div className="console" aria-label="Script console">
            {logs.map((l, i) => (
              <div key={i} className={l.level}>
                <span className="muted">[{l.level}] </span>
                {l.args.join(' ')}
              </div>
            ))}
            {!logs.length && <span className="muted">Nothing logged. console.log(…) in scripts shows up here.</span>}
          </div>
        )}
        {tab === 'timing' && <TimingView timings={r.timings} />}
      </div>
    </section>
  );
}

export function TimingView({ timings }: { timings: ExecResult['response']['timings'] }) {
  const phases: [string, number | undefined][] = [
    ['DNS', timings.dns],
    ['Connect', timings.connect],
    ['TLS', timings.tls],
    ['Waiting (TTFB)', timings.ttfb],
    ['Download', timings.download],
  ];
  const known = phases.filter((p): p is [string, number] => typeof p[1] === 'number');
  const max = Math.max(timings.total, 1);
  return (
    <div className="stack-sm">
      <div className="timing">
        {known.map(([name, v]) => (
          <div key={name} style={{ display: 'contents' }}>
            <span>{name}</span>
            <div className="timing-bar" style={{ width: `${Math.max(1, (v / max) * 100)}%` }} aria-hidden="true" />
            <span className="mono small">{formatMs(v)}</span>
          </div>
        ))}
        <strong>Total</strong>
        <span />
        <strong className="mono small">{formatMs(timings.total)}</strong>
      </div>
      <p className="tiny muted">
        {timings.source === 'proxy' ? 'Measured by the local proxy.' : timings.source === 'resource-timing' ? 'From the browser Resource Timing API (the server sent Timing-Allow-Origin).' : 'Browser fetch only exposes wall-clock time; DNS/connect/TLS need the local proxy or a Timing-Allow-Origin header.'}
      </p>
    </div>
  );
}

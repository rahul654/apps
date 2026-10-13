import { useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { CodeArea } from '../components/CodeArea';
import { Checkbox, Notice, Segmented, Toolbar } from '../components/Controls';
import { CopyButton } from '../components/CopyButton';
import { JsonTree } from '../components/JsonTree';
import { ToolPage } from '../components/ToolPage';
import { useMemoryState } from '../hooks/memoryState';
import { oneOf, usePref } from '../hooks/prefs';
import { useCompute } from '../hooks/useCompute';
import { sizeDelay } from '../hooks/useDebounced';
import { downloadBlob } from '../lib/clipboard';
import { diffReport, previewJson, type JsonError } from '../lib/json';
import type { JsonDiffReq, JsonFormatReq } from '../workers/protocol';

const SAMPLE = `{"name":"dev-tools","version":"1.0.0","private":true,"tags":["json","format"],"author":{"name":"Ada Lovelace","email":"ada@example.com"},"scripts":{"build":"vite build","test":"vitest"},"stats":{"stars":42,"ratio":0.98,"lastRelease":null}}`;
const SAMPLE_LEFT = `{\n  "id": 7,\n  "name": "Widget",\n  "price": 9.99,\n  "tags": ["a", "b"],\n  "owner": { "name": "Ada", "active": true }\n}`;
const SAMPLE_RIGHT = `{\n  "id": 7,\n  "name": "Widget Pro",\n  "price": "9.99",\n  "tags": ["a", "b", "c"],\n  "owner": { "name": "Ada" },\n  "stock": 12\n}`;

type Indent = 2 | 4 | 'tab';

function ErrorNotice({ error, onGoto, side }: { error: JsonError; onGoto?: () => void; side?: string }) {
  return (
    <Notice kind="error" title={`${side ? `${side}: ` : ''}Invalid JSON at line ${error.line}, column ${error.column}.`}>
      {error.message}{' '}
      {onGoto && (
        <button type="button" className="link-btn" onClick={onGoto}>
          Go to error
        </button>
      )}
    </Notice>
  );
}

function gotoOffset(ta: HTMLTextAreaElement | null, offset: number) {
  if (!ta) return;
  ta.focus();
  ta.setSelectionRange(offset, Math.min(offset + 1, ta.value.length));
  // Scroll roughly to the line.
  const line = ta.value.slice(0, offset).split('\n').length;
  const lh = parseFloat(getComputedStyle(ta).lineHeight) || 18;
  ta.scrollTop = Math.max(0, (line - 3) * lh);
}

function FormatMode() {
  const [text, setText] = useMemoryState('json:text', '');
  const [indent, setIndent] = usePref<Indent>('json.indent', 2, oneOf(2, 4, 'tab'));
  const [sortKeys, setSortKeys] = usePref('json.sortKeys', false, oneOf(true, false));
  const [mode, setMode] = usePref<'pretty' | 'minify' | 'tree'>('json.view', 'pretty', oneOf('pretty', 'minify', 'tree'));
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const payload = useMemo<JsonFormatReq | null>(
    () => (text.trim() === '' ? null : { text, indent, sortKeys, minify: mode === 'minify', wantValue: mode === 'tree' }),
    [text, indent, sortKeys, mode],
  );
  const { result, error, busy } = useCompute('json', payload, { delay: Math.max(80, sizeDelay(text.length)) });
  const output = result?.ok ? result.output : '';
  const big = text.length > 1_000_000;

  return (
    <>
      <Toolbar>
        <Segmented
          label="Output"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'pretty', label: 'Pretty' },
            { value: 'minify', label: 'Minify' },
            { value: 'tree', label: 'Tree' },
          ]}
        />
        <Segmented
          label="Indent"
          value={indent}
          onChange={setIndent}
          options={[
            { value: 2, label: '2 spaces' },
            { value: 4, label: '4 spaces' },
            { value: 'tab', label: 'Tab' },
          ]}
        />
        <Checkbox label="Sort keys" checked={sortKeys} onChange={setSortKeys} />
      </Toolbar>

      <div className="status-line" aria-live="polite">
        {busy && <span className="muted">Processing…</span>}
        {!busy && result?.ok && <Notice kind="ok">Valid JSON</Notice>}
        {!busy && result && !result.ok && <ErrorNotice error={result.error} onGoto={() => gotoOffset(inputRef.current, result.error.offset)} />}
        {!busy && error && <Notice kind="error">{error}</Notice>}
      </div>

      <div className="panes">
        <CodeArea
          ref={inputRef}
          label="Input JSON"
          value={text}
          onChange={setText}
          onSample={() => setText(SAMPLE)}
          onClear={() => setText('')}
          placeholder="Paste JSON here…"
          rows={18}
          invalid={result ? !result.ok : false}
          wrap={!big}
        />
        {mode === 'tree' ? (
          <div className="code-area">
            <div className="code-area-head">
              <span className="control-label">Tree</span>
              <div className="code-area-actions">
                <CopyButton text={() => (result?.ok ? JSON.stringify(result.value, null, indent === 'tab' ? '\t' : indent) : '')} disabled={!result?.ok} ariaLabel="Copy formatted JSON" />
              </div>
            </div>
            <div className="tree-box">{result?.ok ? <JsonTree value={result.value} defaultDepth={big ? 1 : 2} /> : <p className="muted pad">Valid JSON will appear here as a collapsible tree.</p>}</div>
          </div>
        ) : (
          <CodeArea
            label={mode === 'minify' ? 'Minified' : 'Formatted'}
            value={output}
            rows={18}
            wrap={!big && mode !== 'minify'}
            actions={
              <button type="button" className="btn btn-sm btn-ghost" disabled={!output} onClick={() => downloadBlob(output, 'formatted.json', 'application/json')}>
                Download
              </button>
            }
          />
        )}
      </div>
      <p className="muted small">Numbers beyond 2^53 lose precision (they are parsed as JavaScript numbers). Large inputs are processed in a background worker.</p>
    </>
  );
}

function DiffMode() {
  const [left, setLeft] = useMemoryState('json:left', '');
  const [right, setRight] = useMemoryState('json:right', '');
  const payload = useMemo<JsonDiffReq | null>(() => (left.trim() && right.trim() ? { left, right } : null), [left, right]);
  const { result, error, busy } = useCompute('jsonDiff', payload, { delay: Math.max(100, sizeDelay(left.length + right.length)) });
  const entries = result?.entries ?? [];
  const counts = { added: 0, removed: 0, changed: 0 };
  for (const e of entries) counts[e.kind]++;

  return (
    <>
      <Toolbar>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setLeft(SAMPLE_LEFT);
            setRight(SAMPLE_RIGHT);
          }}
        >
          Sample
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setLeft(right);
            setRight(left);
          }}
        >
          ⇄ Swap
        </button>
      </Toolbar>
      <div className="panes">
        <CodeArea label="Original" value={left} onChange={setLeft} onClear={() => setLeft('')} rows={14} placeholder="Original JSON…" invalid={!!result?.leftError} />
        <CodeArea label="Modified" value={right} onChange={setRight} onClear={() => setRight('')} rows={14} placeholder="Modified JSON…" invalid={!!result?.rightError} />
      </div>
      <div aria-live="polite">
        {busy && <p className="muted">Comparing…</p>}
        {error && <Notice kind="error">{error}</Notice>}
        {result?.leftError && <ErrorNotice side="Original" error={result.leftError} />}
        {result?.rightError && <ErrorNotice side="Modified" error={result.rightError} />}
      </div>
      {result && !result.leftError && !result.rightError && (
        <section className="card" aria-label="Differences">
          <div className="card-head">
            <h2 className="card-title">
              {entries.length === 0 ? (
                'No differences — the documents are structurally equal'
              ) : (
                <>
                  <span className="badge badge-add">+{counts.added} added</span> <span className="badge badge-del">−{counts.removed} removed</span> <span className="badge badge-chg">~{counts.changed} changed</span>
                </>
              )}
            </h2>
            <CopyButton text={() => diffReport(entries)} disabled={entries.length === 0} label="Copy report" />
          </div>
          {result.truncated && <Notice kind="warn">Showing the first {entries.length.toLocaleString()} differences.</Notice>}
          {entries.length > 0 && (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Change</th>
                    <th scope="col">Path</th>
                    <th scope="col">Before</th>
                    <th scope="col">After</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.slice(0, 2000).map((e, i) => (
                    <tr key={i} className={`row-${e.kind}`}>
                      <td>
                        <span className={`badge badge-${e.kind === 'added' ? 'add' : e.kind === 'removed' ? 'del' : 'chg'}`}>{e.kind}</span>
                      </td>
                      <td className="mono">{e.path}</td>
                      <td className="mono">{e.kind === 'added' ? '' : previewJson(e.before)}</td>
                      <td className="mono">{e.kind === 'removed' ? '' : previewJson(e.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted small">Objects are compared by key and arrays by index.</p>
        </section>
      )}
    </>
  );
}

export default function JsonTool() {
  const mode = useParams()['*'];
  return (
    <ToolPage
      title="JSON"
      icon="{ }"
      description="Format, minify and validate JSON, browse it as a tree, or compare two documents."
      tabs={[
        { to: '/json', label: 'Format & validate' },
        { to: '/json/diff', label: 'JSON diff' },
      ]}
    >
      {mode === 'diff' ? <DiffMode /> : <FormatMode />}
    </ToolPage>
  );
}

import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { CodeArea } from '../components/CodeArea';
import { Checkbox, Notice, Segmented, Toolbar } from '../components/Controls';
import { CopyButton } from '../components/CopyButton';
import { ToolPage } from '../components/ToolPage';
import { ValueTable } from '../components/ValueTable';
import { useMemoryState } from '../hooks/memoryState';
import { oneOf, usePref } from '../hooks/prefs';
import { parseUrl, urlDecode, urlEncode, withParams, type UrlMode } from '../lib/url';

const SAMPLE_URL = 'https://user@api.example.com:8443/v1/search?q=hello%20world&lang=en&tags=a&tags=b#results';

function EncodeMode() {
  const [dir, setDir] = usePref<'encode' | 'decode'>('url.dir', 'encode', oneOf('encode', 'decode'));
  const [mode, setMode] = usePref<UrlMode>('url.mode', 'component', oneOf('component', 'uri'));
  const [plus, setPlus] = usePref('url.plus', false, oneOf(true, false));
  const [input, setInput] = useMemoryState('url:text', '');

  const result = useMemo(() => {
    if (!input) return { output: '' };
    try {
      return { output: dir === 'encode' ? urlEncode(input, mode, plus) : urlDecode(input, mode, plus) };
    } catch (e) {
      return { output: '', error: e instanceof Error ? e.message : String(e) };
    }
  }, [input, dir, mode, plus]);

  return (
    <>
      <Toolbar>
        <Segmented
          label="Direction"
          value={dir}
          onChange={setDir}
          options={[
            { value: 'encode', label: 'Encode' },
            { value: 'decode', label: 'Decode' },
          ]}
        />
        <Segmented
          label="Scope"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'component', label: 'Component', title: 'encodeURIComponent: escapes / ? & = # too — for a single query value or path segment' },
            { value: 'uri', label: 'Full URI', title: 'encodeURI: keeps URL structure characters like / ? & = #' },
          ]}
        />
        <Checkbox label={dir === 'encode' ? 'Spaces as +' : 'Treat + as space'} checked={plus} onChange={setPlus} title="application/x-www-form-urlencoded style" />
        <button
          type="button"
          className="btn"
          disabled={!result.output}
          onClick={() => {
            setInput(result.output);
            setDir(dir === 'encode' ? 'decode' : 'encode');
          }}
        >
          ⇄ Use output as input
        </button>
      </Toolbar>
      {result.error && <Notice kind="error">{result.error}</Notice>}
      <div className="panes">
        <CodeArea
          label={dir === 'encode' ? 'Text' : 'Encoded'}
          value={input}
          onChange={setInput}
          onSample={() => setInput(dir === 'encode' ? 'name=Jöhn Doe & co/50% off?' : 'name%3DJ%C3%B6hn%20Doe%20%26%20co%2F50%25%20off%3F')}
          onClear={() => setInput('')}
          rows={8}
          invalid={!!result.error}
        />
        <CodeArea label={dir === 'encode' ? 'Encoded' : 'Decoded'} value={result.output} rows={8} />
      </div>
      <p className="muted small">
        <strong>Component</strong> escapes everything except <code>A–Z a–z 0–9 - _ . ! ~ * ' ( )</code>; use it for individual values. <strong>Full URI</strong> keeps <code>; , / ? : @ &amp; = + $ #</code>.
      </p>
    </>
  );
}

function ParseMode() {
  const [input, setInput] = useMemoryState('url:parse', '');
  const parsed = useMemo(() => {
    if (!input.trim()) return null;
    try {
      return { url: parseUrl(input) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [input]);
  const url = parsed && 'url' in parsed ? parsed.url : undefined;

  const setParams = (params: [string, string][]) => {
    if (url) setInput(withParams(url.href, params));
  };

  return (
    <>
      <CodeArea label="URL" value={input} onChange={setInput} onSample={() => setInput(SAMPLE_URL)} onClear={() => setInput('')} rows={3} copy placeholder="https://example.com/path?key=value#hash" invalid={!!parsed && !url} />
      {parsed && 'error' in parsed && <Notice kind="error">{parsed.error}</Notice>}
      {url && (
        <>
          {url.assumedScheme && <Notice kind="info">No scheme given — assuming https://.</Notice>}
          <section className="card" aria-labelledby="parts-h">
            <h2 id="parts-h" className="card-title">
              Parts
            </h2>
            <ValueTable
              caption="URL parts"
              rows={[
                { label: 'Protocol', value: url.protocol },
                { label: 'Origin', value: url.origin },
                { label: 'Username', value: url.username },
                { label: 'Password', value: url.password },
                { label: 'Host', value: url.host },
                { label: 'Hostname', value: url.hostname },
                { label: 'Port', value: url.port || '(default)' },
                { label: 'Path', value: url.pathname },
                { label: 'Path (decoded)', value: safeDecode(url.pathname) },
                { label: 'Query', value: url.search },
                { label: 'Fragment', value: url.hash },
              ].filter((r) => r.value !== '')}
            />
          </section>
          <section className="card" aria-labelledby="params-h">
            <div className="card-head">
              <h2 id="params-h" className="card-title">
                Query parameters ({url.params.length})
              </h2>
              <button type="button" className="btn btn-sm" onClick={() => setParams([...url.params, ['', '']])}>
                + Add parameter
              </button>
            </div>
            {url.params.length === 0 ? (
              <p className="muted">No query parameters.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table params-table">
                  <thead>
                    <tr>
                      <th scope="col">Key</th>
                      <th scope="col">Value (decoded)</th>
                      <th scope="col">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {url.params.map(([k, v], i) => (
                      <tr key={i}>
                        <td>
                          <input aria-label={`Parameter ${i + 1} key`} className="mono" value={k} onChange={(e) => setParams(url.params.map((p, j) => (j === i ? [e.target.value, p[1]] : p)))} />
                        </td>
                        <td>
                          <input aria-label={`Parameter ${i + 1} value`} className="mono" value={v} onChange={(e) => setParams(url.params.map((p, j) => (j === i ? [p[0], e.target.value] : p)))} />
                        </td>
                        <td className="actions-cell">
                          <CopyButton text={v} ariaLabel={`Copy value of ${k || `parameter ${i + 1}`}`} />
                          <button type="button" className="btn btn-sm btn-ghost" aria-label={`Remove parameter ${k || i + 1}`} onClick={() => setParams(url.params.filter((_, j) => j !== i))}>
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted small">Editing a parameter rebuilds the URL above (spaces are serialised as +).</p>
          </section>
        </>
      )}
    </>
  );
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export default function UrlTool() {
  const mode = useParams()['*'];
  return (
    <ToolPage
      title="URL"
      icon="%"
      description="Percent-encode and decode text, or parse a URL into its parts and edit its query parameters."
      tabs={[
        { to: '/url', label: 'Encode / decode' },
        { to: '/url/parse', label: 'Parse & edit' },
      ]}
    >
      {mode === 'parse' ? <ParseMode /> : <EncodeMode />}
    </ToolPage>
  );
}

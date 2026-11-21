import { useMemo, type ReactNode } from 'react';
import { CodeArea } from '../components/CodeArea';
import { Checkbox, Field, Notice } from '../components/Controls';
import { CopyButton } from '../components/CopyButton';
import { ToolPage } from '../components/ToolPage';
import { useMemoryState } from '../hooks/memoryState';
import { useCompute } from '../hooks/useCompute';
import { highlightSegments, REGEX_FLAGS, type RegexRequest } from '../lib/regex';

const FLAG_INFO: Record<string, string> = {
  g: 'global — find all matches',
  i: 'ignore case',
  m: 'multiline — ^ and $ match at line breaks',
  s: 'dotAll — . matches newlines',
  u: 'unicode',
  v: 'unicode sets (newer browsers)',
  y: 'sticky — match only at lastIndex',
};

const SAMPLE = {
  pattern: '(?<user>[\\w.+-]+)@(?<domain>[\\w-]+\\.[\\w.]+)',
  flags: 'g',
  text: 'Contact ada@example.com or grace.hopper+navy@mail.example.org.\nInvalid: bob@ and @nowhere.',
  replacement: '$<user> [at] $<domain>',
};

const TIMEOUT_MS = 1500;

export default function RegexTool() {
  const [pattern, setPattern] = useMemoryState('regex:pattern', '');
  const [flags, setFlags] = useMemoryState('regex:flags', 'g');
  const [text, setText] = useMemoryState('regex:text', '');
  const [replacement, setReplacement] = useMemoryState('regex:replacement', '');
  const [useReplace, setUseReplace] = useMemoryState('regex:useReplace', false);

  const payload = useMemo<RegexRequest | null>(
    () => (pattern === '' ? null : { pattern, flags, text, replacement: useReplace ? replacement : undefined, maxMatches: 5000 }),
    [pattern, flags, text, replacement, useReplace],
  );
  const { result, error, timedOut, busy } = useCompute('regex', payload, { delay: text.length > 100_000 ? 200 : 60, timeout: TIMEOUT_MS, cancelInFlight: true });

  const toggleFlag = (f: string, on: boolean) => {
    const set = new Set(flags.split(''));
    if (on) set.add(f);
    else set.delete(f);
    // u and v are mutually exclusive.
    if (on && f === 'u') set.delete('v');
    if (on && f === 'v') set.delete('u');
    setFlags(REGEX_FLAGS.filter((x) => set.has(x)).join(''));
  };

  const ok = result?.ok ? result : null;
  const segments = useMemo(() => (ok ? highlightSegments(text, ok.matches) : null), [ok, text]);

  const loadSample = () => {
    setPattern(SAMPLE.pattern);
    setFlags(SAMPLE.flags);
    setText(SAMPLE.text);
    setReplacement(SAMPLE.replacement);
    setUseReplace(true);
  };

  return (
    <ToolPage title="Regex tester" icon=".*" description="Test JavaScript regular expressions with live highlighting, capture groups and a replace preview.">
      <div className="regex-input">
        <Field label="Pattern" className="grow">
          {(id) => (
            <div className="regex-pattern">
              <span aria-hidden="true">/</span>
              <input
                id={id}
                className="mono"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder="[a-z]+"
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="off"
                aria-invalid={result && !result.ok ? true : undefined}
              />
              <span aria-hidden="true">/{flags}</span>
            </div>
          )}
        </Field>
        <div className="toolbar">
          <button type="button" className="btn btn-sm btn-ghost" onClick={loadSample}>
            Sample
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => {
              setPattern('');
              setText('');
              setReplacement('');
            }}
            disabled={!pattern && !text}
          >
            Clear
          </button>
          <CopyButton text={pattern ? `/${pattern}/${flags}` : ''} label="Copy regex" />
        </div>
      </div>
      <fieldset className="flags">
        <legend className="control-label">Flags</legend>
        {REGEX_FLAGS.map((f) => (
          <Checkbox
            key={f}
            checked={flags.includes(f)}
            onChange={(on) => toggleFlag(f, on)}
            title={FLAG_INFO[f]}
            label={
              <>
                <code>{f}</code> <span className="muted small">{FLAG_INFO[f].split(' — ')[0]}</span>
              </>
            }
          />
        ))}
      </fieldset>

      <div aria-live="polite" className="status-line">
        {result && !result.ok && <Notice kind="error" title="Invalid pattern.">{result.error}</Notice>}
        {timedOut && (
          <Notice kind="warn" title="Stopped after 1.5 s.">
            The pattern is probably backtracking catastrophically on this input (e.g. nested quantifiers like <code>(a+)+</code>). The UI stays responsive because matching runs in a background worker.
          </Notice>
        )}
        {error && !timedOut && <Notice kind="error">{error}</Notice>}
        {ok && (
          <span className="muted">
            {busy ? 'Matching…' : `${ok.matches.length.toLocaleString()} ${ok.matches.length === 1 ? 'match' : 'matches'}${ok.truncated ? ' (stopped at 5,000)' : ''}${!flags.includes('g') ? ' — add the g flag to find all' : ''}`}
          </span>
        )}
      </div>

      <div className="panes">
        <CodeArea label="Test text" value={text} onChange={setText} onClear={() => setText('')} rows={10} placeholder="Text to test against…" />
        <div className="code-area">
          <div className="code-area-head">
            <span className="control-label">Matches highlighted</span>
          </div>
          <div className="highlight-box mono" aria-label="Test text with matches highlighted">
            {segments
              ? segments.map((s, i) =>
                  s.match === null ? (
                    <span key={i}>{s.text}</span>
                  ) : (
                    <mark key={i} className={s.match % 2 ? 'alt' : ''} title={`Match ${s.match + 1}`}>
                      {s.text}
                    </mark>
                  ),
                )
              : text || <span className="muted">Matches will be highlighted here.</span>}
          </div>
        </div>
      </div>

      <section className="card" aria-labelledby="replace-h">
        <div className="card-head">
          <h2 id="replace-h" className="card-title">
            Replace
          </h2>
          <Checkbox label="Show replace preview" checked={useReplace} onChange={setUseReplace} />
        </div>
        {useReplace && (
          <>
            <Field label="Replacement" hint={<>Use $1, $&lt;name&gt;, $&amp; (whole match), $$ (literal $).</>}>
              {(id) => <input id={id} className="mono" value={replacement} onChange={(e) => setReplacement(e.target.value)} spellCheck={false} autoComplete="off" />}
            </Field>
            <CodeArea label="Result" value={ok?.replaced ?? ''} rows={6} />
          </>
        )}
      </section>

      {ok && ok.matches.length > 0 && (
        <section className="card" aria-labelledby="matches-h">
          <div className="card-head">
            <h2 id="matches-h" className="card-title">
              Match details
            </h2>
            <CopyButton text={() => ok.matches.map((m) => m.text).join('\n')} label="Copy all matches" />
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Index</th>
                  <th scope="col">Match</th>
                  {Array.from({ length: ok.groupCount }, (_, i) => (
                    <th scope="col" key={i}>
                      Group {i + 1}
                      {ok.groupNames[i] && ok.groupNames.length === ok.groupCount ? <span className="muted"> ({ok.groupNames[i]})</span> : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ok.matches.slice(0, 500).map((m, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td className="mono">
                      {m.index}–{m.end}
                    </td>
                    <td className="mono match-cell">{m.text === '' ? <span className="muted">(empty)</span> : m.text}</td>
                    {Array.from({ length: ok.groupCount }, (_, g) => (
                      <td className="mono" key={g}>
                        {m.groups[g] === undefined ? <span className="muted">undefined</span> : m.groups[g]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {ok.groupNames.length > 0 && (
            <p className="muted small">
              Named groups: {ok.groupNames.map((n) => <code key={n}>{n}</code>).reduce<ReactNode[]>((acc, el, i) => (i ? [...acc, ', ', el] : [el]), [])}
            </p>
          )}
          {ok.matches.length > 500 && <p className="muted small">Showing the first 500 matches.</p>}
        </section>
      )}
    </ToolPage>
  );
}

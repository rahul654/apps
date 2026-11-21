import { Fragment, useMemo, useState } from 'react';
import { CodeArea } from '../components/CodeArea';
import { Checkbox, Notice, Segmented, Toolbar } from '../components/Controls';
import { CopyButton } from '../components/CopyButton';
import { ToolPage } from '../components/ToolPage';
import { useMemoryState } from '../hooks/memoryState';
import { oneOf, usePref } from '../hooks/prefs';
import { useCompute } from '../hooks/useCompute';
import { sizeDelay } from '../hooks/useDebounced';
import { toSideBySide, unifiedDiff, visibleWithContext, type DiffLine } from '../lib/textdiff';
import type { TextDiffReq } from '../workers/protocol';

const SAMPLE_A = `function greet(name) {
  const message = "Hello, " + name;
  console.log(message);
  return message;
}

greet("world");`;
const SAMPLE_B = `function greet(name, punctuation = "!") {
  const message = \`Hello, \${name}\${punctuation}\`;
  console.log(message);
  return message;
}

greet("world");
greet("Ada", "?");`;

const ROW_LIMIT = 3000;

function LineText({ line }: { line: DiffLine }) {
  if (!line.words) return <>{line.text || ' '}</>;
  return (
    <>
      {line.words.map((w, i) =>
        w.changed ? (
          <span key={i} className="word-chg">
            {w.text}
          </span>
        ) : (
          <Fragment key={i}>{w.text}</Fragment>
        ),
      )}
    </>
  );
}

const sign = (l: DiffLine) => (l.type === 'insert' ? '+' : l.type === 'delete' ? '−' : ' ');

export default function DiffTool() {
  const [left, setLeft] = useMemoryState('diff:left', '');
  const [right, setRight] = useMemoryState('diff:right', '');
  const [view, setView] = usePref<'split' | 'inline'>('diff.view', 'split', oneOf('split', 'inline'));
  const [ignoreWs, setIgnoreWs] = usePref('diff.ignoreWs', false, oneOf(true, false));
  const [ignoreCase, setIgnoreCase] = usePref('diff.ignoreCase', false, oneOf(true, false));
  const [onlyChanges, setOnlyChanges] = usePref('diff.onlyChanges', false, oneOf(true, false));
  const [limit, setLimit] = useState(ROW_LIMIT);

  const payload = useMemo<TextDiffReq | null>(() => (left || right ? { left, right, ignoreWhitespace: ignoreWs, ignoreCase } : null), [left, right, ignoreWs, ignoreCase]);
  const { result, error, busy } = useCompute('textDiff', payload, { delay: Math.max(120, sizeDelay(left.length + right.length)) });

  const visible = useMemo(() => (result && onlyChanges ? visibleWithContext(result.lines, 3) : null), [result, onlyChanges]);
  const lines = useMemo(() => (result ? result.lines.filter((_, i) => !visible || visible[i]) : []), [result, visible]);
  const rows = useMemo(() => (view === 'split' ? toSideBySide(lines) : []), [lines, view]);
  const total = view === 'split' ? rows.length : lines.length;
  const same = result && result.added === 0 && result.removed === 0;

  return (
    <ToolPage title="Text diff" icon="±" description="Compare two texts line by line with word-level highlighting.">
      <Toolbar>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setLeft(SAMPLE_A);
            setRight(SAMPLE_B);
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
        <CodeArea label="Original" value={left} onChange={setLeft} onClear={() => setLeft('')} rows={12} placeholder="Original text…" wrap={false} />
        <CodeArea label="Modified" value={right} onChange={setRight} onClear={() => setRight('')} rows={12} placeholder="Modified text…" wrap={false} />
      </div>
      <Toolbar>
        <Segmented
          label="View"
          value={view}
          onChange={setView}
          options={[
            { value: 'split', label: 'Side by side' },
            { value: 'inline', label: 'Inline' },
          ]}
        />
        <Checkbox label="Ignore whitespace" checked={ignoreWs} onChange={setIgnoreWs} />
        <Checkbox label="Ignore case" checked={ignoreCase} onChange={setIgnoreCase} />
        <Checkbox label="Only changes (±3 lines)" checked={onlyChanges} onChange={setOnlyChanges} />
      </Toolbar>

      <div aria-live="polite">
        {busy && <p className="muted">Comparing…</p>}
        {error && <Notice kind="error">{error}</Notice>}
      </div>

      {result && (
        <section className="card diff-card" aria-label="Diff result">
          <div className="card-head">
            <h2 className="card-title">
              {same ? (
                'No differences'
              ) : (
                <>
                  <span className="badge badge-add">+{result.added}</span> <span className="badge badge-del">−{result.removed}</span> lines
                </>
              )}
            </h2>
            <CopyButton text={() => unifiedDiff(result.lines)} disabled={!!same} label="Copy unified diff" />
          </div>
          {!result.exact && <Notice kind="warn">The texts are very different, so the middle section is shown as fully replaced rather than a minimal diff.</Notice>}
          <div className="table-wrap diff-wrap">
            {view === 'split' ? (
              <table className="diff-table split mono">
                <caption className="sr-only">Side-by-side diff: original on the left, modified on the right</caption>
                <tbody>
                  {rows.slice(0, limit).map((r, i) => (
                    <tr key={i}>
                      <td className="ln">{r.left?.oldNo ?? ''}</td>
                      <td className={`code ${r.left ? `t-${r.left.type}` : 't-empty'}`}>{r.left && <LineText line={r.left} />}</td>
                      <td className="ln">{r.right?.newNo ?? ''}</td>
                      <td className={`code ${r.right ? `t-${r.right.type}` : 't-empty'}`}>{r.right && <LineText line={r.right} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="diff-table inline mono">
                <caption className="sr-only">Inline diff</caption>
                <tbody>
                  {lines.slice(0, limit).map((l, i) => (
                    <tr key={i} className={`t-${l.type}`}>
                      <td className="ln">{l.oldNo ?? ''}</td>
                      <td className="ln">{l.newNo ?? ''}</td>
                      <td className="sign" aria-label={l.type === 'equal' ? 'unchanged' : l.type === 'insert' ? 'added' : 'removed'}>
                        {sign(l)}
                      </td>
                      <td className="code">
                        <LineText line={l} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {total > limit && (
            <button type="button" className="btn btn-sm" onClick={() => setLimit(limit + ROW_LIMIT)}>
              Show {Math.min(ROW_LIMIT, total - limit).toLocaleString()} more ({(total - limit).toLocaleString()} hidden)
            </button>
          )}
        </section>
      )}
    </ToolPage>
  );
}

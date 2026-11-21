import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MethodTag, Tabs } from '../components/ui';
import { diffJson, normalizedText, summarize } from '../lib/diff/jsondiff';
import { diffLines, visibleWithContext } from '../lib/diff/textdiff';
import { formatTime } from '../lib/format';
import { walkItems } from '../lib/postman/items';
import { isItemGroup } from '../lib/postman/normalize';
import type { PmItem } from '../lib/postman/types';
import { useAppStore } from '../store/AppStore';

interface Source {
  id: string;
  label: string;
  body: string;
}

export default function ComparePage() {
  const { state } = useAppStore();
  const [params] = useSearchParams();
  const sources = useMemo<Source[]>(() => {
    const out: Source[] = state.history.map((h) => ({ id: `h:${h.id}`, label: `${formatTime(h.at)} · ${h.method} ${h.url.slice(0, 80)} · ${h.status}`, body: h.response.bodyText }));
    for (const c of state.collections) {
      walkItems(c.item, ({ item }) => {
        if (isItemGroup(item)) return;
        for (const ex of (item as PmItem).response ?? []) out.push({ id: `e:${ex.id}`, label: `Example · ${c.info.name} / ${item.name} / ${ex.name}`, body: typeof ex.body === 'string' ? ex.body : '' });
      });
    }
    return out;
  }, [state.history, state.collections]);
  const [a, setA] = useState(params.get('a') ? `h:${params.get('a')}` : (sources[1]?.id ?? ''));
  const [b, setB] = useState(params.get('b') ? `h:${params.get('b')}` : (sources[0]?.id ?? ''));
  const [ignoreKeys, setIgnoreKeys] = useState('');
  const [ignoreOrder, setIgnoreOrder] = useState(false);
  const [view, setView] = useState<'structural' | 'text'>('structural');
  const left = sources.find((s) => s.id === a);
  const right = sources.find((s) => s.id === b);
  const parsed = (s?: Source) => {
    if (!s) return { ok: false as const, value: undefined, text: '' };
    try {
      return { ok: true as const, value: JSON.parse(s.body) as unknown, text: s.body };
    } catch {
      return { ok: false as const, value: undefined, text: s.body };
    }
  };
  const L = parsed(left);
  const R = parsed(right);
  const opts = { ignoreKeys: ignoreKeys.split(',').map((k) => k.trim()).filter(Boolean), ignoreOrder };
  const bothJson = L.ok && R.ok;
  const entries = bothJson ? diffJson(L.value, R.value, opts) : [];
  const sum = summarize(entries);
  const textA = bothJson ? normalizedText(L.value, opts) : L.text;
  const textB = bothJson ? normalizedText(R.value, opts) : R.text;
  const lineDiff = useMemo(() => (left && right ? diffLines(textA, textB) : null), [left, right, textA, textB]);
  const visible = lineDiff ? visibleWithContext(lineDiff.lines, 3) : [];
  const Select = ({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) => (
    <label className="field">
      <span>{label}</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {sources.map((s) => (
          <option key={s.id} value={s.id}>{s.label}</option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div className="stack-sm">
            <h1>Compare responses</h1>
            <p className="muted small">Diff any two history entries or saved examples: a structural JSON diff (added / removed / changed, with array handling) and a line diff.</p>
          </div>
        </div>
        <div className="card">
          <div className="grid-2">
            <Select value={a} onChange={setA} label="A (before)" />
            <Select value={b} onChange={setB} label="B (after)" />
            <label className="field">
              <span>Ignore keys (comma-separated; names anywhere, or dotted paths)</span>
              <input className="input mono" value={ignoreKeys} onChange={(e) => setIgnoreKeys(e.target.value)} placeholder="id, timestamp, meta.requestId" />
            </label>
            <label className="check" style={{ alignSelf: 'end', paddingBottom: 8 }}>
              <input type="checkbox" checked={ignoreOrder} onChange={(e) => setIgnoreOrder(e.target.checked)} /> Ignore array order
            </label>
          </div>
          {!sources.length && <p className="muted small">Send some requests first; their responses will show up here.</p>}
        </div>
        {left && right && (
          <div className="card">
            <div className="row">
              {bothJson ? (
                <span className="row">
                  <span className="pill ok">{sum.added} added</span>
                  <span className="pill err">{sum.removed} removed</span>
                  <span className="pill warn">{sum.changed} changed</span>
                  {!entries.length && <span className="small ok">Identical (with the chosen options)</span>}
                </span>
              ) : (
                <span className="small muted">One or both bodies are not JSON; only the text diff is available.</span>
              )}
              <span className="spacer" />
              <Tabs label="Diff view" value={view} onChange={setView} tabs={[{ id: 'structural', label: 'Structural' }, { id: 'text', label: 'Text' }]} />
            </div>
            {view === 'structural' && bothJson && (
              <ul className="diff-list" aria-label="Structural differences">
                {entries.map((e, i) => (
                  <li key={i} className={e.kind}>
                    <span className="pill muted">{e.kind}</span>
                    <span className="stack-sm">
                      <span className="path mono">{e.path}</span>
                      {e.kind !== 'added' && <code>− {JSON.stringify(e.before)}</code>}
                      {e.kind !== 'removed' && <code>+ {JSON.stringify(e.after)}</code>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {(view === 'text' || !bothJson) && lineDiff && (
              <div className="textdiff" aria-label="Text differences">
                {lineDiff.lines.map((l, i) =>
                  visible[i] ? (
                    <div key={i} className={`dl ${l.type}`}>
                      <span className="ln">{l.type === 'insert' ? '+' : l.type === 'delete' ? '−' : (l.oldNo ?? '')}</span>
                      <span className="tx">{l.text}</span>
                    </div>
                  ) : i === 0 || visible[i - 1] ? (
                    <div key={i} className="dl"><span className="ln">…</span><span className="tx muted">(unchanged lines hidden)</span></div>
                  ) : null,
                )}
                {lineDiff.lines.every((l) => l.type === 'equal') && <div className="dl"><span className="ln" /><span className="tx muted">No textual differences.</span></div>}
              </div>
            )}
          </div>
        )}
        {left && right && <p className="tiny muted"><MethodTag method="A" /> {left.label} <br /> <MethodTag method="B" /> {right.label}</p>}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { IconCheck, IconClose, IconPlay, IconStop } from '../components/Icons';
import { MethodTag, StatusBadge, useToast } from '../components/ui';
import { downloadText } from '../lib/download';
import { executeItem, mergeCollectionVariables, mergeValues } from '../lib/execute';
import { getFile } from '../lib/files';
import { formatMs, formatTime, safeFileName } from '../lib/format';
import { uuid } from '../lib/id';
import { countRequests, walkItems } from '../lib/postman/items';
import { collectionId, isItemGroup } from '../lib/postman/normalize';
import type { PmCollection, PmEnvironmentFile } from '../lib/postman/types';
import { parseDataFile, type DataRow } from '../lib/runner/data';
import { runCollection, type RunReport, type RunStep } from '../lib/runner/runner';
import { scriptHost } from '../lib/scripts/host';
import type { VarMap } from '../lib/variables';
import { useWorkspace } from '../store/Workspace';

function folderOptions(c: PmCollection): { id: string; name: string }[] {
  const out: { id: string; name: string }[] = [];
  walkItems(c.item, ({ item, parents }) => {
    if (isItemGroup(item)) out.push({ id: item.id!, name: `${'  '.repeat(parents.length)}${item.name}` });
  });
  return out;
}

export default function RunnerPage() {
  const { state, dispatch } = useWorkspace();
  const [params] = useSearchParams();
  const { runId } = useParams();
  const navigate = useNavigate();
  const [cid, setCid] = useState(params.get('c') ?? state.collections[0]?.info._postman_id ?? '');
  const [fid, setFid] = useState(params.get('f') ?? '');
  const [iterations, setIterations] = useState(1);
  const [delay, setDelay] = useState(0);
  const [stopOnFailure, setStopOnFailure] = useState(false);
  const [data, setData] = useState<{ name: string; rows: DataRow[] } | null>(null);
  const [live, setLive] = useState<RunReport | null>(null);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [toast, showToast] = useToast();
  useEffect(() => {
    if (params.get('c')) setCid(params.get('c')!);
    if (params.get('f')) setFid(params.get('f')!);
  }, [params]);
  const collection = state.collections.find((c) => collectionId(c) === cid);
  const report = runId ? state.runs.find((r) => r.id === runId) ?? null : live;
  const envId = state.activeEnvironmentId;

  const start = async () => {
    if (!collection || running) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setRunning(true);
    const id = `run-${new Date().toISOString().replace(/[:.]/g, '-')}-${uuid().slice(0, 8)}`;
    const host = scriptHost();
    // Variables are threaded through the run so pm.environment.set in one request is seen by the next.
    let env: PmEnvironmentFile | null = state.environments.find((e) => e.id === envId) ?? null;
    let globals = state.globals;
    let col = collection;
    let local: VarMap = {};
    const rep = await runCollection(
      { collection, folderId: fid || undefined, iterations, delayMs: delay, stopOnFailure, data: data?.rows },
      async (item, parents, ctx) => {
        const res = await executeItem({ collection: col, parents, item, environment: env, globals, prefs: state.prefs, files: getFile, host, data: ctx.data, local, iteration: ctx.iteration, iterationCount: ctx.iterationCount, runId: id, signal: ac.signal });
        local = res.changes.local;
        if (res.changes.environment && env) {
          env = mergeValues(env, res.changes.environment);
          dispatch({ type: 'environment/put', env });
        }
        if (res.changes.globals) {
          globals = mergeValues(globals, res.changes.globals);
          dispatch({ type: 'globals/set', globals });
        }
        if (res.changes.collection) {
          col = mergeCollectionVariables(col, res.changes.collection);
          dispatch({ type: 'collection/put', collection: col });
        }
        dispatch({ type: 'history/add', entry: res.history });
        return { status: res.response.status, statusText: res.response.statusText, time: res.response.time, size: res.response.size, url: res.prepared.url, method: res.prepared.method, tests: res.tests, error: res.response.error?.message ?? res.scriptErrors[0], nextRequest: res.nextRequest, responseId: res.history.id };
      },
      { id: () => id, signal: ac.signal, onStart: (r) => setLive({ ...r }), onStep: (_s, r) => setLive({ ...r, steps: [...r.steps] }) },
    );
    setLive(rep);
    dispatch({ type: 'run/put', run: rep });
    setRunning(false);
    abortRef.current = null;
    navigate(`/runner/${rep.id}`, { replace: true });
  };

  const onDataFile = async (f: File | null) => {
    if (!f) return setData(null);
    try {
      const rows = parseDataFile(await f.text(), f.name);
      if (!rows.length) throw new Error('no rows found');
      setData({ name: f.name, rows });
    } catch (e) {
      showToast(`Could not read data file: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div className="stack-sm">
            <h1>Collection runner</h1>
            <p className="muted small">Runs every request in order (folders depth-first), with iterations, a delay, an optional CSV/JSON data file for <code>pm.iterationData</code>, and <code>setNextRequest</code> chaining.</p>
          </div>
        </div>
        <div className="card">
          <div className="grid-2">
            <label className="field">
              <span>Collection</span>
              <select className="input" value={cid} onChange={(e) => { setCid(e.target.value); setFid(''); }} disabled={running}>
                {!state.collections.length && <option value="">No collections</option>}
                {state.collections.map((c) => (
                  <option key={collectionId(c)} value={collectionId(c)}>{c.info.name} ({countRequests(c.item)})</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Folder</span>
              <select className="input" value={fid} onChange={(e) => setFid(e.target.value)} disabled={running || !collection}>
                <option value="">Whole collection</option>
                {collection && folderOptions(collection).map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Iterations {data ? `(from data file: ${data.rows.length})` : ''}</span>
              <input className="input" type="number" min={1} max={1000} value={data ? data.rows.length : iterations} onChange={(e) => setIterations(Math.max(1, Number(e.target.value) || 1))} disabled={running || !!data} />
            </label>
            <label className="field">
              <span>Delay between requests (ms)</span>
              <input className="input" type="number" min={0} max={60000} value={delay} onChange={(e) => setDelay(Math.max(0, Number(e.target.value) || 0))} disabled={running} />
            </label>
            <div className="field">
              <span>Data file (CSV or JSON array)</span>
              <div className="row">
                <label className="btn small">
                  Choose file
                  <input className="file-input" type="file" accept=".csv,.json,text/csv,application/json" onChange={(e) => void onDataFile(e.target.files?.[0] ?? null)} disabled={running} />
                </label>
                {data ? (
                  <span className="small">
                    {data.name} · {data.rows.length} rows · columns: {Object.keys(data.rows[0]).join(', ')}{' '}
                    <button type="button" className="linkish small" onClick={() => setData(null)}>remove</button>
                  </span>
                ) : (
                  <span className="small muted">none</span>
                )}
              </div>
            </div>
            <label className="check" style={{ alignSelf: 'end', paddingBottom: 8 }}>
              <input type="checkbox" checked={stopOnFailure} onChange={(e) => setStopOnFailure(e.target.checked)} disabled={running} /> Stop on first failed test or error
            </label>
          </div>
          <div className="row">
            {running ? (
              <button type="button" className="btn danger" onClick={() => abortRef.current?.abort()}>
                <IconStop size={15} /> Stop
              </button>
            ) : (
              <button type="button" className="btn primary" onClick={() => void start()} disabled={!collection || !countRequests(fid && collection ? (walkItemsFind(collection, fid)?.item ?? []) : (collection?.item ?? []))}>
                <IconPlay size={15} /> Run
              </button>
            )}
            <span className="small muted">Environment: {state.environments.find((e) => e.id === envId)?.name ?? 'none'} · mode: {state.prefs.mode}</span>
          </div>
        </div>

        {report && <RunReportView report={report} running={running && report.id === live?.id} />}

        {state.runs.length > 0 && (
          <div className="stack-sm">
            <h2>Saved runs</h2>
            <ul className="list">
              {state.runs.map((r) => (
                <li key={r.id} className="card tight list-item">
                  <Link to={`/runner/${r.id}`} className="main-link">
                    <span className="name">
                      {r.collectionName}{r.folderName ? ` / ${r.folderName}` : ''} <span className={r.totals.failed || r.totals.errors ? 'pill err' : 'pill ok'}>{r.totals.passed} passed · {r.totals.failed} failed · {r.totals.errors} errors</span> {r.stopped !== 'completed' && <span className="pill warn">{r.stopped}</span>}
                    </span>
                    <span className="tiny muted">{formatTime(r.startedAt)} · {r.totals.requests} requests · {r.iterations} iteration{r.iterations === 1 ? '' : 's'}</span>
                  </Link>
                  <button type="button" className="btn ghost small" onClick={() => downloadText(JSON.stringify(r, null, 2), `${safeFileName(r.id)}.json`)}>Export</button>
                  <button type="button" className="btn ghost small danger" onClick={() => dispatch({ type: 'run/remove', id: r.id })}>Delete</button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {toast}
    </div>
  );
}

function walkItemsFind(c: PmCollection, id: string) {
  let found: { item: PmCollection['item'] } | null = null;
  walkItems(c.item, ({ item }) => {
    if (item.id === id && isItemGroup(item)) found = { item: item.item };
  });
  return found as { item: PmCollection['item'] } | null;
}

export function RunReportView({ report, running }: { report: RunReport; running: boolean }) {
  const total = report.totals;
  const expected = report.iterations;
  return (
    <section className="card" aria-live="polite" aria-label="Run results">
      <div className="row">
        <h2>
          {running && <span className="spinner" aria-hidden="true" />} {report.collectionName}{report.folderName ? ` / ${report.folderName}` : ''}
        </h2>
        <span className="spacer" />
        <span className={total.failed || total.errors ? 'pill err' : 'pill ok'}>{total.passed} passed · {total.failed} failed · {total.errors} errors</span>
        {!running && <span className="pill muted">{report.stopped}</span>}
      </div>
      <div className="stats">
        <div className="stat"><b>{total.requests}</b><span>requests</span></div>
        <div className="stat"><b>{expected}</b><span>iterations</span></div>
        <div className="stat"><b>{formatMs(report.steps.reduce((a, s) => a + s.time, 0))}</b><span>total time</span></div>
        <div className="stat"><b>{report.steps.length ? formatMs(report.steps.reduce((a, s) => a + s.time, 0) / report.steps.length) : '–'}</b><span>avg</span></div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Iter.</th>
              <th>Request</th>
              <th>Status</th>
              <th className="n">Time</th>
              <th>Tests</th>
            </tr>
          </thead>
          <tbody>
            {report.steps.map((s) => (
              <StepRow key={s.index} s={s} />
            ))}
            {!report.steps.length && (
              <tr>
                <td colSpan={6} className="muted small">{running ? 'Starting…' : 'No requests ran.'}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StepRow({ s }: { s: RunStep }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="selectable" onClick={() => setOpen((o) => !o)}>
        <td className="n">{s.index + 1}</td>
        <td className="n">{s.iteration + 1}</td>
        <td>
          <div className="row nowrap">
            {s.method && <MethodTag method={s.method} />}
            <span className="ellipsis" style={{ maxWidth: 360 }}>{s.path ? `${s.path} / ` : ''}{s.requestName}</span>
          </div>
        </td>
        <td>{s.error ? <span className="pill err" title={s.error}>error</span> : <StatusBadge status={s.status} />}</td>
        <td className="n">{formatMs(s.time)}</td>
        <td>
          {s.tests.length ? (
            <span className={s.failed ? 'pill err' : 'pill ok'}>{s.passed}/{s.tests.length}</span>
          ) : (
            <span className="tiny muted">none</span>
          )}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6}>
            <ul className="tests-list">
              {s.error && <li className="fail"><IconClose size={16} className="error-text" /> {s.error}</li>}
              {s.tests.map((t, i) => (
                <li key={i} className={t.passed ? 'pass' : 'fail'}>
                  {t.passed ? <IconCheck size={16} className="ok" /> : <IconClose size={16} className="error-text" />}
                  <span>{t.name}{t.error ? <span className="muted"> — {t.error}</span> : null}</span>
                </li>
              ))}
              {s.url && <li className="muted tiny mono break">{s.url}</li>}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

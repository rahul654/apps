import { useRef, useState, type DragEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { IconDownload, IconUpload, IconWarn } from '../components/Icons';
import { useToast } from '../components/ui';
import { useSwitchWorkspace } from '../components/WorkspaceSwitcher';
import { downloadBytes, downloadText } from '../lib/download';
import { collectionFileName, environmentFileName, globalsFileName, toCollectionFile, toEnvironmentFile } from '../lib/postman/export';
import { collectionId } from '../lib/postman/normalize';
import { describeSummary, planImport, strategiesFor, type ImportStrategy } from '../lib/workspace/importPlan';
import { parseCurlImport, parseLooseFiles } from '../lib/workspace/loose';
import { buildAllWorkspacesZip, buildWorkspaceZip, groupSize, parseImportZip, zipFileName, type ImportMode, type ParsedImport } from '../lib/workspace/zip';
import { cleanWorkspaceName, DEFAULT_WORKSPACE_ID, emptyWorkspaceData } from '../lib/workspaces';
import { useAppStore } from '../store/AppStore';

const NEW = '__new__';

interface Pending {
  label: string;
  parsed: ParsedImport;
  /** For curl: the request to open afterwards. */
  requestId?: string;
}

function describe(p: ParsedImport): string {
  const names = p.groups.map((g) => `“${g.name}”`).join(', ');
  switch (p.kind) {
    case 'all-workspaces':
      return `API Client backup of ${p.groups.length} workspace${p.groups.length === 1 ? '' : 's'}: ${names}.`;
    case 'workspace':
      return `API Client workspace ${names}.`;
    case 'apiclient-v1':
      return 'API Client export (older single-workspace format).';
    case 'postman-api':
      return `Export from export-from-postman.mjs with ${p.groups.length} Postman workspace${p.groups.length === 1 ? '' : 's'}: ${names}.`;
    case 'postman':
      return 'Postman export (files detected by content).';
    case 'files':
      return p.groups[0]?.requests?.length ? 'curl command.' : 'Loose files.';
  }
}

function counts(p: ParsedImport): string {
  const t = { collections: 0, environments: 0, globals: 0, history: 0, runs: 0 };
  for (const g of p.groups) {
    t.collections += g.collections.length;
    t.environments += g.environments.length;
    t.globals += g.globals ? 1 : 0;
    t.history += g.history.length;
    t.runs += g.runs.length;
  }
  return `${t.collections} collections, ${t.environments} environments${t.globals ? `, ${t.globals} globals file${t.globals === 1 ? '' : 's'}` : ''}${t.history ? `, ${t.history} history entries` : ''}${t.runs ? `, ${t.runs} runs` : ''}`;
}

const STRATEGY_LABEL: Record<ImportStrategy, string> = {
  restore: 'Restore each workspace (by id; created when missing)',
  'per-postman': 'Create one workspace per Postman workspace (same name: merged into it)',
  target: 'Import everything into one workspace',
};

export default function DataPage() {
  const { state, dispatch } = useAppStore();
  const navigate = useNavigate();
  const switchTo = useSwitchWorkspace();
  const [toast, showToast] = useToast();
  const [pending, setPending] = useState<Pending | null>(null);
  const [strategy, setStrategy] = useState<ImportStrategy>('target');
  const [mode, setMode] = useState<ImportMode>('merge');
  const [target, setTarget] = useState<string>(DEFAULT_WORKSPACE_ID);
  const [newName, setNewName] = useState('');
  const [over, setOver] = useState(false);
  const [curl, setCurl] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [touched, setTouched] = useState<{ id: string; name: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const ws = state.workspace;
  const current = { collections: state.collections, environments: state.environments, globals: state.globals, history: state.history, runs: state.runs, activeEnvironmentId: state.activeEnvironmentId };

  const startImport = (p: Pending, defaultTarget = DEFAULT_WORKSPACE_ID) => {
    setPending(p);
    setStrategy(strategiesFor(p.parsed)[0]);
    setMode('merge');
    setTarget(defaultTarget);
    setNewName(p.parsed.suggestedName);
    setTouched([]);
  };

  const handleFiles = async (list: FileList | File[]) => {
    const files = Array.from(list);
    const zips = files.filter((f) => /\.zip$/i.test(f.name));
    const loose = files.filter((f) => !/\.zip$/i.test(f.name));
    const lines: string[] = [];
    try {
      if (zips.length) {
        const f = zips[0];
        startImport({ label: f.name, parsed: parseImportZip(new Uint8Array(await f.arrayBuffer()), f.name) });
        if (zips.length > 1 || loose.length) lines.push(`Import one zip at a time; not read: ${[...zips.slice(1), ...loose].map((x) => x.name).join(', ')}`);
      } else if (loose.length) {
        const parsed = await parseLooseFiles(await Promise.all(loose.map(async (f) => ({ name: f.name, text: await f.text() }))));
        if (!groupSize(parsed.groups[0])) lines.push(...parsed.skipped.map((s) => `${s.file}: ${s.reason}`));
        else startImport({ label: loose.length === 1 ? loose[0].name : `${loose.length} files`, parsed });
      }
    } catch (e) {
      lines.push(`${files.map((f) => f.name).join(', ')}: ${e instanceof Error ? e.message : String(e)}`);
    }
    setLog(lines);
  };

  const importCurl = () => {
    try {
      const parsed = parseCurlImport(curl);
      startImport({ label: 'curl command', parsed, requestId: parsed.requestId }, state.activeWorkspaceId);
      setLog([]);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  };

  const strategies = pending ? strategiesFor(pending.parsed) : [];
  const isFiles = pending?.parsed.kind === 'files';
  const effectiveMode: ImportMode = isFiles ? 'merge' : mode;
  const newNameOk = strategy !== 'target' || target !== NEW || !!cleanWorkspaceName(newName);

  const applyImport = () => {
    if (!pending || !newNameOk) return;
    const ops = planImport({ workspaces: state.workspaces, data: state.data }, pending.parsed, { strategy, mode: effectiveMode, target: target === NEW ? { kind: 'new', name: newName } : { kind: 'existing', id: target } });
    dispatch({ type: 'import/apply', ops });
    setLog([
      ...ops.map((op) => `${op.create ? 'Created' : effectiveMode === 'replace' ? 'Replaced' : 'Merged into'} “${op.name}”: ${describeSummary(op.summary)}.`),
      ...pending.parsed.skipped.map((x) => `Skipped ${x.file}: ${x.reason}`),
    ]);
    setTouched(ops.filter((op) => op.ws !== state.activeWorkspaceId).map((op) => ({ id: op.ws, name: op.name })));
    setPending(null);
    showToast(ops.length === 1 ? `Imported into “${ops[0].name}”` : `Imported into ${ops.length} workspaces`);
    if (pending.requestId) {
      const op = ops[0];
      const col = op?.data.collections.find((c) => c.item.some((i) => i.id === pending.requestId));
      if (op && col) {
        if (op.ws !== state.activeWorkspaceId) switchTo(op.ws);
        setCurl('');
        navigate(`/r/${collectionId(col)}/${pending.requestId}`);
      }
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void handleFiles(e.dataTransfer.files);
  };

  const exportThis = () => downloadBytes(buildWorkspaceZip({ meta: ws, data: current }), zipFileName(ws.name), 'application/zip');
  const exportAll = () => downloadBytes(buildAllWorkspacesZip(state.workspaces.map((w) => ({ meta: w, data: state.data[w.id] ?? emptyWorkspaceData() }))), zipFileName('all-workspaces'), 'application/zip');

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div className="stack-sm">
            <h1>Import &amp; export</h1>
            <p className="muted small">Collections are Postman Collection v2.1 files; environments and globals are Postman environment files. Imports go into the workspace you pick; exports cover this workspace (<strong>{ws.name}</strong>) or all of them. <Link to="/workspaces">Manage workspaces</Link>. Moving data to or from Postman itself? Use the one-line <Link to="/postman">Postman export &amp; import</Link> commands.</p>
          </div>
        </div>
        <div className="grid-2">
          <section className="card">
            <h2><IconUpload size={18} /> Import</h2>
            <div className={over ? 'dropzone over' : 'dropzone'} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
              <p>Drop files here, or</p>
              <button type="button" className="btn" onClick={() => fileRef.current?.click()}>Choose files</button>
              <p className="tiny">This app’s zips (all workspaces, one workspace, older exports), Postman “Export data” zips, <code>export-from-postman.mjs</code> zips, Postman Collection v2.1 / v2.0, environment or globals JSON, OpenAPI 3 (JSON/YAML).</p>
            </div>
            <input ref={fileRef} type="file" multiple className="file-input" accept=".json,.zip,.yaml,.yml,application/json,application/zip" onChange={(e) => {
              if (e.target.files) void handleFiles(e.target.files);
              e.target.value = '';
            }} aria-label="Import files" />
            {pending && (
              <div className="note info import-panel" role="group" aria-label="Import options">
                <div className="row nowrap">
                  <IconWarn size={16} />
                  <strong className="ellipsis">{pending.label}</strong>
                </div>
                <span className="small">{describe(pending.parsed)} {counts(pending.parsed)}.</span>
                {pending.parsed.skipped.length > 0 && <span className="small">Skipped: {pending.parsed.skipped.map((s) => `${s.file} (${s.reason})`).join('; ')}</span>}
                {strategies.length > 1 && (
                  <fieldset>
                    <legend>Where to</legend>
                    {strategies.map((s) => (
                      <label key={s} className="radio">
                        <input type="radio" name="import-strategy" checked={strategy === s} onChange={() => setStrategy(s)} /> {STRATEGY_LABEL[s]}
                      </label>
                    ))}
                  </fieldset>
                )}
                {strategy === 'target' && (
                  <div className="row">
                    <label className="field grow">
                      <span>Target workspace</span>
                      <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
                        {state.workspaces.map((w) => (
                          <option key={w.id} value={w.id}>{w.name}{w.id === state.activeWorkspaceId ? ' (current)' : ''}</option>
                        ))}
                        <option value={NEW}>New workspace…</option>
                      </select>
                    </label>
                    {target === NEW && (
                      <label className="field grow">
                        <span>New workspace name</span>
                        <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} />
                      </label>
                    )}
                  </div>
                )}
                {!isFiles && (
                  <div className="segmented" role="group" aria-label="Import mode">
                    <button type="button" aria-pressed={mode === 'merge'} onClick={() => setMode('merge')}>Merge (imported wins on same id)</button>
                    <button type="button" aria-pressed={mode === 'replace'} onClick={() => setMode('replace')}>{strategy === 'target' ? 'Replace the target’s data' : 'Replace each target’s data'}</button>
                  </div>
                )}
                {!isFiles && mode === 'replace' && <span className="tiny">Replace clears only the workspace{strategy === 'target' ? '' : 's'} being imported into; other workspaces are not touched.</span>}
                <div className="row">
                  <button type="button" className="btn primary small" disabled={!newNameOk} onClick={applyImport}>Import</button>
                  <button type="button" className="btn small" onClick={() => setPending(null)}>Cancel</button>
                </div>
              </div>
            )}
            {log.length > 0 && (
              <ul className="bullets small" aria-live="polite">
                {log.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            )}
            {touched.length > 0 && (
              <div className="row">
                {touched.map((t) => (
                  <button key={t.id} type="button" className="btn small" onClick={() => {
                    switchTo(t.id);
                    setTouched([]);
                  }}>
                    Switch to “{t.name}”
                  </button>
                ))}
              </div>
            )}
            <label className="field">
              <span>Paste a curl command</span>
              <textarea className="input code" value={curl} onChange={(e) => setCurl(e.target.value)} placeholder="curl -X POST https://api.example.com/items -H 'Content-Type: application/json' -d '{&quot;a&quot;:1}'" style={{ minHeight: 90 }} />
            </label>
            <button type="button" className="btn small self-start" disabled={!curl.trim()} onClick={importCurl}>Import curl into “Imported”…</button>
          </section>
          <section className="card">
            <h2><IconDownload size={18} /> Export</h2>
            <div className="row">
              <button type="button" className="btn primary" onClick={exportThis}>Export this workspace (.zip)</button>
              <button type="button" className="btn" onClick={exportAll}>Export all workspaces (.zip)</button>
            </div>
            <p className="small muted">To open a workspace in Postman: unzip, then use <strong>Import → Folders</strong> on <code>workspaces/&lt;name&gt;</code> (or on the unzipped folder of a one-workspace zip). History, runs and the active environment stay in <code>_apiclient/</code>.</p>
            <pre className="tree-paths" aria-label="All-workspaces zip layout">{`workspaces/<name>/collections/*.postman_collection.json
workspaces/<name>/environments/*.postman_environment.json
workspaces/<name>/globals.postman_globals.json
_apiclient/<name>/workspace.json · history.json · runs/
manifest.json`}</pre>
            <h3>Individual files from “{ws.name}”</h3>
            <ul className="list">
              {state.collections.map((c) => (
                <li key={collectionId(c)} className="row">
                  <span className="grow ellipsis">{c.info.name}</span>
                  <button type="button" className="btn small" onClick={() => downloadText(JSON.stringify(toCollectionFile(c), null, 2), collectionFileName(c))}>Collection v2.1</button>
                </li>
              ))}
              {state.environments.map((e) => (
                <li key={e.id} className="row">
                  <span className="grow ellipsis">{e.name}</span>
                  <button type="button" className="btn small" onClick={() => downloadText(JSON.stringify(toEnvironmentFile(e), null, 2), environmentFileName(e))}>Environment</button>
                </li>
              ))}
              <li className="row">
                <span className="grow">Globals</span>
                <button type="button" className="btn small" onClick={() => downloadText(JSON.stringify(toEnvironmentFile(state.globals, 'globals'), null, 2), globalsFileName())}>Globals</button>
              </li>
            </ul>
            <h3>Danger zone</h3>
            <button type="button" className="btn danger self-start" onClick={() => {
              if (!window.confirm(`Delete all ${state.workspaces.length} workspaces with their collections, environments, history and runs from this browser? Export all workspaces first if you want to keep anything.`)) return;
              dispatch({ type: 'wipe' });
              showToast('All data wiped');
            }}>
              Wipe all data
            </button>
          </section>
        </div>
      </div>
      {toast}
    </div>
  );
}

import { useRef, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconDownload, IconUpload, IconWarn } from '../components/Icons';
import { useToast } from '../components/ui';
import { downloadBytes, downloadText } from '../lib/download';
import { collectionFileName, environmentFileName, globalsFileName, toCollectionFile, toEnvironmentFile } from '../lib/postman/export';
import { curlToRequest, openApiToCollection, parseOpenApiText } from '../lib/postman/importers';
import { collectionId, detectPostmanJson, normalizeCollection, normalizeEnvironment } from '../lib/postman/normalize';
import { buildWorkspaceZip, mergeWorkspace, parseWorkspaceZip, type ImportMode, type ParsedZip } from '../lib/workspace/zip';
import { newCollection, useWorkspace } from '../store/Workspace';
import { uuid } from '../lib/id';

export default function DataPage() {
  const { state, dispatch } = useWorkspace();
  const navigate = useNavigate();
  const [toast, showToast] = useToast();
  const [mode, setMode] = useState<ImportMode>('merge');
  const [pending, setPending] = useState<{ name: string; parsed: ParsedZip } | null>(null);
  const [over, setOver] = useState(false);
  const [curl, setCurl] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const current = () => ({ collections: state.collections, environments: state.environments, globals: state.globals, history: state.history, runs: state.runs, activeEnvironmentId: state.activeEnvironmentId });

  const exportAll = () => {
    const zip = buildWorkspaceZip(current());
    downloadBytes(zip, `apiclient-workspace-${new Date().toISOString().slice(0, 10)}.zip`, 'application/zip');
  };

  const importJson = (name: string, json: unknown): string => {
    const kind = detectPostmanJson(json);
    if (kind === 'collection') {
      const c = normalizeCollection(json);
      const exists = state.collections.some((x) => collectionId(x) === collectionId(c));
      dispatch({ type: 'collection/put', collection: c });
      return `${name}: collection "${c.info.name}" ${exists ? 'replaced' : 'added'}`;
    }
    if (kind === 'environment') {
      const e = normalizeEnvironment(json);
      dispatch({ type: 'environment/put', env: e });
      return `${name}: environment "${e.name}" imported`;
    }
    if (kind === 'globals') {
      const g = normalizeEnvironment(json, 'globals');
      const merged = [...state.globals.values];
      for (const v of g.values) {
        const i = merged.findIndex((x) => x.key === v.key);
        if (i >= 0) merged[i] = v;
        else merged.push(v);
      }
      dispatch({ type: 'globals/set', globals: { ...state.globals, values: merged } });
      return `${name}: ${g.values.length} global variables merged`;
    }
    if (kind === 'openapi') {
      const c = openApiToCollection(json as Parameters<typeof openApiToCollection>[0]);
      dispatch({ type: 'collection/put', collection: c });
      return `${name}: OpenAPI → collection "${c.info.name}"`;
    }
    if (kind === 'collection-v1') return `${name}: Collection v1 is not supported; export as v2.1 from Postman`;
    return `${name}: not recognised (expected a Postman collection, environment, globals or OpenAPI file)`;
  };

  const handleFiles = async (files: FileList | File[]) => {
    const lines: string[] = [];
    for (const f of Array.from(files)) {
      try {
        if (/\.zip$/i.test(f.name)) {
          const parsed = parseWorkspaceZip(new Uint8Array(await f.arrayBuffer()));
          setPending({ name: f.name, parsed });
          lines.push(`${f.name}: ${parsed.collections.length} collections, ${parsed.environments.length} environments, ${parsed.globals ? 'globals, ' : ''}${parsed.history.length} history entries, ${parsed.runs.length} runs — confirm below`);
          continue;
        }
        const text = await f.text();
        if (/\.ya?ml$/i.test(f.name)) {
          const doc = await parseOpenApiText(text);
          const c = openApiToCollection(doc);
          dispatch({ type: 'collection/put', collection: c });
          lines.push(`${f.name}: OpenAPI → collection "${c.info.name}"`);
          continue;
        }
        lines.push(importJson(f.name, JSON.parse(text)));
      } catch (e) {
        lines.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setLog(lines);
  };

  const applyZip = () => {
    if (!pending) return;
    const result = mergeWorkspace(current(), pending.parsed, mode);
    dispatch({ type: 'replaceAll', data: result });
    const s = result.summary;
    setLog([`Imported ${s.collections} collections, ${s.environments} environments, ${s.globals} globals, ${s.history} history entries, ${s.runs} runs (${mode}; ${s.replaced} replaced by id).`, ...pending.parsed.skipped.map((x) => `Skipped ${x.file}: ${x.reason}`)]);
    setPending(null);
    showToast('Workspace imported');
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void handleFiles(e.dataTransfer.files);
  };

  const importCurl = () => {
    try {
      const { name, request } = curlToRequest(curl);
      let target = state.collections.find((c) => c.info.name === 'Imported') ?? newCollection('Imported');
      const item = { id: uuid(), name, request, response: [] };
      target = { ...target, item: [...target.item, item] };
      dispatch({ type: 'collection/put', collection: target });
      setCurl('');
      navigate(`/r/${collectionId(target)}/${item.id}`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div className="stack-sm">
            <h1>Import &amp; export</h1>
            <p className="muted small">Everything is Postman-compatible: collections are Collection v2.1 files, environments and globals are Postman environment files. The workspace zip contains those same files plus history and run reports.</p>
          </div>
        </div>
        <div className="grid-2">
          <section className="card">
            <h2><IconUpload size={18} /> Import</h2>
            <div className={over ? 'dropzone over' : 'dropzone'} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
              <p>Drop files here, or</p>
              <button type="button" className="btn" onClick={() => fileRef.current?.click()}>Choose files</button>
              <input ref={fileRef} type="file" multiple className="file-input" accept=".json,.zip,.yaml,.yml,application/json,application/zip" onChange={(e) => e.target.files && void handleFiles(e.target.files)} aria-label="Import files" />
              <p className="tiny">Postman Collection v2.1 / v2.0, Postman environment or globals JSON, Postman “Export data” zip, this app’s workspace zip, OpenAPI 3 (JSON/YAML).</p>
            </div>
            {pending && (
              <div className="note info">
                <IconWarn size={16} />
                <div className="stack-sm">
                  <strong>{pending.name}</strong>
                  <span className="small">{pending.parsed.fromPostman ? 'Looks like a Postman export.' : 'API Client workspace export.'} {pending.parsed.collections.length} collections, {pending.parsed.environments.length} environments{pending.parsed.globals ? ', globals' : ''}, {pending.parsed.history.length} history entries, {pending.parsed.runs.length} runs.</span>
                  {pending.parsed.skipped.length > 0 && <span className="small">Skipped: {pending.parsed.skipped.map((s) => `${s.file} (${s.reason})`).join('; ')}</span>}
                  <div className="segmented" role="group" aria-label="Import mode">
                    <button type="button" aria-pressed={mode === 'merge'} onClick={() => setMode('merge')}>Merge (keep mine, imported wins on same id)</button>
                    <button type="button" aria-pressed={mode === 'replace'} onClick={() => setMode('replace')}>Replace everything</button>
                  </div>
                  <div className="row">
                    <button type="button" className="btn primary small" onClick={applyZip}>Import</button>
                    <button type="button" className="btn small" onClick={() => setPending(null)}>Cancel</button>
                  </div>
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
            <label className="field">
              <span>Paste a curl command</span>
              <textarea className="input code" value={curl} onChange={(e) => setCurl(e.target.value)} placeholder="curl -X POST https://api.example.com/items -H 'Content-Type: application/json' -d '{&quot;a&quot;:1}'" style={{ minHeight: 90 }} />
            </label>
            <button type="button" className="btn small self-start" disabled={!curl.trim()} onClick={importCurl}>Import curl into “Imported”</button>
          </section>
          <section className="card">
            <h2><IconDownload size={18} /> Export</h2>
            <button type="button" className="btn primary self-start" onClick={exportAll}>Export everything (.zip)</button>
            <p className="tiny muted">collections/*.postman_collection.json · environments/*.postman_environment.json · globals.json · history.json · runs/*.json · manifest.json</p>
            <h3>Individual files</h3>
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
              if (!window.confirm('Delete every collection, environment, history entry and run from this browser? Export first if you want to keep anything.')) return;
              dispatch({ type: 'wipe' });
              showToast('Workspace wiped');
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

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { IconCopy, IconDownload, IconPlus, IconTrash } from '../components/Icons';
import { useToast } from '../components/ui';
import { useSwitchWorkspace } from '../components/WorkspaceSwitcher';
import { downloadBytes } from '../lib/download';
import { buildWorkspaceZip, zipFileName } from '../lib/workspace/zip';
import { cleanWorkspaceName, duplicateWorkspaceData, emptyWorkspaceData, findWorkspaceByName, isDefaultWorkspace, uniqueWorkspaceName, workspaceCounts, type WorkspaceMeta } from '../lib/workspaces';
import { newWorkspaceMeta, useAppStore } from '../store/AppStore';

function RenameForm({ ws, onDone }: { ws: WorkspaceMeta; onDone: () => void }) {
  const { state, dispatch } = useAppStore();
  const [name, setName] = useState(ws.name);
  const clash = findWorkspaceByName(state.workspaces.filter((w) => w.id !== ws.id), name);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!cleanWorkspaceName(name) || clash) return;
    dispatch({ type: 'workspace/rename', id: ws.id, name });
    onDone();
  };
  return (
    <form className="row grow" onSubmit={submit}>
      <input className="input compact grow" value={name} onChange={(e) => setName(e.target.value)} aria-label={`New name for ${ws.name}`} autoFocus onKeyDown={(e) => e.key === 'Escape' && onDone()} />
      <button type="submit" className="btn small primary" disabled={!cleanWorkspaceName(name) || !!clash}>Save</button>
      <button type="button" className="btn small" onClick={onDone}>Cancel</button>
      {clash && <span className="tiny error-text">Another workspace has that name.</span>}
    </form>
  );
}

export default function WorkspacesPage() {
  const { state, dispatch, draftCount } = useAppStore();
  const switchTo = useSwitchWorkspace();
  const [toast, showToast] = useToast();
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);

  const create = (e: FormEvent) => {
    e.preventDefault();
    const name = cleanWorkspaceName(newName);
    if (!name) return;
    const meta = newWorkspaceMeta(uniqueWorkspaceName(name, state.workspaces));
    dispatch({ type: 'workspace/create', meta, data: emptyWorkspaceData(), activate: true });
    setNewName('');
    showToast(`Created and switched to “${meta.name}”`);
  };

  const duplicate = (w: WorkspaceMeta) => {
    const meta = newWorkspaceMeta(uniqueWorkspaceName(`${w.name} copy`, state.workspaces));
    dispatch({ type: 'workspace/create', meta, data: duplicateWorkspaceData(state.data[w.id] ?? emptyWorkspaceData()) });
    showToast(`Duplicated as “${meta.name}”`);
  };

  const remove = (w: WorkspaceMeta) => {
    const data = state.data[w.id];
    const c = workspaceCounts(data);
    const drafts = draftCount(w.id);
    if (!window.confirm(`Delete workspace “${w.name}” with ${c.collections} collections, ${c.environments} environments, ${c.history} history entries and ${c.runs} runs?${drafts ? ` ${drafts} unsaved request edits are lost too.` : ''}`)) return;
    const wasActive = state.activeWorkspaceId === w.id;
    dispatch({ type: 'workspace/remove', id: w.id });
    showToast(`Deleted “${w.name}”`, { label: 'Undo', onClick: () => dispatch({ type: 'workspace/create', meta: w, data, activate: wasActive }) });
  };

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div className="stack-sm">
            <h1>Workspaces</h1>
            <p className="muted small">Each workspace has its own collections, environments, globals, history and runs. Every page shows the current one; switch in the top bar. Proxy settings and the theme apply to all. <strong>Default</strong> always exists: rename it, but it can’t be deleted. Back up or move workspaces on the <Link to="/data">Data</Link> page.</p>
          </div>
        </div>
        <form className="card tight ws-create" onSubmit={create}>
          <label className="field grow">
            <span>New workspace</span>
            <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Payments team" />
          </label>
          <button type="submit" className="btn primary" disabled={!cleanWorkspaceName(newName)}>
            <IconPlus size={16} /> Create
          </button>
        </form>
        <ul className="list" aria-label="Workspaces">
          {state.workspaces.map((w) => {
            const c = workspaceCounts(state.data[w.id]);
            const active = w.id === state.activeWorkspaceId;
            const drafts = draftCount(w.id);
            return (
              <li key={w.id} className={active ? 'card tight list-item selected ws-item' : 'card tight list-item ws-item'}>
                {renaming === w.id ? (
                  <RenameForm ws={w} onDone={() => setRenaming(null)} />
                ) : (
                  <div className="stack-sm grow">
                    <span className="name row">
                      <strong className="ellipsis">{w.name}</strong>
                      {isDefaultWorkspace(w) && <span className="pill muted">default</span>}
                      {active && <span className="pill ok">current</span>}
                      {drafts > 0 && <span className="pill warn">{drafts} unsaved</span>}
                    </span>
                    <span className="tiny muted">
                      {c.collections} collections · {c.environments} environments · {c.history} history · {c.runs} runs
                    </span>
                  </div>
                )}
                {renaming !== w.id && (
                  <div className="row ws-actions">
                    {!active && <button type="button" className="btn small primary" onClick={() => switchTo(w.id)}>Switch</button>}
                    <button type="button" className="btn small" onClick={() => setRenaming(w.id)}>Rename</button>
                    <button type="button" className="btn small" onClick={() => duplicate(w)} title="Copies collections, environments and globals">
                      <IconCopy size={14} /> Duplicate
                    </button>
                    <button type="button" className="btn small" onClick={() => downloadBytes(buildWorkspaceZip({ meta: w, data: state.data[w.id] ?? emptyWorkspaceData() }), zipFileName(w.name), 'application/zip')}>
                      <IconDownload size={14} /> Export
                    </button>
                    {!isDefaultWorkspace(w) && (
                      <button type="button" className="btn small danger icon" aria-label={`Delete workspace ${w.name}`} title="Delete" onClick={() => remove(w)}>
                        <IconTrash size={14} />
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      {toast}
    </div>
  );
}

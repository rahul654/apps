import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { KVEditor, useToast } from '../components/ui';
import { IconPlus, IconTrash } from '../components/Icons';
import { downloadText } from '../lib/download';
import { environmentFileName, globalsFileName, toEnvironmentFile } from '../lib/postman/export';
import type { PmEnvironmentFile } from '../lib/postman/types';
import { newEnvironment, useWorkspace } from '../store/Workspace';

function VarsEditor({ env, onChange, label }: { env: PmEnvironmentFile; onChange: (e: PmEnvironmentFile) => void; label: string }) {
  const [showSecrets, setShowSecrets] = useState(false);
  return (
    <div className="stack-sm">
      <KVEditor
        label={label}
        secret={!showSecrets}
        rows={env.values.map((v) => ({ key: v.key, value: v.value, disabled: v.enabled === false, description: typeof v.description === 'string' ? v.description : undefined }))}
        onChange={(rows) => onChange({ ...env, values: rows.map((r, i) => ({ ...(env.values[i] ?? {}), key: r.key, value: r.value, type: env.values[i]?.type ?? 'default', enabled: !r.disabled, ...(r.description ? { description: r.description } : {}) })) })}
      />
      <label className="check small">
        <input type="checkbox" checked={showSecrets} onChange={(e) => setShowSecrets(e.target.checked)} /> Show values
      </label>
    </div>
  );
}

export default function EnvironmentsPage() {
  const { state, dispatch } = useWorkspace();
  const { id } = useParams();
  const navigate = useNavigate();
  const [toast, showToast] = useToast();
  const selected = id === 'globals' ? 'globals' : state.environments.find((e) => e.id === id) ? id : null;
  const env = selected && selected !== 'globals' ? state.environments.find((e) => e.id === selected)! : null;
  const create = () => {
    const e = newEnvironment('New environment');
    dispatch({ type: 'environment/put', env: e });
    navigate(`/env/${e.id}`);
  };
  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div className="stack-sm">
            <h1>Environments</h1>
            <p className="muted small">Variables for <code>{'{{name}}'}</code> placeholders. The active environment is picked in the top bar. Values marked secret are still stored in plain text in this browser.</p>
          </div>
          <button type="button" className="btn primary" onClick={create}>
            <IconPlus size={16} /> New environment
          </button>
        </div>
        <div className="env-grid">
          <ul className="list" aria-label="Environments">
            <li className={selected === 'globals' ? 'card tight list-item selected' : 'card tight list-item'}>
              <Link to="/env/globals" className="main-link">
                <span className="name">Globals</span>
                <span className="tiny muted">{state.globals.values.length} variables</span>
              </Link>
            </li>
            {state.environments.map((e) => (
              <li key={e.id} className={selected === e.id ? 'card tight list-item selected' : 'card tight list-item'}>
                <Link to={`/env/${e.id}`} className="main-link">
                  <span className="name">
                    {e.name} {state.activeEnvironmentId === e.id && <span className="pill ok">active</span>}
                  </span>
                  <span className="tiny muted">{e.values.length} variables</span>
                </Link>
              </li>
            ))}
            {!state.environments.length && <li className="muted small">No environments yet.</li>}
          </ul>
          <div className="card">
            {selected === 'globals' && (
              <>
                <div className="row">
                  <h2>Globals</h2>
                  <span className="spacer" />
                  <button type="button" className="btn small" onClick={() => downloadText(JSON.stringify(toEnvironmentFile(state.globals, 'globals'), null, 2), globalsFileName())}>
                    Export
                  </button>
                </div>
                <VarsEditor env={state.globals} label="Global variables" onChange={(g) => dispatch({ type: 'globals/set', globals: g })} />
              </>
            )}
            {env && (
              <>
                <div className="row">
                  <input className="input title-input" value={env.name} onChange={(e) => dispatch({ type: 'environment/put', env: { ...env, name: e.target.value } })} aria-label="Environment name" />
                  <button type="button" className="btn small" aria-pressed={state.activeEnvironmentId === env.id} onClick={() => dispatch({ type: 'environment/active', id: state.activeEnvironmentId === env.id ? null : (env.id ?? null) })}>
                    {state.activeEnvironmentId === env.id ? 'Active' : 'Set active'}
                  </button>
                  <button type="button" className="btn small" onClick={() => downloadText(JSON.stringify(toEnvironmentFile(env), null, 2), environmentFileName(env))}>
                    Export
                  </button>
                  <button type="button" className="btn small" onClick={() => {
                    const copy = { ...env, id: newEnvironment('').id, name: `${env.name} copy` };
                    dispatch({ type: 'environment/put', env: copy });
                    navigate(`/env/${copy.id}`);
                    showToast('Duplicated');
                  }}>
                    Duplicate
                  </button>
                  <button type="button" className="btn small danger icon" aria-label="Delete environment" onClick={() => {
                    if (!window.confirm(`Delete environment "${env.name}"?`)) return;
                    dispatch({ type: 'environment/remove', id: env.id! });
                    navigate('/env');
                  }}>
                    <IconTrash size={15} />
                  </button>
                </div>
                <VarsEditor env={env} label="Environment variables" onChange={(e) => dispatch({ type: 'environment/put', env: e })} />
              </>
            )}
            {!selected && <p className="muted small">Select an environment or the globals to edit them.</p>}
          </div>
        </div>
      </div>
      {toast}
    </div>
  );
}

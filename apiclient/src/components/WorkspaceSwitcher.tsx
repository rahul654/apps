import { useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/AppStore';
import { IconFolders } from './Icons';

/** Switches the active workspace and leaves pages whose URL points at the old workspace's items. */
export function useSwitchWorkspace(): (id: string) => void {
  const { dispatch } = useAppStore();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  return useCallback(
    (id: string) => {
      dispatch({ type: 'workspace/switch', id });
      const to = /^\/(r|c|f|e|new)\//.test(pathname) ? '/' : /^\/env\/.+/.test(pathname) ? '/env' : /^\/runner\/.+/.test(pathname) ? '/runner' : pathname === '/compare' && search ? '/compare' : null;
      if (to) navigate(to);
    },
    [dispatch, navigate, pathname, search],
  );
}

/** Workspace picker plus a link to the Workspaces page. Open tabs and their unsaved edits are kept per workspace (shown on the tabs). */
export function WorkspaceSelect({ className = '' }: { className?: string }) {
  const { state } = useAppStore();
  const switchTo = useSwitchWorkspace();
  return (
    <div className={`ws-select ${className}`.trim()}>
      <label className="ws-select-label">
        <span className="sr-only">Workspace</span>
        <select className="input compact" value={state.activeWorkspaceId} onChange={(e) => switchTo(e.target.value)} title="Workspace">
          {state.workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </label>
      <Link to="/workspaces" className="btn ghost small icon" aria-label="Manage workspaces" title="Manage workspaces">
        <IconFolders size={16} />
      </Link>
    </div>
  );
}

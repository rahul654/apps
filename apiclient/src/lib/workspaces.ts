/**
 * Workspaces: named containers, each with its own collections, environments, globals, active
 * environment, history and saved runs. "App data" is the set of all workspaces. The Default
 * workspace has a fixed id so backups from any browser restore into it.
 */
import type { PmCollection, PmEnvironmentFile } from './postman/types';
import type { RunReport } from './runner/runner';
import type { HistoryEntry } from '../types';

export const DEFAULT_WORKSPACE_ID = 'default';
export const DEFAULT_WORKSPACE_NAME = 'Default';

export interface WorkspaceMeta {
  id: string;
  name: string;
  /** Only the Default workspace; it can be renamed but never deleted. */
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceData {
  collections: PmCollection[];
  environments: PmEnvironmentFile[];
  globals: PmEnvironmentFile;
  activeEnvironmentId: string | null;
  history: HistoryEntry[];
  runs: RunReport[];
}

export const EMPTY_GLOBALS: PmEnvironmentFile = { id: 'globals', name: 'Globals', values: [], _postman_variable_scope: 'globals' };

export function emptyWorkspaceData(): WorkspaceData {
  return { collections: [], environments: [], globals: EMPTY_GLOBALS, activeEnvironmentId: null, history: [], runs: [] };
}

export function defaultWorkspaceMeta(now = new Date().toISOString()): WorkspaceMeta {
  return { id: DEFAULT_WORKSPACE_ID, name: DEFAULT_WORKSPACE_NAME, isDefault: true, createdAt: now, updatedAt: now };
}

export const isDefaultWorkspace = (w: Pick<WorkspaceMeta, 'id' | 'isDefault'>): boolean => w.id === DEFAULT_WORKSPACE_ID || w.isDefault === true;

/** Default first, then by creation time (stable for equal times). */
export function sortWorkspaces(list: WorkspaceMeta[]): WorkspaceMeta[] {
  return [...list].sort((a, b) => Number(isDefaultWorkspace(b)) - Number(isDefaultWorkspace(a)) || a.createdAt.localeCompare(b.createdAt));
}

export function cleanWorkspaceName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** Workspace names are unique, ignoring case: "Name", then "Name (2)", "Name (3)"… */
export function uniqueWorkspaceName(name: string, existing: Pick<WorkspaceMeta, 'id' | 'name'>[], exceptId?: string): string {
  const base = cleanWorkspaceName(name) || 'Workspace';
  const taken = new Set(existing.filter((w) => w.id !== exceptId).map((w) => w.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** Finds a workspace by name, ignoring case. */
export function findWorkspaceByName<T extends Pick<WorkspaceMeta, 'name'>>(list: T[], name: string): T | undefined {
  const n = cleanWorkspaceName(name).toLowerCase();
  return list.find((w) => w.name.toLowerCase() === n);
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** A duplicate copies collections, environments, globals and the active environment; history and runs stay behind. */
export function duplicateWorkspaceData(d: WorkspaceData): WorkspaceData {
  return { collections: clone(d.collections), environments: clone(d.environments), globals: clone(d.globals), activeEnvironmentId: d.activeEnvironmentId, history: [], runs: [] };
}

export function workspaceCounts(d: WorkspaceData | undefined): { collections: number; environments: number; history: number; runs: number } {
  return { collections: d?.collections.length ?? 0, environments: d?.environments.length ?? 0, history: d?.history.length ?? 0, runs: d?.runs.length ?? 0 };
}

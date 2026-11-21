/**
 * Decides where an import goes. Pure: takes the current app data and a parsed import, returns
 * one operation per touched workspace (its full new data, plus a new or renamed meta).
 *
 * Strategies:
 *  - 'target'      everything (all groups flattened) into one workspace: existing, or a new one;
 *  - 'restore'     an all-workspaces zip: each group back into the workspace with its id
 *                  (created when missing, Default always maps to Default), name included;
 *  - 'per-postman' a script zip: each Postman workspace into the app workspace with the same
 *                  name (ignoring case), created when missing.
 * Merge/Replace applies only inside the workspaces an operation touches.
 */
import { uuid } from '../id';
import { DEFAULT_WORKSPACE_ID, emptyWorkspaceData, findWorkspaceByName, uniqueWorkspaceName, type WorkspaceData, type WorkspaceMeta } from '../workspaces';
import { flattenGroups, mergeWorkspace, type ImportMode, type MergeSummary, type ParsedGroup, type ParsedImport } from './zip';

export type ImportStrategy = 'target' | 'restore' | 'per-postman';
export type ImportTarget = { kind: 'existing'; id: string } | { kind: 'new'; name: string };

export interface ImportOptions {
  strategy: ImportStrategy;
  mode: ImportMode;
  /** Used by the 'target' strategy. */
  target: ImportTarget;
  now?: string;
  newId?: () => string;
}

export interface ImportOp {
  ws: string;
  /** Set when the workspace is created by this import. */
  create?: WorkspaceMeta;
  /** Set when an existing workspace takes the imported name (restore). */
  rename?: string;
  data: WorkspaceData;
  /** Final name, for messages. */
  name: string;
  summary: MergeSummary;
}

export interface AppDataLike {
  workspaces: WorkspaceMeta[];
  data: Record<string, WorkspaceData>;
}

/** Which strategies make sense for an import, the first being the default. */
export function strategiesFor(parsed: ParsedImport): ImportStrategy[] {
  if (parsed.kind === 'all-workspaces') return ['restore', 'target'];
  if (parsed.kind === 'postman-api') return ['target', 'per-postman'];
  return ['target'];
}

const addSummary = (a: MergeSummary, b: MergeSummary): MergeSummary => ({ collections: a.collections + b.collections, environments: a.environments + b.environments, globals: a.globals + b.globals, history: a.history + b.history, runs: a.runs + b.runs, requests: a.requests + b.requests, replaced: a.replaced + b.replaced });

export function planImport(app: AppDataLike, parsed: ParsedImport, opts: ImportOptions): ImportOp[] {
  const now = opts.now ?? new Date().toISOString();
  const newId = opts.newId ?? uuid;
  const metas: WorkspaceMeta[] = [...app.workspaces];
  const ops = new Map<string, ImportOp>();

  const apply = (ws: string, group: ParsedGroup, extra: { create?: WorkspaceMeta; rename?: string }) => {
    const prev = ops.get(ws);
    // Replace clears a workspace once; further groups for the same workspace merge on top.
    const base = prev?.data ?? app.data[ws] ?? emptyWorkspaceData();
    const { summary, ...data } = mergeWorkspace(base, group, prev ? 'merge' : opts.mode);
    const create = prev?.create ?? extra.create;
    const rename = extra.rename ?? prev?.rename;
    const name = rename ?? create?.name ?? metas.find((m) => m.id === ws)?.name ?? ws;
    ops.set(ws, { ws, ...(create ? { create } : {}), ...(rename && !create ? { rename } : {}), data, name, summary: prev ? addSummary(prev.summary, summary) : summary });
  };
  const createMeta = (id: string, name: string, createdAt = now): WorkspaceMeta => {
    const meta: WorkspaceMeta = { id, name: uniqueWorkspaceName(name, metas), createdAt, updatedAt: now };
    metas.push(meta);
    return meta;
  };

  if (opts.strategy === 'target') {
    const group = flattenGroups(parsed.groups);
    if (opts.target.kind === 'new') {
      const meta = createMeta(newId(), opts.target.name || parsed.suggestedName);
      apply(meta.id, group, { create: meta });
    } else {
      const wanted = opts.target.id;
      apply(metas.some((m) => m.id === wanted) ? wanted : DEFAULT_WORKSPACE_ID, group, {});
    }
  } else if (opts.strategy === 'restore') {
    for (const g of parsed.groups) {
      const id = g.isDefault ? DEFAULT_WORKSPACE_ID : g.id || newId();
      const idx = metas.findIndex((m) => m.id === id);
      if (idx >= 0) {
        const existing = metas[idx];
        const wanted = g.name ? uniqueWorkspaceName(g.name, metas, id) : existing.name;
        const rename = wanted !== existing.name ? wanted : undefined;
        if (rename) metas[idx] = { ...existing, name: rename };
        apply(id, g, rename ? { rename } : {});
      } else {
        apply(id, g, { create: createMeta(id, g.name, g.createdAt) });
      }
    }
  } else {
    for (const g of parsed.groups) {
      const existing = findWorkspaceByName(metas, g.name || 'Postman');
      if (existing) apply(existing.id, g, {});
      else {
        const meta = createMeta(newId(), g.name || 'Postman');
        apply(meta.id, g, { create: meta });
      }
    }
  }
  return [...ops.values()];
}

export function describeSummary(s: MergeSummary): string {
  const parts = [`${s.collections} collections`, `${s.environments} environments`];
  if (s.globals) parts.push(`${s.globals} globals`);
  if (s.history) parts.push(`${s.history} history entries`);
  if (s.runs) parts.push(`${s.runs} runs`);
  if (s.requests) parts.push(`${s.requests} curl requests`);
  return `${parts.join(', ')}${s.replaced ? ` (${s.replaced} replaced by id)` : ''}`;
}

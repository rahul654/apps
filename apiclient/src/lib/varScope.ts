/**
 * Which scope a `{{variable}}` resolves from, for the hover popover, and pure helpers that write a
 * value back into that scope. Precedence matches `lookup()` in variables.ts (highest first):
 * local > iteration data > environment > request > folders (innermost first) > collection > globals.
 * Within one list the last enabled entry wins, as in `varsFromList`.
 */
import type { PmCollection, PmEnvironmentFile, PmEnvironmentValue, PmItem, PmItemGroup, PmVariable } from './postman/types';
import { DYNAMIC_VARIABLES, VAR_RE, type VarMap } from './variables';

export type ScopeKind = 'local' | 'data' | 'environment' | 'request' | 'folder' | 'collection' | 'globals';

export interface VarEntryLike {
  key?: string | null;
  value?: unknown;
  enabled?: boolean;
  disabled?: boolean;
  type?: string;
}

export interface VarSource {
  kind: ScopeKind;
  /** Environment id or folder id. */
  id?: string;
  /** Environment or folder name, for the label. */
  name?: string;
  values: VarEntryLike[];
}

export type VarStatus = 'ok' | 'missing' | 'dynamic';

export interface VarInfo {
  name: string;
  status: VarStatus;
  /** Where it resolves from; null when unresolved or dynamic. */
  source: VarSource | null;
  label: string;
  value: string;
  secret: boolean;
  /** Whether the popover can write the value back (data, local and dynamic values are read-only). */
  editable: boolean;
}

const DYNAMIC = new Set(DYNAMIC_VARIABLES);

export interface SourceContext {
  local?: VarMap;
  data?: VarMap;
  environment?: PmEnvironmentFile | null;
  collection: PmCollection;
  parents: PmItemGroup[];
  item?: PmItem;
  globals: PmEnvironmentFile;
}

const mapToList = (m: VarMap): VarEntryLike[] => Object.entries(m).map(([key, value]) => ({ key, value }));

/** The scopes of a request in precedence order. */
export function varSources(ctx: SourceContext): VarSource[] {
  const out: VarSource[] = [];
  if (ctx.local) out.push({ kind: 'local', values: mapToList(ctx.local) });
  if (ctx.data) out.push({ kind: 'data', values: mapToList(ctx.data) });
  if (ctx.environment) out.push({ kind: 'environment', id: ctx.environment.id, name: ctx.environment.name, values: ctx.environment.values });
  if (ctx.item?.variable) out.push({ kind: 'request', values: ctx.item.variable });
  for (let i = ctx.parents.length - 1; i >= 0; i--) {
    const f = ctx.parents[i];
    if (f.variable) out.push({ kind: 'folder', id: f.id, name: f.name, values: f.variable });
  }
  if (ctx.collection.variable) out.push({ kind: 'collection', name: ctx.collection.info.name, values: ctx.collection.variable });
  out.push({ kind: 'globals', values: ctx.globals.values });
  return out;
}

const isEnabled = (v: VarEntryLike) => !!v.key && !v.disabled && v.enabled !== false;
const str = (v: unknown) => (v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v));

export function scopeLabel(s: Pick<VarSource, 'kind' | 'name'>): string {
  switch (s.kind) {
    case 'environment':
      return `Environment "${s.name ?? ''}"`;
    case 'folder':
      return `Folder "${s.name ?? ''}"`;
    case 'collection':
      return 'Collection';
    case 'request':
      return 'Request';
    case 'globals':
      return 'Globals';
    case 'data':
      return 'Iteration data';
    case 'local':
      return 'Local';
  }
}

/** Resolves one name against the sources, reporting the scope it came from. */
export function findVariable(rawName: string, sources: VarSource[]): VarInfo {
  const name = rawName.trim();
  if (name.startsWith('$') && DYNAMIC.has(name)) return { name, status: 'dynamic', source: null, label: 'Dynamic', value: '', secret: false, editable: false };
  for (const s of sources) {
    let hit: VarEntryLike | undefined;
    for (const v of s.values) if (v.key === name && isEnabled(v)) hit = v;
    if (hit) return { name, status: 'ok', source: s, label: scopeLabel(s), value: str(hit.value), secret: hit.type === 'secret', editable: s.kind !== 'data' && s.kind !== 'local' };
  }
  return { name, status: 'missing', source: null, label: 'Unresolved', value: '', secret: false, editable: true };
}

/** Variable names in a string, with their [from, to) offsets (including the braces). */
export function variableTokens(text: string): { name: string; from: number; to: number }[] {
  const out: { name: string; from: number; to: number }[] = [];
  if (!text.includes('{{')) return out;
  for (const m of text.matchAll(VAR_RE)) out.push({ name: m[1].trim(), from: m.index!, to: m.index! + m[0].length });
  return out;
}

/** Sets `key` in an environment/globals value list: updates the entry that wins, else appends one. */
export function setEnvValue(values: PmEnvironmentValue[], key: string, value: string): PmEnvironmentValue[] {
  let i = -1;
  values.forEach((v, j) => {
    if (v.key === key && v.enabled !== false) i = j;
  });
  if (i >= 0) return values.map((v, j) => (j === i ? { ...v, value } : v));
  return [...values, { key, value, type: 'default', enabled: true }];
}

/** Sets `key` in a collection/folder/request variable list: updates the entry that wins, else appends one. */
export function setPmVariable(list: PmVariable[] | undefined, key: string, value: string): PmVariable[] {
  const vars = list ?? [];
  let i = -1;
  vars.forEach((v, j) => {
    if (v.key === key && !v.disabled) i = j;
  });
  if (i >= 0) return vars.map((v, j) => (j === i ? { ...v, value } : v));
  return [...vars, { key, value, type: 'string' }];
}

/** Where the popover writes. `request` edits the open request's draft, the rest go to the store. */
export type VarTarget = { kind: 'environment'; id: string } | { kind: 'collection'; cid: string } | { kind: 'folder'; cid: string; id: string } | { kind: 'request' } | { kind: 'globals' };

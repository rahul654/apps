/**
 * One request end-to-end: resolve variables → pre-request scripts (collection → folders → request)
 * → send → test scripts → history entry + variable changes. Used by the editor and the runner.
 */
import { uuid } from './id';
import { scopedVariables } from './postman/items';
import type { PmCollection, PmEnvironmentFile, PmItem, PmItemGroup } from './postman/types';
import type { Prefs } from './prefs';
import { buildRequest, type FileLookup, type PreparedRequest } from './request/build';
import { sendRequest, type ResponseRecord } from './request/send';
import { eventScript, type FetchHandler, type ScriptHost } from './scripts/host';
import type { ConsoleLine, SandboxFetchResponse, ScriptPayload, ScriptResult, TestResult } from './scripts/types';
import { resolve, varsFromList, type Scopes, type VarMap } from './variables';
import type { HistoryEntry } from '../types';

export interface ExecInput {
  collection: PmCollection;
  parents: PmItemGroup[];
  item: PmItem;
  environment: PmEnvironmentFile | null;
  globals: PmEnvironmentFile;
  prefs: Prefs;
  files?: FileLookup;
  host: ScriptHost;
  /** Runner context. */
  data?: VarMap;
  local?: VarMap;
  iteration?: number;
  iterationCount?: number;
  runId?: string;
  signal?: AbortSignal;
  /** Skip scripts (e.g. "send without scripts"). */
  noScripts?: boolean;
}

export interface VariableChanges {
  environment?: VarMap;
  globals?: VarMap;
  collection?: VarMap;
  local: VarMap;
}

export interface ExecResult {
  prepared: PreparedRequest;
  response: ResponseRecord;
  tests: TestResult[];
  console: ConsoleLine[];
  scriptErrors: string[];
  nextRequest?: string | null;
  changes: VariableChanges;
  history: HistoryEntry;
}

const BODY_KEEP = 512 * 1024;

export function mergeValues(env: PmEnvironmentFile, vars: VarMap): PmEnvironmentFile {
  const values = env.values.filter((v) => v.key in vars || v.enabled === false).map((v) => (v.key in vars && v.enabled !== false ? { ...v, value: vars[v.key] } : v));
  const present = new Set(values.map((v) => v.key));
  for (const [key, value] of Object.entries(vars)) if (!present.has(key)) values.push({ key, value, type: 'default', enabled: true });
  return { ...env, values };
}

export function mergeCollectionVariables(c: PmCollection, vars: VarMap): PmCollection {
  const list = (c.variable ?? []).filter((v) => !v.key || v.disabled || v.key in vars).map((v) => (v.key && !v.disabled && v.key in vars ? { ...v, value: vars[v.key] } : v));
  const present = new Set(list.map((v) => v.key));
  for (const [key, value] of Object.entries(vars)) if (!present.has(key)) list.push({ key, value, type: 'string' });
  return { ...c, variable: list };
}

export async function executeItem(input: ExecInput): Promise<ExecResult> {
  const { collection, parents, item, host } = input;
  const envVars = input.environment ? varsFromList(input.environment.values) : {};
  const globalVars = varsFromList(input.globals.values);
  const collectionVars = varsFromList(collection.variable);
  const chainVars = scopedVariables(collection, parents, item).map(varsFromList);
  const local: VarMap = { ...(input.local ?? {}) };
  const data = input.data ?? {};
  let vars = { environment: envVars, globals: globalVars, collection: collectionVars, local };
  const scopes = (): Scopes => ({ local: vars.local, data, environment: vars.environment, collectionChain: [...chainVars.slice(0, -1), vars.collection], globals: vars.globals });
  const consoleLines: ConsoleLine[] = [];
  const tests: TestResult[] = [];
  const scriptErrors: string[] = [];
  const fetchHandler: FetchHandler = async (req) => {
    const prepared: PreparedRequest = { method: req.method, url: req.url, headers: req.headers, body: req.body === null ? { kind: 'none' } : { kind: 'text', text: req.body, contentType: null }, missing: [], warnings: [] };
    const res = await sendRequest(prepared, { mode: input.prefs.mode, proxyUrl: input.prefs.proxyUrl, signal: input.signal });
    const out: SandboxFetchResponse = { code: res.status, status: res.statusText, headers: res.headers, body: res.bodyText, responseTime: res.time };
    if (res.error) out.error = res.error.message;
    return out;
  };
  const info = (eventName: string) => ({ requestName: item.name ?? '', requestId: item.id ?? '', iteration: input.iteration ?? 0, iterationCount: input.iterationCount ?? 1, eventName });

  let prepared = buildRequest(item, { scopes: scopes(), parents, collection, files: input.files });
  let nextRequest: string | null | undefined;

  const runScript = async (kind: 'prerequest' | 'test', script: string, response?: ScriptPayload['response']): Promise<ScriptResult | null> => {
    if (!script.trim()) return null;
    const payload: ScriptPayload = {
      id: uuid(),
      kind,
      script,
      request: { method: prepared.method, url: prepared.url, headers: prepared.headers.map((h) => ({ ...h })), body: prepared.body.kind === 'text' ? prepared.body.text : null, name: item.name ?? '', id: item.id ?? '' },
      response,
      variables: { ...vars, data },
      info: info(kind),
    };
    let r: ScriptResult;
    try {
      r = await host.run(payload, fetchHandler);
    } catch (e) {
      scriptErrors.push(e instanceof Error ? e.message : String(e));
      return null;
    }
    consoleLines.push(...r.console);
    tests.push(...r.tests);
    if (r.error) scriptErrors.push(`${kind === 'prerequest' ? 'Pre-request' : 'Test'} script: ${r.error}`);
    vars = { environment: r.variables.environment, globals: r.variables.globals, collection: r.variables.collection, local: r.variables.local };
    if (r.nextRequest !== undefined) nextRequest = r.nextRequest;
    if (kind === 'prerequest') {
      const body = r.request.body;
      prepared = { ...prepared, method: r.request.method, url: r.request.url, headers: r.request.headers, body: body === null ? prepared.body : prepared.body.kind === 'text' ? { ...prepared.body, text: body } : prepared.body.kind === 'none' ? { kind: 'text', text: body, contentType: null } : prepared.body };
    }
    return r;
  };

  // Scripts in Postman order: collection, then each folder outermost first, then the request.
  const owners = [collection, ...parents, item];
  if (!input.noScripts) {
    for (const o of owners) await runScript('prerequest', eventScript(o.event, 'prerequest'));
    // Variables set by pre-request scripts apply to the request (re-resolve unresolved parts).
    prepared = reResolve(prepared, scopes());
  }

  const response = await sendRequest(prepared, { mode: input.prefs.mode, proxyUrl: input.prefs.proxyUrl, signal: input.signal });

  if (!input.noScripts) {
    const snapshot: ScriptPayload['response'] = { code: response.status, status: response.statusText, headers: response.headers, body: response.bodyText, responseTime: response.time, responseSize: response.size };
    for (const o of owners) await runScript('test', eventScript(o.event, 'test'), snapshot);
  }

  const changes: VariableChanges = { local: vars.local };
  if (!shallowEqual(vars.environment, envVars)) changes.environment = vars.environment;
  if (!shallowEqual(vars.globals, globalVars)) changes.globals = vars.globals;
  if (!shallowEqual(vars.collection, collectionVars)) changes.collection = vars.collection;

  const history: HistoryEntry = {
    id: uuid(),
    at: new Date().toISOString(),
    collectionId: collection.info._postman_id,
    requestId: item.id,
    requestName: item.name,
    method: prepared.method,
    url: prepared.url,
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    time: response.time,
    size: response.size,
    timings: response.timings,
    via: response.via,
    request: { headers: prepared.headers, body: prepared.body.kind === 'text' ? prepared.body.text.slice(0, BODY_KEEP) : prepared.body.kind === 'form' ? `[form-data: ${prepared.body.parts.map((p) => p.key).join(', ')}]` : prepared.body.kind === 'bytes' ? `[binary ${prepared.body.fileName ?? ''}]` : null },
    response: { headers: response.headers, bodyText: response.bodyText.slice(0, BODY_KEEP), contentType: response.contentType, binary: response.binary, truncated: response.truncated || response.bodyText.length > BODY_KEEP, ...(response.setCookie?.length ? { setCookie: response.setCookie } : {}) },
    ...(response.error ? { error: response.error } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
  };
  return { prepared, response, tests, console: consoleLines, scriptErrors, nextRequest, changes, history };
}

function reResolve(p: PreparedRequest, scopes: Scopes): PreparedRequest {
  if (!p.missing.length) return p;
  const url = resolve(p.url, scopes);
  const headers = p.headers.map((h) => ({ key: resolve(h.key, scopes).text, value: resolve(h.value, scopes).text }));
  const body = p.body.kind === 'text' ? { ...p.body, text: resolve(p.body.text, scopes).text } : p.body;
  const missing = new Set<string>(url.missing);
  return { ...p, url: url.text, headers, body, missing: [...missing] };
}

function shallowEqual(a: VarMap, b: VarMap): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => b[k] === a[k]);
}

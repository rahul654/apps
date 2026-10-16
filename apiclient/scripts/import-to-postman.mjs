#!/usr/bin/env node
/**
 * Uploads collections, environments and globals into Postman through the Postman API, with every
 * value exactly as in the files. It skips Postman's Import screen, which empties values its secret
 * scanner flags and can fail part-way.
 *
 *   node import-to-postman.mjs <zip|folder|file> --workspace "Team Workspace"   everything into one workspace
 *   node import-to-postman.mjs <zip|folder>     --per-workspace                one Postman workspace per source workspace
 *
 * Options:
 *   --dry-run         show what would happen; change nothing
 *   --skip-existing   leave collections/environments that already exist (same name) untouched; default is to update them
 *   --yes             don't ask for confirmation
 *
 * Reads: API Client exports (all workspaces or one), export-from-postman.mjs zips, Postman's own
 * export zips, unzipped folders of any of those, and single .postman_collection/environment/globals
 * files. Files are recognised by content. App-only files (_apiclient/, manifest.json) are ignored.
 *
 * The API key is asked for at a hidden prompt (or read from POSTMAN_API_KEY) and never written
 * anywhere. Guide: IMPORT-TO-POSTMAN.md
 */
import { createInterface } from 'node:readline/promises';
import { classify, createApi, readApiKey, readInput } from './lib/postman-api.mjs';

function parseArgs(argv) {
  const opts = { inputs: [], workspace: null, perWorkspace: false, dryRun: false, skipExisting: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--workspace' || a === '-w') opts.workspace = argv[++i] ?? '';
    else if (a.startsWith('--workspace=')) opts.workspace = a.slice('--workspace='.length);
    else if (a === '--per-workspace') opts.perWorkspace = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--skip-existing') opts.skipExisting = true;
    else if (a === '--yes' || a === '-y') opts.yes = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a.startsWith('-')) fail(`Unknown option ${a}. See --help.`);
    else opts.inputs.push(a);
  }
  return opts;
}

function fail(msg) {
  console.error(msg);
  process.exit(2);
}

/**
 * Finds the Postman files and which source workspace each belongs to (null when the input has no
 * workspace structure). Uses the manifest of an API Client all-workspaces export
 * (workspaces/<folder>/…) or of an export-from-postman.mjs zip (manifest.workspaces[].files).
 */
export function collectFiles(entries) {
  const parsed = [];
  for (const e of entries) {
    if (!e.path.toLowerCase().endsWith('.json') || e.path.split('/').includes('_apiclient')) continue;
    try {
      parsed.push({ path: e.path, json: JSON.parse(e.text) });
    } catch {
      /* not JSON: ignore */
    }
  }
  // The manifest nearest the root sets the prefix (a zipped folder adds one top-level directory).
  const manifests = parsed.filter((p) => p.path.split('/').pop() === 'manifest.json' && p.json?.app === 'apiclient').sort((a, b) => a.path.split('/').length - b.path.split('/').length);
  const manifest = manifests[0]?.json ?? null;
  const prefix = manifests[0] ? manifests[0].path.slice(0, -'manifest.json'.length) : '';

  const byFile = new Map();
  if (manifest?.kind === 'all-workspaces') {
    for (const w of manifest.workspaces ?? []) byFile.set(`dir:${prefix}workspaces/${w.folder}/`, w.name);
  } else if (manifest?.source === 'postman-api') {
    for (const w of manifest.workspaces ?? []) {
      for (const c of w.collections ?? []) byFile.set(prefix + c.file, w.name);
      for (const e of w.environments ?? []) byFile.set(prefix + e.file, w.name);
      if (w.id) byFile.set(`globals:globals-${w.id}`, w.name);
    }
  }
  const singleName = manifest?.kind === 'workspace' ? (manifest.workspace?.name ?? manifest.workspaces?.[0]?.name ?? null) : null;
  const workspaceOf = (path, json) => {
    if (byFile.has(path)) return byFile.get(path);
    if (json?.id && byFile.has(`globals:${json.id}`)) return byFile.get(`globals:${json.id}`);
    for (const [k, name] of byFile) if (k.startsWith('dir:') && path.startsWith(k.slice(4))) return name;
    return singleName;
  };

  const files = [];
  for (const p of parsed) {
    const kind = classify(p.json);
    if (kind) files.push({ kind, path: p.path, json: p.json, source: workspaceOf(p.path, p.json) });
  }
  return files;
}

/** Postman assigns ids; ids from another account or a deleted copy make the API refuse the upload. */
function stripIds(node) {
  if (Array.isArray(node)) return node.map(stripIds);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === 'id' || k === 'uid' || k === '_postman_id' || k === '_exporter_id' || k === '_collection_link') continue;
    out[k] = stripIds(v);
  }
  return out;
}

const envValues = (values) =>
  (values ?? []).filter((v) => v && typeof v.key === 'string').map((v) => ({ key: v.key, value: v.value == null ? '' : String(v.value), type: v.type === 'secret' ? 'secret' : 'default', enabled: v.enabled !== false }));

const lower = (s) => String(s ?? '').trim().toLowerCase();

async function confirm(question) {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await rl.question(question);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.inputs.length) {
    console.log(
      'Usage: node import-to-postman.mjs <zip|folder|file>… (--workspace "Name" | --per-workspace) [--dry-run] [--skip-existing] [--yes]\nAsks for your Postman API key (or reads POSTMAN_API_KEY). Guide: IMPORT-TO-POSTMAN.md',
    );
    process.exit(opts.help ? 0 : 2);
  }
  if (!opts.workspace && !opts.perWorkspace) fail('Say where to put things: --workspace "Name" (one Postman workspace) or --per-workspace (one per source workspace).');
  if (opts.workspace !== null && !opts.workspace.trim()) fail('--workspace needs a name.');

  let files = [];
  for (const input of opts.inputs) {
    try {
      files = files.concat(collectFiles(readInput(input)));
    } catch (e) {
      fail(`Can't read ${input}: ${e.message}`);
    }
  }
  if (!files.length) fail('No Postman collections, environments or globals found in the input.');

  // Group by target Postman workspace name.
  const groups = new Map();
  for (const f of files) {
    const target = opts.workspace ?? f.source;
    if (!target) fail(`${f.path} has no workspace in the export. Use --workspace "Name" instead of --per-workspace.`);
    const key = lower(target);
    if (!groups.has(key)) groups.set(key, { name: target.trim(), files: [] });
    groups.get(key).files.push(f);
  }

  const api = createApi(await readApiKey());
  const me = await api.get('/me');
  const { workspaces = [] } = await api.get('/workspaces');
  console.error(`Account: ${me.user?.username ?? me.user?.email ?? me.user?.id}${me.user?.teamName ? ` (team ${me.user.teamName})` : ''}`);

  // Plan.
  const plan = [];
  for (const g of groups.values()) {
    const matches = workspaces.filter((w) => w.id === g.name || lower(w.name) === lower(g.name));
    if (matches.length > 1) fail(`More than one Postman workspace is called "${g.name}": ${matches.map((w) => `${w.name} (${w.id})`).join(', ')}. Pass the id with --workspace.`);
    const ws = matches[0] ?? null;
    const existing = ws ? (await api.get(`/workspaces/${ws.id}`)).workspace : { collections: [], environments: [] };
    const actions = g.files.map((f) => {
      if (f.kind === 'globals') return { f, op: 'merge globals' };
      const name = f.kind === 'collection' ? f.json.info?.name : f.json.name;
      const list = f.kind === 'collection' ? existing.collections ?? [] : existing.environments ?? [];
      const hit = list.filter((x) => lower(x.name) === lower(name));
      if (hit.length && opts.skipExisting) return { f, name, op: 'skip (exists)' };
      if (hit.length > 1) return { f, name, op: 'skip (several with this name)' };
      return { f, name, op: hit.length ? 'update' : 'create', uid: hit[0]?.uid };
    });
    plan.push({ g, ws, actions });
  }

  for (const { g, ws, actions } of plan) {
    console.error(`\n▶ ${ws ? `${ws.name} (existing workspace)` : `${g.name} (new workspace, will be created)`}`);
    for (const a of actions) console.error(`  ${a.op.padEnd(14)} ${a.f.kind.padEnd(11)} ${a.name ?? ''}`);
  }
  const writes = plan.reduce((n, p) => n + p.actions.filter((a) => !a.op.startsWith('skip')).length + (p.ws ? 0 : 1), 0);
  if (opts.dryRun) {
    console.error(`\nDry run: ${writes} change(s) planned, nothing written.`);
    return;
  }
  if (!writes) {
    console.error('\nNothing to do.');
    return;
  }
  if (!opts.yes && !(await confirm(`\nApply these ${writes} change(s) to Postman? [y/N] `))) {
    console.error('Cancelled; nothing written.');
    process.exit(1);
  }

  let done = 0;
  const failed = [];
  for (const { g, ws: found, actions } of plan) {
    let ws = found;
    if (!ws) {
      try {
        ws = (await api.post('/workspaces', { workspace: { name: g.name, type: 'team', description: 'Imported with import-to-postman.mjs' } })).workspace;
        console.error(`\n✔ created workspace ${g.name}`);
      } catch (e) {
        failed.push(`workspace ${g.name}: ${e.message}`);
        console.error(`✖ workspace ${g.name}: ${e.message}`);
        continue;
      }
    }
    console.error(`\n▶ ${ws.name ?? g.name}`);
    for (const a of actions) {
      if (a.op.startsWith('skip')) continue;
      try {
        if (a.f.kind === 'collection') {
          const body = { collection: stripIds(a.f.json) };
          if (a.op === 'update') await api.put(`/collections/${a.uid}`, body);
          else await api.post(`/collections?workspace=${ws.id}`, body);
        } else if (a.f.kind === 'environment') {
          const body = { environment: { name: a.f.json.name, values: envValues(a.f.json.values) } };
          if (a.op === 'update') await api.put(`/environments/${a.uid}`, body);
          else await api.post(`/environments?workspace=${ws.id}`, body);
        } else {
          const current = (await api.get(`/workspaces/${ws.id}/global-variables`)).values ?? [];
          const merged = new Map(current.map((v) => [v.key, v]));
          for (const v of envValues(a.f.json.values)) merged.set(v.key, v);
          await api.put(`/workspaces/${ws.id}/global-variables`, { values: [...merged.values()] });
        }
        done++;
        console.error(`  ✔ ${a.op} ${a.f.kind} ${a.name ?? ''}`);
      } catch (e) {
        failed.push(`${a.f.kind} ${a.name ?? a.f.path}: ${e.message}`);
        console.error(`  ✖ ${a.f.kind} ${a.name ?? a.f.path}: ${e.message}`);
      }
    }
  }
  console.error(`\n${failed.length ? '⚠' : '✔'} ${done} change(s) applied, ${failed.length} failed (${api.calls} API calls).`);
  if (failed.length) {
    for (const f of failed) console.error(`  - ${f}`);
    process.exit(1);
  }
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) await main();

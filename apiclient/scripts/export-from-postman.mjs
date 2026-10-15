#!/usr/bin/env node
/**
 * Exports everything a Postman API key can see (one team) into one zip that the
 * API Client's Data page imports (into one workspace, or one app workspace per Postman
 * workspace using manifest.workspaces), and whose files also open in Postman itself.
 *
 *   POSTMAN_API_KEY=PMAK-… node scripts/export-from-postman.mjs [out.zip]
 *
 * Step-by-step guide, including how to pick the team the key is created in: EXPORT-FROM-POSTMAN.md
 *
 * Zip layout (files are detected by content; manifest.workspaces[].collections/environments[].file
 * and the globals id `globals-<workspace id>` route them to their Postman workspace on import):
 *   collections/<workspace>/<name>.postman_collection.json   Collection v2.1, straight from the API
 *   environments/<workspace>/<name>.postman_environment.json Postman environment file
 *   globals/<workspace>.postman_globals.json                  Workspace globals
 *   manifest.json                                             what was exported, and anything skipped
 *
 * Every collection is validated against the checked-in official v2.1 schema before it's written.
 * The key is read from the environment only and never written anywhere. Secret-type variable
 * values come back from the API masked, so they are listed in the manifest for you to re-enter.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { zipSync, strToU8 } = require('fflate');
const Ajv04 = require('ajv-draft-04');
const addFormats = require('ajv-formats');
const collectionSchema = require('../src/lib/postman/__schemas__/collection-v2.1.0.json');

const API = 'https://api.getpostman.com';
const key = process.env.POSTMAN_API_KEY;
if (!key) {
  console.error('Set POSTMAN_API_KEY first (create one at https://postman.co/settings/me/api-keys).');
  process.exit(2);
}
const outPath = process.argv[2] ?? join(process.env.HOME ?? '.', 'Downloads', `postman-export-${new Date().toISOString().slice(0, 10)}.zip`);
if (existsSync(outPath)) {
  console.error(`${outPath} already exists; pass a different output path.`);
  process.exit(2);
}

const ajv = new Ajv04({ strict: false, allErrors: true });
addFormats(ajv);
const validateCollection = ajv.compile(collectionSchema);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let calls = 0;

/** GET with retry on rate limits (429) and transient errors. */
async function get(path) {
  for (let attempt = 0; ; attempt++) {
    calls++;
    const res = await fetch(API + path, { headers: { 'X-Api-Key': key, Accept: 'application/json' } });
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 5) throw new Error(`${path}: HTTP ${res.status} after ${attempt} retries`);
      const wait = Number(res.headers.get('retry-after') ?? 0) * 1000 || 2000 * 2 ** attempt;
      console.error(`  ${res.status} on ${path}, waiting ${wait / 1000}s`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${path}: HTTP ${res.status} ${body.slice(0, 200)}`);
    }
    return res.json();
  }
}

const safeName = (s) => (s || 'untitled').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 100);
const unique = (used, name, ext) => {
  let candidate = `${name}${ext}`;
  for (let i = 2; used.has(candidate); i++) candidate = `${name} (${i})${ext}`;
  used.add(candidate);
  return candidate;
};
const exportedAt = new Date().toISOString();
const files = {};
const manifest = {
  app: 'apiclient',
  source: 'postman-api',
  exportedAt,
  workspaces: [],
  skipped: [],
  warnings: [],
  maskedSecrets: [],
};

/** Downloads one collection and writes it. Schema problems are recorded as warnings, not skipped: Postman itself produced the file. */
async function saveCollection(c, folder, entry) {
  const { collection } = await get(`/collections/${c.uid}`);
  const name = collection.info?.name ?? c.name;
  let warning = '';
  if (!validateCollection(collection)) {
    const errs = (validateCollection.errors ?? []).slice(0, 3).map((e) => `${e.instancePath || '/'} ${e.message}`);
    warning = `not strictly valid v2.1: ${errs.join('; ')}`;
    manifest.warnings.push({ kind: 'collection', uid: c.uid, name, reason: warning });
  }
  const path = unique(usedPaths, `collections/${folder}/${safeName(name)}`, '.postman_collection.json');
  files[path] = strToU8(JSON.stringify(collection, null, 2));
  entry.collections.push({ uid: c.uid, name, file: path });
  console.error(`  ${warning ? '⚠' : '✔'} ${name}${warning ? ` (${warning})` : ''}`);
}

const me = await get('/me');
console.error(`Account: ${me.user?.username ?? me.user?.email ?? me.user?.id}`);

const { workspaces } = await get('/workspaces');
console.error(`${workspaces.length} workspace(s)`);

const seenCollections = new Set();
const seenEnvironments = new Set();
const usedPaths = new Set();

for (const ws of workspaces) {
  const wsName = safeName(ws.name);
  console.error(`\n▶ ${ws.name} (${ws.type})`);
  const detail = (await get(`/workspaces/${ws.id}`)).workspace;
  const entry = { id: ws.id, name: ws.name, type: ws.type, collections: [], environments: [], globals: 0 };

  for (const c of detail.collections ?? []) {
    if (seenCollections.has(c.uid)) continue;
    seenCollections.add(c.uid);
    try {
      await saveCollection(c, wsName, entry);
    } catch (e) {
      manifest.skipped.push({ kind: 'collection', uid: c.uid, name: c.name, reason: String(e.message ?? e) });
      console.error(`  ✖ ${c.name}: ${e.message ?? e}`);
    }
  }

  for (const env of detail.environments ?? []) {
    if (seenEnvironments.has(env.uid)) continue;
    seenEnvironments.add(env.uid);
    try {
      const { environment } = await get(`/environments/${env.uid}`);
      const values = (environment.values ?? []).map((v) => ({ key: v.key, value: v.value ?? '', type: v.type === 'secret' ? 'secret' : 'default', enabled: v.enabled !== false }));
      for (const v of values) if (v.type === 'secret' && !v.value) manifest.maskedSecrets.push({ environment: environment.name, key: v.key });
      const file = {
        id: environment.id,
        name: environment.name,
        values,
        _postman_variable_scope: 'environment',
        _postman_exported_at: exportedAt,
        _postman_exported_using: 'apiclient/export-from-postman',
      };
      const path = unique(usedPaths, `environments/${wsName}/${safeName(environment.name)}`, '.postman_environment.json');
      files[path] = strToU8(JSON.stringify(file, null, 2));
      entry.environments.push({ uid: env.uid, name: environment.name, file: path });
      console.error(`  ✔ env ${environment.name}`);
    } catch (e) {
      manifest.skipped.push({ kind: 'environment', uid: env.uid, name: env.name, reason: String(e.message ?? e) });
      console.error(`  ✖ env ${env.name}: ${e.message ?? e}`);
    }
  }

  try {
    const { values = [] } = await get(`/workspaces/${ws.id}/global-variables`);
    if (values.length) {
      const file = {
        id: `globals-${ws.id}`,
        name: `${ws.name} globals`,
        values: values.map((v) => ({ key: v.key, value: v.value ?? '', type: v.type === 'secret' ? 'secret' : 'default', enabled: v.enabled !== false })),
        _postman_variable_scope: 'globals',
        _postman_exported_at: exportedAt,
        _postman_exported_using: 'apiclient/export-from-postman',
      };
      files[unique(usedPaths, `globals/${wsName}`, '.postman_globals.json')] = strToU8(JSON.stringify(file, null, 2));
      entry.globals = values.length;
      console.error(`  ✔ ${values.length} global variable(s)`);
    }
  } catch (e) {
    manifest.skipped.push({ kind: 'globals', workspace: ws.name, reason: String(e.message ?? e) });
  }
  manifest.workspaces.push(entry);
}

// Anything the account lists that no workspace detail mentioned (e.g. items whose workspace the key can't see).
const unfiled = { id: null, name: 'Unfiled', type: 'account', collections: [], environments: [], globals: 0 };
for (const c of (await get('/collections')).collections ?? []) {
  if (seenCollections.has(c.uid)) continue;
  seenCollections.add(c.uid);
  if (!unfiled.collections.length) console.error('\n▶ Not listed under any workspace');
  try {
    await saveCollection(c, 'Unfiled', unfiled);
  } catch (e) {
    manifest.skipped.push({ kind: 'collection', uid: c.uid, name: c.name, reason: String(e.message ?? e) });
    console.error(`  ✖ ${c.name}: ${e.message ?? e}`);
  }
}
for (const env of (await get('/environments')).environments ?? []) {
  if (seenEnvironments.has(env.uid)) continue;
  seenEnvironments.add(env.uid);
  manifest.skipped.push({ kind: 'environment', uid: env.uid, name: env.name, reason: 'not listed under any workspace; export it from the app' });
}
if (unfiled.collections.length) manifest.workspaces.push(unfiled);

files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
writeFileSync(outPath, zipSync(files, { level: 6 }));

const nc = manifest.workspaces.reduce((n, w) => n + w.collections.length, 0);
const ne = manifest.workspaces.reduce((n, w) => n + w.environments.length, 0);
console.error(`\n✔ ${nc} collection(s), ${ne} environment(s), ${manifest.workspaces.filter((w) => w.globals).length} globals file(s) → ${outPath} (${calls} API calls)`);
if (manifest.warnings.length) console.error(`${manifest.warnings.length} collection(s) have schema warnings (still exported); see manifest.json inside the zip.`);
if (manifest.skipped.length) console.error(`${manifest.skipped.length} item(s) skipped; see manifest.json inside the zip.`);
if (manifest.maskedSecrets.length) console.error(`${manifest.maskedSecrets.length} secret value(s) came back masked and must be re-entered; listed in manifest.json.`);

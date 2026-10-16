/**
 * Runs scripts/export-from-postman.mjs and scripts/import-to-postman.mjs as real processes against
 * a fake Postman API (port 4328), so the round trip is tested without a Postman account.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const PORT = 4328;
const KEY = 'PMAK-0123456789abcdef01234567-0123456789abcdef0123456789abcdef01';
// APICLIENT_SCRIPTS_DIR lets the same tests run against the bundled standalone copies in dist/.
const scriptsDir = process.env.APICLIENT_SCRIPTS_DIR ?? fileURLToPath(new URL('../../../scripts/', import.meta.url));
const SECRET = 'Basic dXNlcjpzdXBlci1zZWNyZXQtcGFzc3dvcmQ=';

interface Ws { id: string; name: string; type: string; collections: Map<string, any>; environments: Map<string, any>; globals: any[] }
let workspaces: Ws[] = [];
let seq = 0;
let writes = 0;
const nextId = () => `id${++seq}`;

function addCollection(ws: Ws, collection: any) {
  const id = nextId();
  ws.collections.set(id, { ...collection, info: { ...collection.info, _postman_id: id } });
  return id;
}
function addEnvironment(ws: Ws, env: any) {
  const id = nextId();
  ws.environments.set(id, { id, name: env.name, values: env.values });
  return id;
}
const findColl = (uid: string) => workspaces.find((w) => w.collections.has(uid));
const findEnv = (uid: string) => workspaces.find((w) => w.environments.has(uid));

let server: http.Server;
beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const send = (code: number, obj: unknown) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (req.headers['x-api-key'] !== KEY) return send(401, { error: { name: 'AuthenticationError' } });
      const url = new URL(req.url!, `http://127.0.0.1:${PORT}`);
      const parts = url.pathname.split('/').filter(Boolean);
      const data = body ? JSON.parse(body) : null;
      if (req.method !== 'GET') writes++;
      const m = (method: string, ...p: string[]) => req.method === method && p.length === parts.length && p.every((x, i) => x === '*' || x === parts[i]);
      if (m('GET', 'me')) return send(200, { user: { id: 1, username: 'jane' } });
      if (m('GET', 'workspaces')) return send(200, { workspaces: workspaces.map(({ id, name, type }) => ({ id, name, type })) });
      if (m('POST', 'workspaces')) {
        const ws: Ws = { id: nextId(), name: data.workspace.name, type: data.workspace.type, collections: new Map(), environments: new Map(), globals: [] };
        workspaces.push(ws);
        return send(200, { workspace: { id: ws.id, name: ws.name } });
      }
      if (m('GET', 'workspaces', '*', 'global-variables')) return send(200, { values: workspaces.find((w) => w.id === parts[1])!.globals });
      if (m('PUT', 'workspaces', '*', 'global-variables')) {
        workspaces.find((w) => w.id === parts[1])!.globals = data.values;
        return send(200, { values: data.values });
      }
      if (m('GET', 'workspaces', '*')) {
        const ws = workspaces.find((w) => w.id === parts[1]);
        if (!ws) return send(404, { error: { name: 'notFound' } });
        return send(200, {
          workspace: {
            id: ws.id,
            name: ws.name,
            type: ws.type,
            collections: [...ws.collections].map(([uid, c]) => ({ id: uid, uid, name: c.info.name })),
            environments: [...ws.environments].map(([uid, e]) => ({ id: uid, uid, name: e.name })),
          },
        });
      }
      if (m('GET', 'collections')) return send(200, { collections: workspaces.flatMap((w) => [...w.collections].map(([uid, c]) => ({ uid, name: c.info.name }))) });
      if (m('GET', 'collections', '*')) return send(200, { collection: findColl(parts[1])!.collections.get(parts[1]) });
      if (m('POST', 'collections')) {
        if (JSON.stringify(data).includes('"_postman_id"')) return send(400, { error: { name: 'instanceFoundError', message: 'ids must not be reused' } });
        const uid = addCollection(workspaces.find((w) => w.id === url.searchParams.get('workspace'))!, data.collection);
        return send(200, { collection: { id: uid, uid, name: data.collection.info.name } });
      }
      if (m('PUT', 'collections', '*')) {
        const ws = findColl(parts[1])!;
        ws.collections.set(parts[1], { ...data.collection, info: { ...data.collection.info, _postman_id: parts[1] } });
        return send(200, { collection: { uid: parts[1] } });
      }
      if (m('GET', 'environments')) return send(200, { environments: workspaces.flatMap((w) => [...w.environments].map(([uid, e]) => ({ uid, name: e.name }))) });
      if (m('GET', 'environments', '*')) return send(200, { environment: findEnv(parts[1])!.environments.get(parts[1]) });
      if (m('POST', 'environments')) {
        const uid = addEnvironment(workspaces.find((w) => w.id === url.searchParams.get('workspace'))!, data.environment);
        return send(200, { environment: { uid, name: data.environment.name } });
      }
      if (m('PUT', 'environments', '*')) {
        findEnv(parts[1])!.environments.set(parts[1], { id: parts[1], ...data.environment });
        return send(200, { environment: { uid: parts[1] } });
      }
      send(404, { error: { name: 'notFound', message: `${req.method} ${url.pathname}` } });
    });
  });
  await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', r));
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const collection = (name: string) => ({
  info: { name, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [{ name: 'Login', request: { method: 'POST', url: { raw: '{{url}}/login' }, header: [{ key: 'Authorization', value: '{{auth}}' }] } }],
});

function seedAccount() {
  workspaces = [];
  writes = 0;
  const team: Ws = { id: nextId(), name: 'Team Workspace', type: 'team', collections: new Map(), environments: new Map(), globals: [] };
  const mine: Ws = { id: nextId(), name: 'My Workspace', type: 'personal', collections: new Map(), environments: new Map(), globals: [{ key: 'g1', value: 'global-value', type: 'default', enabled: true }] };
  addCollection(team, collection('Orders API'));
  addEnvironment(team, { name: 'orders-uat', values: [{ key: 'url', value: 'https://uat.example.com', type: 'default', enabled: true }, { key: 'auth', value: SECRET, type: 'default', enabled: true }] });
  addCollection(mine, collection('Scratch'));
  workspaces.push(team, mine);
}

function run(script: string, args: string[]): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(scriptsDir, script), ...args], {
      env: { ...process.env, POSTMAN_API_URL: `http://127.0.0.1:${PORT}`, POSTMAN_API_KEY: KEY },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('exit', (code) => resolve({ code, out }));
  });
}

let dir: string;
beforeEach(() => {
  seedAccount();
  dir = mkdtempSync(join(tmpdir(), 'pm-scripts-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

async function exportAccount(): Promise<string> {
  const zip = join(dir, 'export.zip');
  const r = await run('export-from-postman.mjs', [zip]);
  expect(r.code, r.out).toBe(0);
  return zip;
}

describe('export-from-postman + import-to-postman', () => {
  it('round-trips into a fresh account with --per-workspace, keeping every value', async () => {
    const zip = await exportAccount();
    workspaces = []; // a brand-new account
    writes = 0;
    const r = await run('import-to-postman.mjs', [zip, '--per-workspace', '--yes']);
    expect(r.code, r.out).toBe(0);
    expect(workspaces.map((w) => w.name).sort()).toEqual(['My Workspace', 'Team Workspace']);
    const team = workspaces.find((w) => w.name === 'Team Workspace')!;
    const env = [...team.environments.values()][0];
    expect(env.name).toBe('orders-uat');
    expect(env.values.find((v: any) => v.key === 'auth').value).toBe(SECRET);
    expect([...team.collections.values()].map((c) => c.info.name)).toEqual(['Orders API']);
    expect(workspaces.find((w) => w.name === 'My Workspace')!.globals).toEqual([{ key: 'g1', value: 'global-value', type: 'default', enabled: true }]);
  });

  it('updates same-named items instead of duplicating them, and --skip-existing leaves them alone', async () => {
    const zip = await exportAccount();
    const team = workspaces[0];
    const envUid = [...team.environments.keys()][0];
    team.environments.get(envUid).values = [{ key: 'auth', value: '', type: 'default', enabled: true }]; // emptied by Postman's import screen
    const skip = await run('import-to-postman.mjs', [zip, '--workspace', 'Team Workspace', '--skip-existing', '--yes']);
    expect(skip.code, skip.out).toBe(0);
    expect(team.environments.get(envUid).values[0].value).toBe('');

    const r = await run('import-to-postman.mjs', [zip, '--workspace', 'team workspace', '--yes']);
    expect(r.code, r.out).toBe(0);
    expect(team.environments.size).toBe(1);
    expect(team.environments.get(envUid).values.find((v: any) => v.key === 'auth').value).toBe(SECRET);
    // Both collections land in the one workspace: Orders API updated, Scratch created.
    expect([...team.collections.values()].map((c) => c.info.name).sort()).toEqual(['Orders API', 'Scratch']);
  });

  it('--dry-run writes nothing, and it refuses to guess the target', async () => {
    const zip = await exportAccount();
    writes = 0;
    const dry = await run('import-to-postman.mjs', [zip, '--workspace', 'New Place', '--dry-run']);
    expect(dry.code, dry.out).toBe(0);
    expect(dry.out).toMatch(/New Place \(new workspace, will be created\)/);
    expect(dry.out).toMatch(/Dry run: \d+ change/);
    expect(writes).toBe(0);
    const noTarget = await run('import-to-postman.mjs', [zip]);
    expect(noTarget.code).toBe(2);
    expect(noTarget.out).toMatch(/--workspace "Name".*--per-workspace/);
  });

  it('imports an API Client all-workspaces export, ignoring app-only files and stripping ids', async () => {
    const env = { id: 'e1', name: 'local', values: [{ key: 'auth', value: SECRET, type: 'default', enabled: true }], _postman_variable_scope: 'environment' };
    const coll = { ...collection('Billing'), info: { ...collection('Billing').info, _postman_id: 'stale-id' }, item: [{ id: 'item-1', name: 'Get', request: { method: 'GET', url: '{{url}}' } }] };
    const zip = zipSync({
      'manifest.json': strToU8(JSON.stringify({ app: 'apiclient', schemaVersion: 2, kind: 'all-workspaces', workspaces: [{ id: 'default', name: 'Default', folder: 'Default', isDefault: true }, { id: 'w2', name: 'Payments', folder: 'Payments' }] })),
      'workspaces/Default/environments/local.postman_environment.json': strToU8(JSON.stringify(env)),
      'workspaces/Payments/collections/Billing.postman_collection.json': strToU8(JSON.stringify(coll)),
      '_apiclient/Payments/history.json': strToU8('[{"id":"h1"}]'),
    });
    const file = join(dir, 'apiclient.zip');
    writeFileSync(file, zip);
    workspaces = [];
    const r = await run('import-to-postman.mjs', [file, '--per-workspace', '--yes']);
    expect(r.code, r.out).toBe(0);
    expect(workspaces.map((w) => w.name).sort()).toEqual(['Default', 'Payments']);
    const billing = [...workspaces.find((w) => w.name === 'Payments')!.collections.values()][0];
    expect(billing.item[0].id).toBeUndefined();
    expect([...workspaces.find((w) => w.name === 'Default')!.environments.values()][0].values[0].value).toBe(SECRET);
  });

  it('reads an unzipped folder the same as the zip', async () => {
    const zip = await exportAccount();
    const folder = join(dir, 'unzipped');
    for (const [name, data] of Object.entries(unzipSync(new Uint8Array(readFileSync(zip))))) {
      const target = join(folder, name);
      await import('node:fs').then((fs) => {
        fs.mkdirSync(join(target, '..'), { recursive: true });
        fs.writeFileSync(target, data);
      });
    }
    workspaces = [];
    const r = await run('import-to-postman.mjs', [folder, '--per-workspace', '--yes']);
    expect(r.code, r.out).toBe(0);
    expect(workspaces.map((w) => w.name).sort()).toEqual(['My Workspace', 'Team Workspace']);
  });
});

// @vitest-environment jsdom
/**
 * Smoke test: every route renders without React errors against a seeded workspace, the request
 * editor shows resolved snippets, the sidebar creates requests, and the store persists to
 * (fake) IndexedDB. Sending real requests is covered in the browser check.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import App from './App';
import realistic from './lib/postman/__fixtures__/realistic.postman_collection.json';
import envFixture from './lib/postman/__fixtures__/env.postman_environment.json';
import { openStore, STORES } from './lib/db';
import { normalizeCollection, normalizeEnvironment } from './lib/postman/normalize';
import { listRequests } from './lib/postman/items';
import { WorkspaceProvider, type WorkspaceState } from './store/Workspace';
import type { HistoryEntry } from './types';

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  vi.restoreAllMocks();
});

const collection = normalizeCollection(JSON.parse(JSON.stringify(realistic)));
const env = normalizeEnvironment(JSON.parse(JSON.stringify(envFixture)));
const cid = collection.info._postman_id!;
const login = listRequests(collection)[0].item;
const hist = (over: Partial<HistoryEntry>): HistoryEntry => ({ id: 'h', at: '2024-01-01T00:00:00.000Z', method: 'GET', url: 'https://a/b', status: 200, statusText: 'OK', ok: true, time: 12, size: 10, timings: { total: 12, source: 'wall-clock' }, via: 'direct', request: { headers: [], body: null }, response: { headers: [{ key: 'content-type', value: 'application/json' }], bodyText: '{"a":1}', contentType: 'application/json', binary: false }, ...over });
const seeded: Partial<WorkspaceState> = { collections: [collection], environments: [env], activeEnvironmentId: env.id!, history: [hist({ id: 'h1', time: 10 }), hist({ id: 'h2', time: 30, at: '2024-01-01T00:01:00.000Z', response: { headers: [], bodyText: '{"a":2,"b":[1]}', contentType: 'application/json', binary: false } })] };

async function renderAt(path: string, initial: Partial<WorkspaceState> = seeded, storeFactory?: () => Promise<Awaited<ReturnType<typeof openStore>>>) {
  const errors: unknown[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args));
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(
      <StrictMode>
        <MemoryRouter initialEntries={[path]}>
          <WorkspaceProvider initial={initial} storeFactory={storeFactory}>
            <App />
          </WorkspaceProvider>
        </MemoryRouter>
      </StrictMode>,
    );
  });
  // Let lazy routes resolve.
  for (let i = 0; i < 100 && el.textContent?.includes('Loading…'); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
  return { el, errors, done: async () => { await act(async () => root.unmount()); spy.mockRestore(); } };
}

const click = async (el: Element | null | undefined) => {
  if (!el) throw new Error('element not found');
  await act(async () => (el as HTMLElement).click());
};
const byText = (root: Element, selector: string, text: string) => [...root.querySelectorAll(selector)].find((b) => b.textContent?.includes(text)) as HTMLElement | undefined;
const type = async (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  await act(async () => {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('app', () => {
  it('home shows the empty state and the collections sidebar', async () => {
    const { el, errors, done } = await renderAt('/', {});
    expect(el.textContent).toContain('Pick a request');
    expect(el.textContent).toContain('No collections yet');
    expect(errors).toEqual([]);
    await done();
  });

  it('request editor renders tabs, resolves variables in the code snippet, and marks edits unsaved', async () => {
    const { el, errors, done } = await renderAt(`/r/${cid}/${login.id}`);
    expect(el.querySelector<HTMLInputElement>('.url-input')!.value).toBe('{{baseUrl}}/login?remember=true');
    expect(el.querySelector('.tree-row.active')?.textContent).toContain('Login');
    await click(byText(el, '[role=tab]', 'Code'));
    const curl = el.querySelector('.codeview')!.textContent!;
    expect(curl).toContain("curl -X POST 'https://staging.example.com/login?remember=true'");
    expect(curl).toContain('"password": "s3cret"'); // from the active environment
    await click(byText(el, '[role=tab]', 'Headers'));
    expect(el.querySelectorAll('.kv tbody tr')).toHaveLength(2);
    await click(byText(el, '[role=tab]', 'Scripts'));
    expect(el.querySelector<HTMLTextAreaElement>('textarea[aria-label="Post-response script (tests)"]')!.value).toContain("pm.test('logged in'");
    await click(byText(el, '[role=tab]', 'Auth'));
    expect(el.querySelector<HTMLSelectElement>('.tabpanel select')!.value).toBe('noauth');
    await type(el.querySelector<HTMLInputElement>('input[aria-label="Request name"]')!, 'Login renamed');
    expect(el.textContent).toContain('Unsaved changes');
    await click(byText(el, 'button', 'Save'));
    expect(el.textContent).not.toContain('Unsaved changes');
    expect(el.querySelector('.tree-row.active')?.textContent).toContain('Login renamed');
    expect(errors).toEqual([]);
    await done();
  });

  it('collection and folder settings render; sidebar adds a request through the menu', async () => {
    const { el, errors, done } = await renderAt(`/c/${cid}`);
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Collection name"]')!.value).toBe('Realistic API');
    await click(byText(el, '[role=tab]', 'Variables'));
    expect(el.querySelectorAll('.kv tbody tr')).toHaveLength(2);
    await click(el.querySelector('button[aria-label="Actions for collection Realistic API"]'));
    await click(byText(el, '[role=menuitem]', 'Add request'));
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Request name"]')!.value).toBe('New request');
    expect(el.querySelectorAll('.tree-row').length).toBeGreaterThan(5);
    const folder = collection.item[0];
    await click(byText(el, '.tree-link', 'Auth'));
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Folder name"]')!.value).toBe(folder.name!);
    expect(errors).toEqual([]);
    await done();
  });

  it('environments, history, latency, compare, runner, data, proxy and about pages render', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    for (const [path, expected] of [
      [`/env/${env.id}`, 'Staging'],
      ['/history', 'https://a/b'],
      ['/latency', 'p95'],
      ['/runner', 'Collection runner'],
      ['/data', 'Export everything'],
      ['/proxy', 'not reachable'],
      ['/about', 'Postman compatibility'],
    ] as const) {
      const { el, errors, done } = await renderAt(path);
      expect(el.textContent, path).toContain(expected);
      expect(errors, path).toEqual([]);
      await done();
    }
    const { el, errors, done } = await renderAt('/compare');
    // Defaults: A = older entry (h2 is listed second), B = newest; h2 → h1 removes "b" and changes "a".
    expect(el.textContent).toContain('1 removed');
    expect(el.textContent).toContain('1 changed');
    expect(el.querySelector('.diff-list')!.textContent).toContain('$.a');
    await click(byText(el, '[role=tab]', 'Text'));
    expect(el.querySelector('.textdiff')).toBeTruthy();
    expect(errors).toEqual([]);
    await done();
  });

  it('history rows open a response panel with the stored body', async () => {
    const { el, errors, done } = await renderAt('/history');
    await click(el.querySelector('.table tr.selectable'));
    expect(el.querySelector('pre.codeview')!.textContent).toContain('"a": 1');
    expect(errors).toEqual([]);
    await done();
  });

  it('persists collections and environments to IndexedDB through the store', async () => {
    const idb = new IDBFactory();
    const factory = () => openStore(idb, 'smoke');
    const { el, errors, done } = await renderAt('/', {}, factory);
    await click(byText(el, 'button', 'New collection'));
    await type(el.querySelector<HTMLInputElement>('input[aria-label="New name"]')!, 'Persisted');
    await act(async () => {
      el.querySelector<HTMLInputElement>('input[aria-label="New name"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Collection name"]')!.value).toBe('Persisted');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    const store = await factory();
    const rows = await store.getAll<{ id: string; data: { info: { name: string } } }>(STORES.collections);
    expect(rows.map((r) => r.data.info.name)).toEqual(['Persisted']);
    store.close();
    expect(errors).toEqual([]);
    await done();
  });

  it('unknown collection id shows a message', async () => {
    const { el, errors, done } = await renderAt('/c/nope');
    expect(el.textContent).toContain('That collection doesn’t exist');
    expect(errors).toEqual([]);
    await done();
  });
});

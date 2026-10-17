// @vitest-environment jsdom
/**
 * Smoke test: every route renders without React errors against a seeded workspace, the request
 * editor shows resolved snippets, the sidebar creates requests, workspaces switch/create/delete
 * and stay isolated, curl imports into a new workspace, and the store persists to (fake) IndexedDB. Sending real requests is covered in the browser check.
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
import { AppStoreProvider, DRAFT_SAVE_DELAY, type InitialData } from './store/AppStore';
import { EditorView } from '@codemirror/view';
import { DEFAULT_WORKSPACE_ID, emptyWorkspaceData } from './lib/workspaces';
import type { HistoryEntry } from './types';

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView = () => {};
  // jsdom has no layout; CodeMirror measures text ranges.
  const rects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
  Range.prototype.getClientRects = rects;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
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
const seeded: InitialData = { collections: [collection], environments: [env], activeEnvironmentId: env.id!, history: [hist({ id: 'h1', time: 10 }), hist({ id: 'h2', time: 30, at: '2024-01-01T00:01:00.000Z', response: { headers: [], bodyText: '{"a":2,"b":[1]}', contentType: 'application/json', binary: false } })] };

/** `initial: null` loads from the store instead (needs a storeFactory). */
async function renderAt(path: string, initial: InitialData | null = seeded, storeFactory?: () => Promise<Awaited<ReturnType<typeof openStore>>>) {
  const errors: unknown[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args));
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(
      <StrictMode>
        <MemoryRouter initialEntries={[path]}>
          <AppStoreProvider initial={initial ?? undefined} storeFactory={storeFactory}>
            <App />
          </AppStoreProvider>
        </MemoryRouter>
      </StrictMode>,
    );
  });
  // Let lazy routes resolve.
  for (let i = 0; i < 100 && /Loading…|Loading your workspaces/.test(el.textContent ?? ''); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
  return { el, errors, done: async () => { await act(async () => root.unmount()); spy.mockRestore(); } };
}

const waitText = (el: HTMLElement, text: string, ms?: number) => waitForText(el, text, ms);

/** Waits for text that appears after async work (e.g. the proxy status ping), instead of racing it. */
async function waitForText(el: HTMLElement, text: string, ms = 5000) {
  for (let waited = 0; !el.textContent?.includes(text) && waited < ms; waited += 20) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
  expect(el.textContent).toContain(text);
}

/** Polls a condition that becomes true after async work (lazy chunks, IndexedDB, timers). */
async function waitFor(cond: () => boolean, ms = 5000) {
  for (let waited = 0; !cond() && waited < ms; waited += 20) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
  expect(cond()).toBe(true);
}

/** Tab titles; `*` marks unsaved, `(…)` marks a preview tab. */
const tabTitles = (el: HTMLElement) =>
  [...el.querySelectorAll('.req-tab')].map((t) => {
    const title = t.querySelector('.req-tab-title')!.textContent!;
    const s = `${title}${t.classList.contains('dirty') ? '*' : ''}`;
    return t.classList.contains('preview') ? `(${s})` : s;
  });

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

  it('proxy page shows a copyable one-line start command that follows the port field', async () => {
    // No real network: the status ping fails slowly, as on a busy CI runner, so the test must wait for it.
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise((_, reject) => setTimeout(() => reject(new TypeError('Failed to fetch')), 300)));
    const { el, errors, done } = await renderAt('/proxy');
    const code = () => el.querySelector('.command-box code')!.textContent;
    expect(code()).toMatch(/^curl -fsSL .*\/apiclient-proxy\.mjs -o \/tmp\/apiclient-proxy\.mjs && node \/tmp\/apiclient-proxy\.mjs --port 4399$/);
    const input = el.querySelector<HTMLInputElement>('.port-field input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '4500');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(code()).toMatch(/--port 4500$/);
    await waitForText(el, 'not running on port 4500'); // after the status ping fails
    const win = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Windows (PowerShell)')!;
    await act(async () => win.click());
    expect(code()).toMatch(/^iwr .* -OutFile "\$env:TEMP\\apiclient-proxy\.mjs"; node "\$env:TEMP\\apiclient-proxy\.mjs" --port 4500$/);
    expect(errors).toEqual([]);
    await done();
  });

  it('postman page shows copyable export and import commands that follow the fields', async () => {
    const { el, errors, done } = await renderAt('/postman');
    const codes = () => [...el.querySelectorAll('.command-box code')].map((c) => c.textContent);
    expect(codes()[0]).toMatch(/^curl -fsSL .*\/export-from-postman\.mjs -o \/tmp\/export-from-postman\.mjs && node \/tmp\/export-from-postman\.mjs "\$HOME\/Downloads\/postman-export-\d{4}-\d\d-\d\d\.zip"$/);
    expect(codes()[1]).toMatch(/import-to-postman\.mjs "\$HOME\/Downloads\/postman-export-[\d-]+\.zip" --per-workspace$/);
    // The import path follows the export path until it's edited.
    const [saveAs, importFrom] = [...el.querySelectorAll<HTMLInputElement>('.field input.mono')];
    const type = async (input: HTMLInputElement, value: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    await type(saveAs, '~/Downloads/team-a.zip');
    expect(codes()[1]).toMatch(/"\$HOME\/Downloads\/team-a\.zip" --per-workspace$/);
    await type(importFrom, '~/Downloads/other.zip');
    await type(saveAs, '~/Downloads/team-b.zip');
    expect(codes()[0]).toMatch(/"\$HOME\/Downloads\/team-b\.zip"$/);
    expect(codes()[1]).toMatch(/"\$HOME\/Downloads\/other\.zip" --per-workspace$/);
    const one = [...el.querySelectorAll<HTMLInputElement>('input[name=target]')][1];
    await act(async () => one.click());
    expect(codes()[1]).toMatch(/--workspace "Team Workspace"$/);
    expect(el.textContent).not.toContain('PMAK-1');
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
      ['/data', 'Export all workspaces'],
      ['/workspaces', 'Default always exists'],
      ['/proxy', 'not running on port 4399'],
      ['/about', 'Postman compatibility'],
    ] as const) {
      const { el, errors, done } = await renderAt(path);
      await waitForText(el, expected);
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
    await waitFor(() => el.querySelector('section[aria-label="Response"] .cm-content')?.textContent?.includes('"a": 1') ?? false);
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

  const twoWorkspaces = (): InitialData => ({
    workspaces: [
      { id: DEFAULT_WORKSPACE_ID, name: 'Default', isDefault: true, createdAt: '1', updatedAt: '1' },
      { id: 'ws-b', name: 'Second', createdAt: '2', updatedAt: '2' },
    ],
    data: {
      [DEFAULT_WORKSPACE_ID]: { ...emptyWorkspaceData(), collections: [collection], environments: [env], activeEnvironmentId: env.id! },
      'ws-b': { ...emptyWorkspaceData(), environments: [{ id: 'env-b', name: 'B only', values: [] }] },
    },
  });
  const select = async (el: HTMLSelectElement, value: string) => {
    await act(async () => {
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };

  it('the workspace switcher shows only the current workspace’s collections and environments', async () => {
    const { el, errors, done } = await renderAt(`/r/${cid}/${login.id}`, twoWorkspaces());
    const ws = el.querySelector<HTMLSelectElement>('.topbar select[title="Workspace"]')!;
    expect([...ws.options].map((o) => o.textContent)).toEqual(['Default', 'Second']);
    const envSel = () => [...el.querySelector<HTMLSelectElement>('.topbar select[title="Active environment"]')!.options].map((o) => o.textContent);
    expect(envSel()).toEqual(['No environment', 'Staging']);
    // An unsaved edit is kept per workspace.
    await type(el.querySelector<HTMLInputElement>('input[aria-label="Request name"]')!, 'Draft name');
    await select(ws, 'ws-b');
    expect(el.textContent).toContain('No collections yet'); // left the request page: it belongs to Default
    expect(envSel()).toEqual(['No environment', 'B only']);
    // Unsaved state lives on the tabs, not in the switcher.
    expect([...ws.options].map((o) => o.textContent)).toEqual(['Default', 'Second']);
    expect(el.querySelectorAll('.req-tab')).toHaveLength(0); // Second has its own (empty) tabs
    await select(ws, DEFAULT_WORKSPACE_ID);
    // Back in Default: its active tab opens again, with the unsaved edit and a dot.
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Request name"]')!.value).toBe('Draft name');
    expect(tabTitles(el)).toEqual(['Draft name*']);
    expect(errors).toEqual([]);
    await done();
  });

  it('workspaces page creates, switches, and deletes with undo; Default has no delete button', async () => {
    const { el, errors, done } = await renderAt('/workspaces', twoWorkspaces());
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    expect(el.querySelector('button[aria-label="Delete workspace Default"]')).toBeNull();
    await type(el.querySelector<HTMLInputElement>('input[placeholder="e.g. Payments team"]')!, 'Third');
    await click(byText(el, 'button', 'Create'));
    expect(el.querySelector<HTMLSelectElement>('.topbar select[title="Workspace"]')!.value).not.toBe(DEFAULT_WORKSPACE_ID);
    expect(el.querySelector('.ws-item.selected')?.textContent).toContain('Third');
    await click(el.querySelector('button[aria-label="Delete workspace Second"]'));
    expect(el.querySelectorAll('.ws-item')).toHaveLength(2);
    await click(byText(el, '.toast button', 'Undo'));
    expect([...el.querySelectorAll('.ws-item')].map((x) => x.querySelector('strong')?.textContent)).toEqual(['Default', 'Second', 'Third']);
    expect(el.textContent).toContain('0 collections · 1 environments');
    expect(errors).toEqual([]);
    await done();
  });

  it('curl import asks for a target and can create a new workspace', async () => {
    const { el, errors, done } = await renderAt('/data', twoWorkspaces());
    await type(el.querySelector<HTMLTextAreaElement>('textarea')!, "curl -X POST https://api.example.com/items -H 'Content-Type: application/json' -d '{\"a\":1}'");
    await click(byText(el, 'button', 'Import curl'));
    const target = el.querySelector<HTMLSelectElement>('.import-panel select')!;
    expect(target.value).toBe(DEFAULT_WORKSPACE_ID);
    await select(target, '__new__');
    await type(el.querySelector<HTMLInputElement>('.import-panel input:not([type])')!, 'From curl');
    await click(byText(el, '.import-panel button', 'Import'));
    const ws = el.querySelector<HTMLSelectElement>('.topbar select[title="Workspace"]')!;
    expect(ws.options[ws.selectedIndex].textContent).toBe('From curl');
    expect(el.querySelector<HTMLInputElement>('.url-input')!.value).toBe('https://api.example.com/items');
    expect(el.querySelector('.tree')?.textContent).toContain('Imported');
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

describe('tabs, examples, editors and variables', () => {
  const dblclick = async (el: Element | null | undefined) => {
    if (!el) throw new Error('element not found');
    await act(async () => {
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
  };
  const tabEl = (el: HTMLElement, title: string) => [...el.querySelectorAll('.req-tab')].find((t) => t.querySelector('.req-tab-title')?.textContent === title) as HTMLElement | undefined;
  const nameInput = (el: HTMLElement) => el.querySelector<HTMLInputElement>('input[aria-label="Request name"]')!;

  it('single click opens a preview tab that the next click replaces; double click and edits keep it; dirty tabs ask before closing', async () => {
    const { el, errors, done } = await renderAt('/', seeded);
    await click(el.querySelector('button[aria-label="Expand Realistic API"]'));
    await click(byText(el, '.tree-link', 'Upload'));
    expect(tabTitles(el)).toEqual(['(Upload)']);
    await click(byText(el, '.tree-link', 'Form'));
    expect(tabTitles(el)).toEqual(['(Form)']);
    await dblclick(byText(el, '.tree-link', 'Form'));
    expect(tabTitles(el)).toEqual(['Form']);
    await click(byText(el, '.tree-link', 'GraphQL'));
    expect(tabTitles(el)).toEqual(['Form', '(GraphQL)']);
    expect(el.querySelector('.req-tab.active')?.textContent).toContain('GraphQL');
    // Editing a preview tab makes it permanent and marks it unsaved.
    await type(nameInput(el), 'GraphQL edited');
    expect(tabTitles(el)).toEqual(['Form', 'GraphQL edited*']);
    // Clicking an open request focuses its tab.
    await click(byText(el, '.tree-link', 'Form'));
    expect(nameInput(el).value).toBe('Form');
    expect(tabTitles(el)).toEqual(['Form', 'GraphQL edited*']);
    // Closing the unsaved tab asks; Cancel keeps it, Don't save drops the edit.
    await click(tabEl(el, 'GraphQL edited')!.querySelector('.req-tab-close'));
    expect(document.querySelector('[role=dialog]')?.textContent).toContain('“GraphQL edited” has unsaved changes');
    await click(byText(document.body, '[role=dialog] button', 'Cancel'));
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(tabTitles(el)).toEqual(['Form', 'GraphQL edited*']);
    await click(tabEl(el, 'GraphQL edited')!.querySelector('.req-tab-close'));
    await click(byText(document.body, '[role=dialog] button', 'Don’t save'));
    expect(tabTitles(el)).toEqual(['Form']);
    expect(el.querySelector('.tree')?.textContent).toContain('GraphQL'); // the saved name is unchanged
    // Save in the prompt writes the draft into the collection.
    await type(nameInput(el), 'Form saved');
    await click(tabEl(el, 'Form saved')!.querySelector('.req-tab-close'));
    await click([...document.querySelectorAll<HTMLElement>('[role=dialog] button')].find((b) => b.textContent === 'Save'));
    expect(tabTitles(el)).toEqual([]);
    expect(el.textContent).toContain('Pick a request');
    expect(el.querySelector('.tree')?.textContent).toContain('Form saved');
    // Middle-click closes; the context menu closes others.
    await click(byText(el, '.tree-link', 'Upload'));
    await dblclick(byText(el, '.tree-link', 'Upload'));
    await click(byText(el, '.tree-link', 'GraphQL'));
    await dblclick(byText(el, '.tree-link', 'GraphQL'));
    await click(byText(el, '.tree-link', 'OAuth kept'));
    expect(tabTitles(el)).toEqual(['Upload', 'GraphQL', '(OAuth kept)']);
    await act(async () => {
      tabEl(el, 'Upload')!.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    });
    expect(tabTitles(el)).toEqual(['GraphQL', '(OAuth kept)']);
    await act(async () => {
      tabEl(el, 'GraphQL')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
    });
    await click(byText(el.ownerDocument.body, '.tab-menu [role=menuitem]', 'Close others'));
    expect(tabTitles(el)).toEqual(['GraphQL']);
    expect(errors).toEqual([]);
    await done();
  });

  it('a new tab is an unsaved request until saved into a collection', async () => {
    const { el, errors, done } = await renderAt('/', seeded);
    await click(el.querySelector('button[aria-label="New request tab"]'));
    expect(tabTitles(el)).toEqual(['Untitled request']); // nothing typed yet: not unsaved
    await type(el.querySelector<HTMLInputElement>('.url-input')!, 'https://api.example.com/new');
    expect(tabTitles(el)).toEqual(['Untitled request*']);
    await click(byText(el, '.title-row button', 'Save…'));
    const dialog = el.ownerDocument.querySelector('[role=dialog]')!;
    await type(dialog.querySelector<HTMLInputElement>('input')!, 'Created from tab');
    await click(byText(dialog as HTMLElement, 'button', 'Save'));
    expect(tabTitles(el)).toEqual(['Created from tab']);
    expect(el.querySelector('.crumbs')?.textContent).toContain('Realistic API');
    expect(el.querySelector('.tree')?.textContent).toContain('Created from tab');
    expect(errors).toEqual([]);
    await done();
  });

  it('open tabs, the active tab and unsaved edits survive a reload (IndexedDB)', async () => {
    const idb = new IDBFactory();
    const factory = () => openStore(idb, 'tabs-reload');
    const seed = await factory();
    await seed.replaceWorkspace({ id: DEFAULT_WORKSPACE_ID, name: 'Default', isDefault: true, createdAt: '1', updatedAt: '1', globals: emptyWorkspaceData().globals, activeEnvironmentId: env.id! }, { ...emptyWorkspaceData(), collections: [collection], environments: [env], activeEnvironmentId: env.id! });
    seed.close();

    const first = await renderAt(`/r/${cid}/${login.id}`, null, factory);
    await waitFor(() => !!first.el.querySelector('input[aria-label="Request name"]'));
    await dblclick(first.el.querySelector('.req-tab .req-tab-main'));
    await click(byText(first.el, '.tree-link', 'Form'));
    await dblclick(byText(first.el, '.tree-link', 'Form'));
    await type(first.el.querySelector<HTMLInputElement>('.url-input')!, 'https://example.com/form-edited');
    await click(byText(first.el, '.tree-link', 'GraphQL'));
    await click(tabEl(first.el, 'Login')!.querySelector('.req-tab-main'));
    await type(nameInput(first.el), 'Login (draft)');
    expect(tabTitles(first.el)).toEqual(['Login (draft)*', 'Form*', '(GraphQL)']);
    // Drafts are written debounced (DRAFT_SAVE_DELAY): poll the database instead of guessing a delay.
    const check = await factory();
    let rows: unknown[] = [];
    for (let waited = 0; waited < 5000; waited += 25) {
      rows = await check.getAll(STORES.drafts);
      if (rows.length === 2) break;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 25));
      });
    }
    check.close();
    expect(rows).toHaveLength(2);
    expect(DRAFT_SAVE_DELAY).toBeLessThan(1000);
    expect(first.errors).toEqual([]);
    await first.done();
    document.body.innerHTML = '';

    const second = await renderAt('/', null, factory);
    await waitFor(() => tabTitles(second.el).length === 3);
    expect(tabTitles(second.el)).toEqual(['Login (draft)*', 'Form*', '(GraphQL)']);
    expect(nameInput(second.el).value).toBe('Login (draft)'); // the active tab, with its edit
    await click(tabEl(second.el, 'Form')!.querySelector('.req-tab-main'));
    expect(second.el.querySelector<HTMLInputElement>('.url-input')!.value).toBe('https://example.com/form-edited');
    expect(second.errors).toEqual([]);
    await second.done();
  });

  /** A small collection without scripts (the sandbox iframe doesn't run in jsdom). */
  const exCollection = normalizeCollection({ info: { _postman_id: 'ex-col', name: 'Ex API', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: [{ id: 'get-thing', name: 'Get thing', request: { method: 'POST', header: [], url: { raw: '{{url}}/thing' }, body: { mode: 'raw', raw: '{"id": {{destinationId}}}', options: { raw: { language: 'json' } } } } }] });
  const exEnv = { id: 'ex-env', name: 'Local', values: [{ key: 'url', value: 'https://api.test', type: 'default', enabled: true }] };
  const exSeed: InitialData = { collections: [exCollection], environments: [exEnv], activeEnvironmentId: 'ex-env' };

  it('"Save as example" stores the response under the request; the sidebar lists it and it opens in a tab', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"thing":1}', { status: 201, statusText: 'Created', headers: { 'content-type': 'application/json' } }));
    const { el, errors, done } = await renderAt('/r/ex-col/get-thing', exSeed);
    await act(async () => {
      el.querySelector('form.urlbar')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await waitFor(() => !!byText(el, 'button', 'Save as example'));
    await click(byText(el, 'button', 'Save as example'));
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Example name"]')!.value).toBe('Get thing');
    expect(tabTitles(el)).toEqual(['(Get thing)', 'Get thing']); // the request's preview tab stays
    expect(el.querySelector('.req-tab.active .req-tab-icon')).toBeTruthy(); // the example tab
    const list = el.querySelector('ul[aria-label="Examples of Get thing"]')!;
    expect(list.textContent).toContain('Get thing');
    expect(list.querySelector('.tree-row.active')).toBeTruthy();
    // The example shows the saved request snapshot and response; rename and save it.
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Example request URL"]')!.value).toBe('{{url}}/thing');
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Status code"]')!.value).toBe('201');
    await waitFor(() => el.querySelector('[aria-label="Saved response"] .cm-content')?.textContent?.includes('{"thing":1}') ?? false);
    await type(el.querySelector<HTMLInputElement>('input[aria-label="Example name"]')!, 'Created example');
    expect(tabTitles(el)).toEqual(['(Get thing)', 'Created example*']);
    await click(byText(el, '.title-row button', 'Save'));
    expect(tabTitles(el)).toEqual(['(Get thing)', 'Created example']);
    expect(list.textContent).toContain('Created example');
    // The request lists it too, and the example can be deleted.
    await click(tabEl(el, 'Get thing')!.querySelector('.req-tab-main'));
    await click(byText(el, '[role=tab]', 'Examples'));
    expect(el.querySelector('.tabpanel')!.textContent).toContain('Created example');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await click(el.querySelector('button[aria-label="Delete example Created example"]'));
    expect(tabTitles(el)).toEqual(['(Get thing)']); // its tab closed
    expect(el.querySelector('ul[aria-label="Examples of Get thing"]')).toBeNull();
    expect(errors).toEqual([]);
    await done();
  });

  it('the JSON body editor is CodeMirror: Tab indents, Prettify keeps {{placeholders}}, invalid JSON is reported but kept', async () => {
    const { el, errors, done } = await renderAt('/r/ex-col/get-thing', exSeed);
    await click(byText(el, '[role=tab]', 'Body'));
    await waitFor(() => !!el.querySelector('.tabpanel .cm-editor'));
    const view = EditorView.findFromDOM(el.querySelector<HTMLElement>('.tabpanel .cm-editor')!)!;
    expect(view.state.doc.toString()).toBe('{"id": {{destinationId}}}');
    await waitFor(() => el.querySelector('.tabpanel .cm-var-missing')?.textContent === '{{destinationId}}');
    await act(async () => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '{"id":{{destinationId}},"tags":["a",{{tag}}]}' } }));
    await click(byText(el, 'button', 'Prettify'));
    expect(view.state.doc.toString()).toBe('{\n  "id": {{destinationId}},\n  "tags": [\n    "a",\n    {{tag}}\n  ]\n}');
    expect(tabTitles(el)).toEqual(['Get thing*']);
    // Tab indents inside the editor instead of moving focus.
    await act(async () => view.dispatch({ selection: { anchor: 2 } }));
    await act(async () => {
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', keyCode: 9, bubbles: true, cancelable: true }));
    });
    expect(view.state.doc.line(2).text).toBe('    "id": {{destinationId}},');
    await act(async () => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '{\n  "a": 1\n  "b": 2\n}' } }));
    await waitText(el, 'Invalid JSON on line 3, column 3');
    expect(el.querySelector<HTMLButtonElement>('form.urlbar button[type=submit]')!.disabled).toBe(false); // never blocks sending
    expect(el.textContent).toContain('Esc then Tab leaves the editor');
    expect(errors).toEqual([]);
    await done();
  });

  it('variable popover: shows the scope and value, writes back to the environment, and adds an unresolved one', async () => {
    const { el, errors, done } = await renderAt('/r/ex-col/get-thing', exSeed);
    const url = el.querySelector<HTMLInputElement>('.url-input')!;
    expect(el.querySelector('.var-field.has-vars .var-tok.var-ok')?.textContent).toBe('{{url}}');
    const caretInto = async (input: HTMLInputElement, pos: number) => {
      await act(async () => {
        input.focus();
        input.setSelectionRange(pos, pos);
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
      });
    };
    await caretInto(url, 3);
    const pop = () => el.ownerDocument.querySelector<HTMLElement>('.var-pop');
    expect(pop()?.textContent).toContain('Environment "Local"');
    const value = pop()!.querySelector<HTMLInputElement>('input[aria-label="Current value of url"]')!;
    expect(value.value).toBe('https://api.test');
    await type(value, 'https://changed.test');
    await act(async () => {
      pop()!.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(pop()?.textContent).toContain('Saved to Environment "Local"');
    await click(byText(el, '[role=tab]', 'Code'));
    expect(el.querySelector('.codeview')!.textContent).toContain('https://changed.test/thing');
    // An unresolved variable: "Add to" the active environment.
    await type(url, '{{url}}/x/{{itemId}}');
    expect(el.querySelector('.var-tok.var-missing')?.textContent).toBe('{{itemId}}');
    await caretInto(url, 13);
    expect(pop()?.textContent).toContain('Unresolved');
    expect(pop()!.querySelector<HTMLSelectElement>('select[aria-label="Add to scope"]')!.value).toBe('env');
    await type(pop()!.querySelector<HTMLInputElement>('input[aria-label="Value for itemId"]')!, '42');
    await click(byText(pop()!, 'button', 'Add'));
    expect(el.querySelector('.var-tok.var-missing')).toBeNull();
    await waitFor(() => el.querySelector('.codeview')?.textContent?.includes('https://changed.test/x/42') ?? false);
    // Escape closes the popover.
    await act(async () => {
      pop()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(pop()).toBeNull();
    expect(errors).toEqual([]);
    await done();
  });

  it('unknown example and closed new-tab routes show a message', async () => {
    for (const [path, text] of [
      [`/e/${cid}/${login.id}/nope`, 'That example doesn’t exist'],
      ['/new/zzz', 'That tab was closed'],
    ] as const) {
      const { el, errors, done } = await renderAt(path);
      expect(el.textContent).toContain(text);
      expect(errors).toEqual([]);
      await done();
    }
  });
});

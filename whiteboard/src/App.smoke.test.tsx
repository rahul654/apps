// @vitest-environment jsdom
/**
 * Smoke test of the boards library and the board route shell. Excalidraw needs a real canvas,
 * so the lazy editor module is replaced with a stub; the real editor is checked in a browser.
 */
import 'fake-indexeddb/auto';
import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import App from './App';
import type { BoardEditorProps } from './components/BoardEditor';
import { ThemeProvider } from './components/Theme';
import { BoardStore } from './lib/boardStore';
import { newId } from './lib/id';
import { serializeScene } from './lib/excalidrawFile';
import { BoardsProvider } from './store/BoardsStore';

vi.mock('./components/BoardEditor', () => ({
  default: (p: BoardEditorProps) => (
    <div data-testid="editor">
      {p.title}|{p.board.scene.elements.length}|{p.theme}
    </div>
  ),
}));

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup) await fn();
  cleanup = [];
  document.body.innerHTML = '';
  localStorage.clear();
});

let location = '';
function LocationProbe() {
  location = useLocation().pathname;
  return null;
}

async function renderAt(path: string, seed?: (s: BoardStore) => Promise<void>) {
  const store = new BoardStore(`smoke-${newId()}`);
  if (seed) await seed(store);
  const errors: unknown[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args));
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(
      <StrictMode>
        <MemoryRouter initialEntries={[path]}>
          <ThemeProvider>
            <BoardsProvider store={store}>
              <App />
              <LocationProbe />
            </BoardsProvider>
          </ThemeProvider>
        </MemoryRouter>
      </StrictMode>,
    );
  });
  cleanup.push(async () => {
    await act(async () => root.unmount());
    spy.mockRestore();
    await store.close();
  });
  return { el, errors, store };
}

/** Polls until `fn` returns truthy, letting IndexedDB callbacks and React updates run. */
async function until<T>(fn: () => T, what = 'condition'): Promise<NonNullable<T>> {
  for (let i = 0; i < 200; i++) {
    const v = fn();
    if (v) return v as NonNullable<T>;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
  throw new Error(`Timed out waiting for ${what}`);
}

const click = async (el: Element) => act(async () => (el as HTMLElement).click());
const byText = (root: ParentNode, selector: string, text: string) => [...root.querySelectorAll(selector)].find((b) => b.textContent?.includes(text)) as HTMLElement | undefined;
const titles = (el: Element) => [...el.querySelectorAll('.board-title')].map((a) => a.textContent);

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('library', () => {
  it('renders the empty state with labelled controls', async () => {
    const { el, errors } = await renderAt('/');
    await until(() => el.textContent?.includes('No boards yet'), 'empty state');
    for (const label of ['New board', 'From template', 'Open file', 'Backup']) expect(byText(el, 'button', label), label).toBeTruthy();
    expect(el.querySelector('[aria-label*="theme"]')).toBeTruthy();
    expect(errors).toEqual([]);
  });

  it('creates a board and opens it in the editor', async () => {
    const { el, errors, store } = await renderAt('/');
    await until(() => byText(el, 'button', 'New board'));
    await click(byText(el, 'button', 'New board')!);
    const editor = await until(() => el.querySelector('[data-testid="editor"]'), 'editor');
    expect(editor.textContent).toBe('Untitled board|0|light');
    expect(location).toMatch(/^\/b\/b_/);
    expect(el.querySelector<HTMLInputElement>('#board-title')!.value).toBe('Untitled board');
    expect(el.querySelector('.save-status')?.textContent).toContain('Saved');
    expect((await store.list()).boards).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it('renames from the board header', async () => {
    let id = '';
    const { el, store } = await renderAt('/', async (s) => {
      id = (await s.create({ title: 'Draft' })).id;
    });
    await until(() => titles(el).length === 1);
    await click(el.querySelector('.board-title')!);
    const input = await until(() => el.querySelector<HTMLInputElement>('#board-title:not(:disabled)'));
    await type(input, '  Launch   plan ');
    await act(async () => input.form!.requestSubmit());
    for (let i = 0; i < 100 && (await store.get(id))?.title !== 'Launch plan'; i++) await act(() => new Promise((r) => setTimeout(r, 5)));
    expect((await store.get(id))?.title).toBe('Launch plan');
    await until(() => el.querySelector('[data-testid="editor"]')?.textContent?.startsWith('Launch plan|'), 'title passed to editor');
    expect(input.value).toBe('Launch plan');
  });

  it('lists, searches and sorts boards', async () => {
    const { el } = await renderAt('/', async (s) => {
      await s.create({ title: 'Roadmap' }, 1000);
      await s.create({ title: 'Team kanban' }, 3000);
      await s.create({ title: 'Café notes' }, 2000);
    });
    await until(() => titles(el).length === 3);
    expect(titles(el)).toEqual(['Team kanban', 'Café notes', 'Roadmap']);
    expect(el.querySelector('.count-pill')?.textContent).toBe('3');
    await type(el.querySelector<HTMLInputElement>('#board-search')!, 'cafe');
    expect(titles(el)).toEqual(['Café notes']);
    await type(el.querySelector<HTMLInputElement>('#board-search')!, 'zzz');
    expect(el.textContent).toContain('No boards match “zzz”');
    await type(el.querySelector<HTMLInputElement>('#board-search')!, '');
    const select = el.querySelector('select')!;
    await act(async () => {
      select.value = 'name';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(titles(el)).toEqual(['Café notes', 'Roadmap', 'Team kanban']);
    expect(JSON.parse(localStorage.getItem('whiteboard:prefs:v1')!)).toEqual({ sort: 'name' });
  });

  it('opens a keyboard-usable actions menu, duplicates, deletes and undoes', async () => {
    const { el, errors } = await renderAt('/', async (s) => {
      await s.create({ title: 'Plan' });
    });
    await until(() => titles(el).length === 1);
    const menuBtn = el.querySelector<HTMLButtonElement>('[aria-label="Actions for Plan"]')!;
    expect(menuBtn.getAttribute('aria-haspopup')).toBe('menu');
    await click(menuBtn);
    expect(menuBtn.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement?.textContent).toBe('Rename');
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    expect(document.activeElement?.textContent).toBe('Duplicate');
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(el.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(menuBtn);

    await click(menuBtn);
    await click(byText(el, '[role="menuitem"]', 'Duplicate')!);
    await until(() => titles(el).length === 2, 'duplicate');
    expect(titles(el).sort()).toEqual(['Plan', 'Plan (copy)']);

    await click(el.querySelector('[aria-label="Actions for Plan (copy)"]')!);
    await click(byText(el, '[role="menuitem"]', 'Delete')!);
    await until(() => titles(el).length === 1, 'delete');
    expect(el.querySelector('.toast')?.textContent).toContain('Deleted Plan (copy)');
    await click(byText(el, '.toast button', 'Undo')!);
    await until(() => titles(el).length === 2, 'undo');
    expect(el.querySelector('.toast')).toBeNull();
    expect(errors).toEqual([]);
  });

  it('renames inline from the card menu', async () => {
    const { el } = await renderAt('/', async (s) => {
      await s.create({ title: 'Old' });
    });
    await until(() => titles(el).length === 1);
    await click(el.querySelector('[aria-label="Actions for Old"]')!);
    await click(byText(el, '[role="menuitem"]', 'Rename')!);
    const input = el.querySelector<HTMLInputElement>('.rename-input')!;
    expect(document.activeElement).toBe(input);
    expect(el.querySelector(`label[for="${input.id}"]`)?.textContent).toBe('Rename board');
    await type(input, 'New name');
    await act(async () => input.form!.requestSubmit());
    await until(() => titles(el)[0] === 'New name', 'renamed card');
  });

  it('creates a board from a template', async () => {
    const { el, errors } = await renderAt('/');
    await until(() => byText(el, 'button', 'From template'));
    await click(byText(el, 'button', 'From template')!);
    const dialog = el.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.textContent).toContain('Flowchart');
    for (const name of ['Blank board', 'Swimlane', 'Mind map', 'Kanban', 'Wireframe']) expect(byText(dialog, 'button', name), name).toBeTruthy();
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    await click(byText(el, 'button', 'From template')!);
    await click(byText(el.querySelector('[role="dialog"]')!, 'button', 'Kanban')!);
    const editor = await until(() => el.querySelector('[data-testid="editor"]'), 'editor');
    expect(editor.textContent).toMatch(/^Kanban\|\d+\|light$/);
    expect(Number(editor.textContent!.split('|')[1])).toBeGreaterThan(10);
    expect(errors).toEqual([]);
  });

  it('imports dropped .excalidraw files', async () => {
    const { el } = await renderAt('/');
    await until(() => el.textContent?.includes('No boards yet'));
    const file = new File([serializeScene({ elements: [{ id: 'a', type: 'rectangle' }], appState: {}, files: [] })], 'Sketch.excalidraw');
    const page = el.querySelector('.library')!;
    const drop = new Event('drop', { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown };
    drop.dataTransfer = { types: ['Files'], files: [file] };
    await act(async () => page.dispatchEvent(drop));
    await until(() => titles(el).length === 1, 'imported board');
    expect(titles(el)).toEqual(['Sketch']);
    expect(el.querySelector('.notice')?.textContent).toContain('Imported 1 board');
  });

  it('shows a message for unknown boards', async () => {
    const { el, errors } = await renderAt('/b/nope');
    await until(() => el.textContent?.includes('That board doesn’t exist'));
    expect(errors).toEqual([]);
  });
});

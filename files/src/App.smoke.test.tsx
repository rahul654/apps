// @vitest-environment jsdom
/**
 * Smoke test: the page renders the list for a visitor, opens items, and shows the upload controls
 * only after login. fetch goes in-process to apps-script/Code.gs on the fake Drive.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error plain JS test helper
import { loadFilesScript } from '../apps-script/runtime.mjs';

vi.mock('./lib/env', () => ({ SCRIPT_URL: 'http://mock/exec', MEDIA_BASE: '' }));

let gs: ReturnType<typeof loadFilesScript>;

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  gs = loadFilesScript({ password: 'pw' });
  const { token } = gs.post({ action: 'login', password: 'pw' });
  gs.post({ token, action: 'addText', text: 'Meeting notes\nBring the charger' });
  const start = gs.post({ token, action: 'start', name: 'beach.jpg', size: 4, type: 'image/jpeg' });
  gs.post({ token, action: 'chunk', uploadId: start.uploadId, offset: 0, data: Buffer.from('jpeg').toString('base64') });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => new Response(JSON.stringify(gs.post(String(init.body))), { status: 200 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

async function render(path = '/') {
  const errors: unknown[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args));
  const { default: App } = await import('./App');
  const lib = await import('./store/library');
  const auth = await import('./store/auth');
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    );
  });
  await act(async () => {
    await lib.refresh();
  });
  const waitFor = async (check: () => boolean) => {
    for (let i = 0; i < 200 && !check(); i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    }
    expect(check()).toBe(true);
  };
  return {
    el,
    errors,
    auth,
    waitFor,
    done: async () => {
      await act(async () => root.unmount());
      spy.mockRestore();
    },
  };
}

const text = () => document.body.textContent ?? '';
const button = (label: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(label) || b.getAttribute('aria-label') === label)!;

describe('Files page', () => {
  it('a visitor sees everything, with no upload or delete controls', async () => {
    const { errors, done } = await render();
    expect(text()).toContain('beach.jpg');
    expect(text()).toContain('Meeting notes');
    expect(text()).toContain('Bring the charger'); // text preview on the card
    expect(button('⬆ Upload')).toBeTruthy();
    expect(document.querySelector('.composer')).toBeNull();
    expect(document.querySelector('.card-check')).toBeNull();
    expect(text()).toContain("35 B / 1 GB");
    expect(errors).toEqual([]);
    await done();
  });

  it('opens a text item with its full text', async () => {
    const { waitFor, errors, done } = await render();
    await act(async () => button('Open Meeting notes.txt').click());
    await waitFor(() => document.querySelector('.text-full')?.textContent === 'Meeting notes\nBring the charger');
    expect(document.querySelector('[role=dialog]')).toBeTruthy();
    expect(button('📋 Copy text')).toBeTruthy();
    expect(text()).not.toContain('🗑 Delete');
    expect(errors).toEqual([]);
    await done();
  });

  it('a deep link opens the item; an unknown one closes with a message', async () => {
    const id = gs.post({ action: 'list' }).items.find((i: { name: string }) => i.name === 'beach.jpg').id;
    const first = await render(`/i/${id}`);
    expect(document.querySelector('.viewer-name')?.textContent).toBe('beach.jpg');
    expect(document.querySelector<HTMLImageElement>('.viewer-body img')?.src).toBe(`https://drive.google.com/thumbnail?id=${id}&sz=w2000`);
    await first.done();
    document.body.innerHTML = '';
    const second = await render('/i/nope');
    await second.waitFor(() => !document.querySelector('[role=dialog]') && text().includes('doesn’t exist any more'));
    await second.done();
  });

  it('after login: composer, checkboxes, sending text and deleting', async () => {
    const { auth, waitFor, errors, done } = await render();
    await act(async () => auth.login('pw'));
    await waitFor(() => Boolean(document.querySelector('.composer')));
    expect(document.querySelectorAll('.card-check')).toHaveLength(2);
    expect(text()).toMatch(/Signed in · 60 min left/);

    // Send a text.
    const area = document.querySelector<HTMLTextAreaElement>('.composer textarea')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(area, 'Wifi password is on the fridge');
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('Send').click());
    await waitFor(() => text().includes('Wifi password is on the fridge.txt'));
    expect(gs.post({ action: 'list' }).items).toHaveLength(3);

    // Select two and delete them.
    const checks = [...document.querySelectorAll<HTMLInputElement>('.card-check input')];
    await act(async () => checks[0].click());
    await act(async () => checks[1].click());
    expect(text()).toContain('2 selected');
    await act(async () => button('🗑 Delete').click());
    expect(text()).toContain('Delete 2 items permanently?');
    await act(async () => [...document.querySelectorAll('.confirm button')].find((b) => b.textContent === 'Delete')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await waitFor(() => gs.post({ action: 'list' }).items.length === 1);
    await waitFor(() => document.querySelectorAll('.card').length === 1);
    expect(errors).toEqual([]);
    await done();
  });

  it('the Upload button asks for the password; a wrong one says so', async () => {
    const { waitFor, done } = await render();
    await act(async () => button('⬆ Upload').click());
    const input = document.querySelector<HTMLInputElement>('input[type=password]')!;
    expect(input).toBeTruthy();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'nope');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('Unlock').click());
    await waitFor(() => text().includes('That password isn’t right.'));
    await done();
  });
});

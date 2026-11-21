// @vitest-environment jsdom
/**
 * Smoke test: every route renders its initial screen without throwing or logging
 * React errors (catches broken lazy imports, bad hooks, render-time DOM access).
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import App from './App';
import { TOOLS } from './tools/registry';

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  class Observer {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('IntersectionObserver', Observer);
  vi.stubGlobal('ResizeObserver', Observer);
  window.scrollTo = () => {};
  // jsdom has no canvas: make toBlob report "unsupported" instead of throwing.
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
    cb(null);
  };
});

afterEach(() => {
  document.body.innerHTML = '';
});

async function renderAt(path: string) {
  const errors: unknown[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args));
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
  // Wait for the lazy chunk to resolve.
  for (let i = 0; i < 100 && el.textContent?.includes('Loading tool'); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
  const text = el.textContent ?? '';
  await act(async () => root.unmount());
  spy.mockRestore();
  return { text, errors };
}

describe('routes render', () => {
  it('home lists every tool', async () => {
    const { text, errors } = await renderAt('/');
    for (const t of TOOLS) expect(text).toContain(t.title);
    expect(text).toContain('Files never leave');
    expect(errors).toEqual([]);
  });

  for (const tool of TOOLS) {
    it(`${tool.path} renders`, async () => {
      const { text, errors } = await renderAt(tool.path);
      expect(text).not.toContain('Something went wrong');
      expect(text).not.toContain('couldn’t be loaded');
      expect(text).toContain(tool.title.split(' ')[0]);
      expect(errors).toEqual([]);
    });
  }
});

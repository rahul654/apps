// @vitest-environment jsdom
/**
 * Smoke test: each route renders without React errors, opening a URL creates a sandboxed frame
 * with the expected attributes, HTML sandboxes never get allow-same-origin, and the
 * `#/open?url=` link creates exactly one sandbox under StrictMode. Real page loading is checked
 * in a browser.
 */
import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import App from './App';
import { createSandbox } from './lib/defaults';
import { SandboxProvider } from './store/SandboxStore';
import type { AppData } from './types';

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

async function renderAt(path: string, initial: AppData = { version: 1, sandboxes: [] }) {
  const errors: unknown[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args));
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(
      <StrictMode>
        <MemoryRouter initialEntries={[path]}>
          <SandboxProvider initial={initial}>
            <App />
          </SandboxProvider>
        </MemoryRouter>
      </StrictMode>,
    );
  });
  return {
    el,
    errors,
    done: async () => {
      await act(async () => root.unmount());
      spy.mockRestore();
    },
  };
}

const click = async (el: Element) => act(async () => (el as HTMLElement).click());
const byText = (root: Element, selector: string, text: string) => [...root.querySelectorAll(selector)].find((b) => b.textContent?.includes(text)) as HTMLElement;

describe('app', () => {
  it('home page renders the opener and the limits', async () => {
    const { el, errors, done } = await renderAt('/');
    const text = el.textContent ?? '';
    for (const label of ['Open a website in a sandbox', 'Open in sandbox', 'Strict', 'Isolated', 'Standard', 'New HTML playground', 'Limits']) {
      expect(text).toContain(label);
    }
    expect(errors).toEqual([]);
    await done();
  });

  it('opening a suggestion creates a sandboxed, credentialless frame', async () => {
    // jsdom lacks credentialless; pretend to be Chromium so the attribute is used.
    Object.defineProperty(HTMLIFrameElement.prototype, 'credentialless', { configurable: true, value: false, writable: true });
    const { el, errors, done } = await renderAt('/');
    await click(byText(el, 'button.chip', 'example.com'));
    const frame = el.querySelector('iframe')!;
    expect(frame).toBeTruthy();
    expect(frame.getAttribute('src')).toBe('https://example.com/');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads');
    expect(frame.getAttribute('allow')).toBe('fullscreen *');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame.hasAttribute('credentialless')).toBe(true);
    delete (HTMLIFrameElement.prototype as unknown as Record<string, unknown>).credentialless;
    expect(el.querySelector('.tab-link.active')?.textContent).toContain('example.com');
    expect(errors).toEqual([]);
    await done();
  });

  it('switching presets in settings rewrites the sandbox attribute', async () => {
    const sb = createSandbox('web', { url: 'https://example.com/' });
    const { el, errors, done } = await renderAt(`/s/${sb.id}`, { version: 1, sandboxes: [sb] });
    await click(el.querySelector('.policy-btn')!);
    await click(byText(el.querySelector('.settings')!, '.segmented button', 'Strict'));
    expect(el.querySelector('iframe')!.getAttribute('sandbox')).toBe('');
    expect(el.querySelector('.attr-preview')?.textContent).toContain('sandbox=""');
    expect(errors).toEqual([]);
    await done();
  });

  it('warns about sites that block framing and offers the embed link', async () => {
    const sb = createSandbox('web', { url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' });
    const { el, errors, done } = await renderAt(`/s/${sb.id}`, { version: 1, sandboxes: [sb] });
    expect(el.textContent).toContain('usually refuses to be shown inside other pages');
    await click(byText(el, 'button', 'Open the embeddable YouTube player'));
    expect(el.querySelector('iframe')!.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ');
    expect(el.textContent).not.toContain('usually refuses');
    expect(errors).toEqual([]);
    await done();
  });

  it('rejects non-web addresses in the address bar', async () => {
    const sb = createSandbox('web');
    const { el, errors, done } = await renderAt(`/s/${sb.id}`, { version: 1, sandboxes: [sb] });
    const input = el.querySelector<HTMLInputElement>('.address-input')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'javascript:alert(1)');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => input.form!.requestSubmit());
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Only http:// and https://');
    expect(el.querySelector('iframe')).toBeNull();
    expect(errors).toEqual([]);
    await done();
  });

  it('HTML playground runs in a frame without allow-same-origin and with the console bridge', async () => {
    const sb = createSandbox('html', { tokens: ['allow-scripts', 'allow-same-origin'] });
    const { el, errors, done } = await renderAt(`/s/${sb.id}`, { version: 1, sandboxes: [sb] });
    const frame = el.querySelector('iframe')!;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('srcdoc')).toContain('Hello from the sandbox');
    expect(frame.getAttribute('srcdoc')).toContain('__sbx');
    expect(el.textContent).toContain('always run with an anonymous origin');
    expect(el.textContent).toContain('Console');
    expect(errors).toEqual([]);
    await done();
  });

  it('#/open?url= creates exactly one sandbox, even under StrictMode', async () => {
    const { el, errors, done } = await renderAt('/open?url=en.wikipedia.org');
    expect(el.querySelectorAll('.tab')).toHaveLength(1);
    expect(el.querySelector('iframe')!.getAttribute('src')).toBe('https://en.wikipedia.org/');
    expect(errors).toEqual([]);
    await done();
  });

  it('closing the open sandbox offers undo and moves to home', async () => {
    const sb = createSandbox('web', { url: 'https://example.com/' });
    const { el, errors, done } = await renderAt(`/s/${sb.id}`, { version: 1, sandboxes: [sb] });
    await click(el.querySelector('.tab-close')!);
    expect(el.querySelectorAll('.tab')).toHaveLength(0);
    expect(el.textContent).toContain('Open a website in a sandbox');
    await click(byText(el, '.toast button', 'Undo'));
    expect(el.querySelectorAll('.tab')).toHaveLength(1);
    expect(el.querySelector('iframe')).toBeTruthy();
    expect(errors).toEqual([]);
    await done();
  });

  it('unknown sandbox ids show a message', async () => {
    const { el, errors, done } = await renderAt('/s/nope');
    expect(el.textContent).toContain('That sandbox doesn’t exist');
    expect(errors).toEqual([]);
    await done();
  });
});

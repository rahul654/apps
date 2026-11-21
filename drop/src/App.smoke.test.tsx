// @vitest-environment jsdom
/**
 * Smoke test: routes render without throwing or logging React errors. WebRTC and the camera
 * aren't in jsdom; the real connection is tested in a browser (see CLAUDE.md, Drop).
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import App from './App';
import { resetSession } from './store/session';

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // No camera in jsdom: getUserMedia is missing, so the scanner shows its "no camera" message.
  HTMLMediaElement.prototype.play = () => Promise.resolve();
});

afterEach(() => {
  act(() => resetSession());
  document.body.innerHTML = '';
});

async function renderAt(path: string, until: (text: string) => boolean) {
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
  for (let i = 0; i < 100 && !until(el.textContent ?? ''); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
  return {
    el,
    errors,
    done: async () => {
      await act(async () => root.unmount());
      spy.mockRestore();
    },
  };
}

describe('routes render', () => {
  it('home offers both ways to pair', async () => {
    const { el, errors, done } = await renderAt('/', (t) => t.includes('Show a code'));
    expect(el.textContent).toContain('Scan a code');
    expect(el.textContent).toContain('How it works');
    expect(errors).toEqual([]);
    await done();
  });

  it('join page falls back to pasting when there is no camera, and rejects junk', async () => {
    const { el, errors, done } = await renderAt('/join', (t) => t.includes('No camera available'));
    expect(el.textContent).toContain('No camera available');
    const input = el.querySelector<HTMLInputElement>('input[aria-label="Pairing link or code"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'not a code');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => el.querySelector('form')!.requestSubmit());
    expect(el.textContent).toContain('This isn’t a Drop code, or only part of one.');
    expect(errors).toEqual([]);
    await done();
  });

  it('a broken pairing link explains what to do', async () => {
    const { el, errors, done } = await renderAt('/j/AAAA', (t) => t.includes('Couldn’t connect'));
    expect(el.textContent).toContain('Couldn’t connect');
    expect(el.textContent).toContain('Start again');
    expect(errors).toEqual([]);
    await done();
  });

  it('the transfer page sends you home when not connected', async () => {
    const { el, errors, done } = await renderAt('/share', (t) => t.includes('Show a code'));
    expect(el.textContent).toContain('Show a code');
    expect(errors).toEqual([]);
    await done();
  });
});

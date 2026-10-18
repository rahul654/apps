// @vitest-environment jsdom
/**
 * Smoke test: every route renders without throwing or logging React errors (catches broken
 * lazy imports, bad hooks, render-time API access), and the start-recording error path works
 * with a denied screen-share prompt. Media APIs are stubbed; real capture is verified in a browser.
 */
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import App from './App';
import { recordingStore } from './lib/recordingStore';
import { screenshotStore } from './lib/screenshotStore';
import { RecorderProvider } from './store/RecorderContext';

const denied = () => Promise.reject(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }));

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  class FakeWorker extends EventTarget {
    onmessage = null;
    onerror = null;
    postMessage() {}
    terminate() {}
  }
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('MediaRecorder', class {
    static isTypeSupported(t: string) {
      return /^(video|audio)\/webm/.test(t);
    }
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: Object.assign(new EventTarget(), {
      getDisplayMedia: denied,
      getUserMedia: denied,
      enumerateDevices: async () => [],
    }),
  });
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'prompt' }) } });
  window.scrollTo = () => {};
  HTMLMediaElement.prototype.play = () => Promise.resolve();
  HTMLMediaElement.prototype.pause = () => {};
  HTMLMediaElement.prototype.load = () => {};
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  URL.createObjectURL = () => 'blob:fake';
  URL.revokeObjectURL = () => {};
  // jsdom has no canvas: a 2D context whose methods do nothing, and a fake bitmap decoder.
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get: (t, k) => (k in t ? t[k] : k === 'measureText' ? () => ({ width: 10 }) : () => {}),
    set: (t, k, v) => ((t[k] = v), true),
  });
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
    cb(new Blob(['x'], { type: 'image/png' }));
  };
  vi.stubGlobal('createImageBitmap', async () => ({ width: 800, height: 450, close() {} }));
});

afterEach(() => {
  document.body.innerHTML = '';
});

async function settle(el: HTMLElement, until: (text: string) => boolean) {
  for (let i = 0; i < 150 && !until(el.textContent ?? ''); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
}

async function renderAt(path: string, until: (text: string) => boolean = (t) => !t.includes('Loading')) {
  const errors: unknown[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args));
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <RecorderProvider>
          <App />
        </RecorderProvider>
      </MemoryRouter>,
    );
  });
  await settle(el, until);
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
  it('record page shows modes, settings and the chosen format', async () => {
    const { el, errors, done } = await renderAt('/');
    const text = el.textContent ?? '';
    for (const label of ['Screen + camera', 'Screen only', 'Camera only', 'Audio only', 'Start recording', 'Camera bubble', 'Output', 'WebM (VP9 + Opus)']) {
      expect(text).toContain(label);
    }
    expect(text).toContain('Alt+Shift+R');
    expect(text).toContain('Screenshot');
    expect(text).toContain('Alt+Shift+S');
    expect(errors).toEqual([]);
    await done();
  });

  it('a denied screen-share prompt for a screenshot shows the same friendly copy', async () => {
    const { el, errors, done } = await renderAt('/');
    const btn = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Screenshot')!;
    await act(async () => btn.click());
    await settle(el, (t) => t.includes('Screen sharing was cancelled'));
    expect(el.textContent).toContain('Screen sharing was cancelled');
    expect(errors).toEqual([]);
    await done();
  });

  it('a denied screen-share prompt shows friendly copy with a retry', async () => {
    const { el, errors, done } = await renderAt('/');
    const start = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Start recording'))!;
    await act(async () => start.click());
    await settle(el, (t) => t.includes('Screen sharing was cancelled'));
    expect(el.textContent).toContain('Screen sharing was cancelled');
    expect([...el.querySelectorAll('button')].some((b) => b.textContent === 'Try again')).toBe(true);
    expect(errors).toEqual([]);
    await done();
  });

  it('library lists stored recordings', async () => {
    await recordingStore().saveFile(
      { id: 'smoke-1', title: 'Smoke test clip', createdAt: Date.now(), durationMs: 65_000, mimeType: 'video/webm;codecs=vp9,opus', mode: 'screen' },
      new Blob(['not really a video'], { type: 'video/webm' }),
    );
    const { el, errors, done } = await renderAt('/library', (t) => t.includes('Smoke test clip'));
    const text = el.textContent ?? '';
    expect(text).toContain('Smoke test clip');
    expect(text).toContain('1:05');
    expect(text).toContain('WebM (VP9 + Opus)');
    expect(errors).toEqual([]);
    await done();
  });

  it('player page renders and falls back when the editor can’t read the file', async () => {
    const { el, errors, done } = await renderAt('/play/smoke-1', (t) => t.includes('Real-time re-record'));
    const text = el.textContent ?? '';
    expect(text).toContain('Smoke test clip');
    expect(text).toContain('Trim');
    expect(text).toContain('Real-time re-record');
    expect(errors).toEqual([]);
    await done();
  });

  it('library lists screenshots next to recordings and filters by kind', async () => {
    await screenshotStore().create(
      { id: 'shot-1', title: 'Smoke screenshot', createdAt: Date.now(), width: 800, height: 450, source: 'display' },
      new Blob(['png'], { type: 'image/png' }),
    );
    const { el, errors, done } = await renderAt('/library', (t) => t.includes('Smoke screenshot') && t.includes('Smoke test clip'));
    expect(el.textContent).toContain('800×450');
    const only = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Screenshots')!;
    await act(async () => only.click());
    expect(el.textContent).toContain('Smoke screenshot');
    expect(el.textContent).not.toContain('Smoke test clip');
    expect(errors).toEqual([]);
    await done();
  });

  it('screenshot editor renders the tools and adds a highlight', async () => {
    const { el, errors, done } = await renderAt('/shot/shot-1', (t) => t.includes('Spotlight'));
    const text = el.textContent ?? '';
    for (const label of ['Smoke screenshot', 'Highlight', 'Spotlight', 'Box', 'Arrow', 'Pen', 'Text', 'Blur', 'Crop', 'Download']) expect(text).toContain(label);
    const canvas = el.querySelector('canvas')!;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 450, right: 800, bottom: 450, x: 0, y: 0, toJSON() {} });
    canvas.setPointerCapture = () => {};
    const pe = (type: string, x: number, y: number) => {
      const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
      Object.defineProperty(e, 'pointerId', { value: 1 });
      return e;
    };
    await act(async () => {
      canvas.dispatchEvent(pe('pointerdown', 100, 100));
      canvas.dispatchEvent(pe('pointermove', 300, 160));
      canvas.dispatchEvent(pe('pointerup', 300, 160));
    });
    await settle(el, () => !!canvas.getAttribute('aria-label')?.includes('1 mark'));
    expect(canvas.getAttribute('aria-label')).toContain('1 mark');
    // Autosave writes the scene to IndexedDB.
    for (let i = 0; i < 50 && (await screenshotStore().get('shot-1'))!.scene.annotations.length === 0; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
    }
    expect((await screenshotStore().get('shot-1'))!.scene.annotations[0]).toMatchObject({ type: 'highlight', x: 100, y: 100, w: 200, h: 60 });
    expect(errors).toEqual([]);
    await done();
  });

  it('unknown ids show a not-found message', async () => {
    const { el, errors, done } = await renderAt('/play/nope', (t) => t.includes('doesn’t exist'));
    expect(el.textContent).toContain('doesn’t exist');
    expect(errors).toEqual([]);
    await done();
  });
});

// @vitest-environment jsdom
/**
 * Smoke test: each route renders without React errors, adding an image asks before downloading a
 * model, and an approved run reaches "Done". Real inference, drawing and export are checked in a
 * browser (jsdom has no canvas, workers or WebAssembly model runtime).
 */
import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import App from './App';
import { Engine, type RunResult } from './lib/engine';
import type { ModelId } from './lib/models';
import { AppProvider } from './store/AppStore';

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let n = 0;
  URL.createObjectURL = () => `blob:test/${++n}`;
  URL.revokeObjectURL = () => {};
  // jsdom has no canvas encoder (the WebP support probe calls it) and no ResizeObserver.
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
    cb(null);
  };
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

/** Engine that never starts a worker; runs resolve with a fake half-opaque mask. */
class FakeEngine extends Engine {
  runs: { model: ModelId; name: string }[] = [];
  constructor() {
    super(Promise.resolve({ webgpu: 'none', shaderF16: false }));
  }
  override async run(model: ModelId, file: Blob): Promise<RunResult> {
    this.runs.push({ model, name: (file as File).name });
    const mask = new Uint8Array(4 * 3);
    mask.fill(255, 0, 6);
    return { mask, thumb: null, width: 4, height: 3, ms: 12, backend: 'wasm' };
  }
}

async function renderAt(path: string, engine: Engine = new FakeEngine()) {
  const errors: unknown[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args));
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(
      <StrictMode>
        <MemoryRouter initialEntries={[path]}>
          <AppProvider engine={engine}>
            <App />
          </AppProvider>
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
const byText = (root: Element, selector: string, text: string) => [...root.querySelectorAll(selector)].find((b) => b.textContent?.includes(text)) as HTMLElement | undefined;

async function addFiles(el: Element, files: File[]) {
  const input = el.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}

describe('app', () => {
  it('home shows the drop zone, the three models with sizes and licences, and the privacy note', async () => {
    const { el, errors, done } = await renderAt('/');
    const text = el.textContent ?? '';
    for (const label of ['Remove image backgrounds in your browser', 'Drop images here or click to choose', 'Fast', 'People', 'Best quality', '4.4 MB download', 'Apache-2.0', 'MIT', 'Needs WebGPU', 'images are never uploaded']) {
      expect(text).toContain(label);
    }
    // Without WebGPU the quality model can't be picked.
    const radios = [...el.querySelectorAll<HTMLInputElement>('input[name="model"]')];
    expect(radios.map((r) => [r.value, r.disabled])).toEqual([
      ['fast', false],
      ['portrait', false],
      ['quality', true],
    ]);
    expect(el.querySelector('.dropzone')?.getAttribute('role')).toBe('button');
    expect(errors).toEqual([]);
    await done();
  });

  it('about page lists models, licences and the delete button', async () => {
    const { el, errors, done } = await renderAt('/about');
    const text = el.textContent ?? '';
    for (const label of ['Privacy and limits', 'Everything runs on your device', 'U²-Net-p', 'MODNet', 'BiRefNet lite', 'Delete downloaded models', 'Keyboard shortcuts']) {
      expect(text).toContain(label);
    }
    expect(el.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(errors).toEqual([]);
    await done();
  });

  it('unknown routes go home', async () => {
    const { el, errors, done } = await renderAt('/nope');
    expect(el.textContent).toContain('Remove image backgrounds');
    expect(errors).toEqual([]);
    await done();
  });

  it('asks before downloading, then processes the queue to Done', async () => {
    const engine = new FakeEngine();
    const { el, errors, done } = await renderAt('/', engine);
    await addFiles(el, [new File(['x'], 'cat.jpg', { type: 'image/jpeg' }), new File(['y'], 'notes.txt', { type: 'text/plain' }), new File(['z'], 'dog.png', { type: 'image/png' })]);
    expect(el.textContent).toContain('cat.jpg');
    expect(el.textContent).toContain('dog.png');
    expect(el.textContent).toContain('Skipped 1 file');
    expect(el.textContent).toContain('Waiting for model download');
    expect(engine.runs).toHaveLength(0);

    const consent = byText(el, 'button', 'and start')!;
    expect(consent.textContent).toContain('4.4 MB');
    await click(consent);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(engine.runs.map((r) => r.name)).toEqual(['cat.jpg', 'dog.png']);
    expect(el.querySelectorAll('.queue-item')).toHaveLength(2);
    expect(el.textContent).toContain('2/2 done');
    // Workspace panels
    for (const label of ['Refine edges', 'Background', 'Export', 'Compare', 'Erase', 'Restore', 'Download PNG', 'Download all (2) as .zip']) {
      expect(el.textContent).toContain(label);
    }
    expect(errors).toEqual([]);
    await done();
  });

  it('changing the model re-targets waiting items; remove and clear work', async () => {
    const { el, errors, done } = await renderAt('/');
    await addFiles(el, [new File(['x'], 'a.jpg', { type: 'image/jpeg' }), new File(['x'], 'b.jpg', { type: 'image/jpeg' })]);
    await click(el.querySelector('input[name="model"][value="portrait"]')!);
    expect(byText(el, 'button', 'and start')?.textContent).toContain('24.7 MB');
    await click(el.querySelector('button[aria-label="Remove a.jpg"]')!);
    expect(el.querySelectorAll('.queue-item')).toHaveLength(1);
    await click(byText(el, 'button', 'Clear all')!);
    expect(el.textContent).toContain('Remove image backgrounds in your browser');
    expect(errors).toEqual([]);
    await done();
  });
});

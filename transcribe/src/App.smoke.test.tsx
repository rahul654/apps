// @vitest-environment jsdom
/**
 * Smoke test: every route renders without React errors, and the main flows work against a fake
 * Whisper worker: decoded input → settings → transcribe (streamed progress) → saved → editor
 * (search, edit, export) → library (rename, delete). Real decoding and inference are checked
 * in a browser.
 */
import 'fake-indexeddb/auto';
import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import App from './App';
import { transcriptStore } from './lib/storage';
import { jobStore } from './store/job';
import type { Transcript } from './types';
import type { FromWorker, ToWorker } from './workers/protocol';

const posted: ToWorker[] = [];
/** When false, the fake worker never finishes (to test cancelling). */
let autoFinish = true;
const downloads: { name: string; text: Promise<string> }[] = [];

class FakeWorker {
  onmessage: ((e: { data: FromWorker }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  terminated = false;
  postMessage(msg: ToWorker) {
    posted.push(msg);
    if (msg.type !== 'transcribe') return;
    const send = (data: FromWorker) => !this.terminated && this.onmessage?.({ data });
    const seg = (i: number, text: string) => ({ id: `s${i}`, start: i * 2, end: i * 2 + 2, text });
    setTimeout(() => {
      send({ type: 'backend', backend: 'wasm' });
      send({ type: 'download', files: [{ file: 'onnx/encoder_model_quantized.onnx', loaded: 5, total: 10, cached: false }] });
      send({ type: 'status', phase: 'transcribing', message: 'Transcribing…' });
      send({ type: 'language', code: 'en', probability: 0.97 });
      send({ type: 'progress', done: 1, total: 2, segments: [seg(0, 'Hello café world.')] });
      send({ type: 'partial', window: 1, text: 'Second par' });
    }, 0);
    setTimeout(() => {
      if (!autoFinish) return;
      send({ type: 'done', segments: [seg(0, 'Hello café world.'), seg(1, 'Second part here.')], language: 'en', languageDetected: true, backend: 'wasm', elapsedMs: 1234 });
    }, 150);
  }
  terminate() {
    this.terminated = true;
  }
}

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('Worker', FakeWorker);
  HTMLMediaElement.prototype.play = () => Promise.resolve();
  HTMLMediaElement.prototype.pause = () => {};
  HTMLMediaElement.prototype.load = () => {};
  Element.prototype.scrollIntoView = () => {};
  URL.createObjectURL = (b: Blob | MediaSource) => {
    const blob = b as Blob;
    // jsdom's Blob has no .text()
    const text = new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.readAsText(blob);
    });
    downloads.push({ name: '', text });
    return 'blob:fake';
  };
  URL.revokeObjectURL = () => {};
  HTMLAnchorElement.prototype.click = function () {
    downloads[downloads.length - 1].name = this.download;
  };
});

afterEach(() => {
  document.body.innerHTML = '';
  jobStore.reset();
});

async function renderAt(path: string) {
  const errors: unknown[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args));
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(
      <StrictMode>
        <MemoryRouter initialEntries={[path]}>
          <App />
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

async function settle(el: HTMLElement, until: (text: string) => boolean) {
  for (let i = 0; i < 100 && !until(el.textContent ?? ''); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

const click = async (el: Element | null | undefined) => {
  expect(el).toBeTruthy();
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

const sample = (over: Partial<Transcript> = {}): Transcript => ({
  version: 1,
  id: 'smoke1',
  title: 'Smoke talk',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  duration: 65,
  source: 'file',
  model: 'Xenova/whisper-tiny',
  backend: 'wasm',
  task: 'transcribe',
  language: 'en',
  timestamps: 'segment',
  hasAudio: true,
  segmentCount: 3,
  wordCount: 9,
  segments: [
    { id: 'a', start: 0, end: 4, text: 'The quick brown fox' },
    { id: 'b', start: 4, end: 62.345, text: 'jumps over' },
    { id: 'c', start: 62.345, end: 65, text: 'the lazy dog.' },
  ],
  ...over,
});

describe('routes', () => {
  it('home shows the inputs, privacy line and how-it-works', async () => {
    const { el, errors, done } = await renderAt('/');
    const text = el.textContent ?? '';
    for (const s of ['Speech to text', 'Upload', 'Record', 'Live dictation', 'Choose audio or video file', 'Your audio isn’t uploaded', 'How it works']) expect(text).toContain(s);
    expect(el.querySelectorAll('[role="tab"]')).toHaveLength(3);
    expect(errors).toEqual([]);
    await done();
  });

  it('live dictation explains it is unavailable (no Web Speech API in jsdom)', async () => {
    const { el, errors, done } = await renderAt('/');
    await click(byText(el, '[role="tab"]', 'Live dictation'));
    expect(el.textContent).toContain('Live dictation isn’t available in this browser');
    expect(el.textContent).toContain('Firefox');
    expect(errors).toEqual([]);
    await done();
  });

  it('live dictation warns that audio leaves the device when the API exists', async () => {
    vi.stubGlobal('webkitSpeechRecognition', class {});
    const { el, errors, done } = await renderAt('/');
    await click(byText(el, '[role="tab"]', 'Live dictation'));
    expect(el.textContent).toContain('Not on-device');
    expect(byText(el, 'button', 'Start dictation')).toBeTruthy();
    expect(errors).toEqual([]);
    await done();
    vi.unstubAllGlobals();
    vi.stubGlobal('Worker', FakeWorker);
  });

  it('about lists the models with sizes and the privacy notes', async () => {
    const { el, errors, done } = await renderAt('/about');
    const text = el.textContent ?? '';
    for (const s of ['Privacy and limits', 'On-device', 'Tiny', 'Base', 'Small', '43.6 MB', '79.7 MB', '252 MB', 'Apache-2.0']) expect(text).toContain(s);
    expect(errors).toEqual([]);
    await done();
  });

  it('library is empty, then lists a saved transcript', async () => {
    const { el, errors, done } = await renderAt('/library');
    await settle(el, (t) => t.includes('No transcripts yet'));
    expect(el.textContent).toContain('No transcripts yet');
    await act(async () => transcriptStore.put(sample({ id: 'lib1', title: 'Listed' })));
    await settle(el, (t) => t.includes('Listed'));
    expect(el.querySelector('.lib-title')?.textContent).toBe('Listed');
    // Rename
    await click(el.querySelector('[aria-label="Rename Listed"]'));
    const input = el.querySelector<HTMLInputElement>('input[id^="rename-"]')!;
    await type(input, 'Renamed one');
    await act(async () => input.form!.requestSubmit());
    await settle(el, (t) => t.includes('Renamed one'));
    expect(el.querySelector('.lib-title')?.textContent).toBe('Renamed one');
    // Delete with confirmation
    await click(el.querySelector('[aria-label="Delete Renamed one"]'));
    await click(byText(el, 'button.danger', 'Delete'));
    await settle(el, (t) => t.includes('No transcripts yet'));
    expect(await transcriptStore.get('lib1')).toBeNull();
    expect(errors).toEqual([]);
    await done();
  });

  it('unknown transcript ids show a message', async () => {
    const { el, errors, done } = await renderAt('/t/nope');
    await settle(el, (t) => t.includes('doesn’t exist'));
    expect(el.textContent).toContain('That transcript doesn’t exist');
    expect(errors).toEqual([]);
    await done();
  });
});

describe('transcript editor', () => {
  it('shows segments, searches, edits, saves and exports', async () => {
    await transcriptStore.put(sample(), new Blob(['RIFF'], { type: 'audio/wav' }));
    // jsdom's Blob doesn't survive fake-indexeddb's structured clone; real browsers store it fine.
    const audioSpy = vi.spyOn(transcriptStore, 'getAudio').mockResolvedValue(new Blob(['RIFF'], { type: 'audio/wav' }));
    const { el, errors, done } = await renderAt('/t/smoke1');
    await settle(el, () => !!el.querySelector('audio'));
    expect(el.querySelectorAll('.seg')).toHaveLength(3);
    expect(el.querySelector('audio')).toBeTruthy();
    expect(el.querySelector('.ts-btn')?.getAttribute('aria-label')).toBe('Play from 0 seconds');

    // Search filters and highlights
    await type(el.querySelector<HTMLInputElement>('input[type="search"]')!, 'LAZY');
    expect(el.querySelectorAll('.seg')).toHaveLength(1);
    expect(el.querySelector('.seg mark')?.textContent).toBe('lazy');
    expect(el.textContent).toContain('1 of 3 segments match');
    await click(el.querySelector('[aria-label="Clear search"]'));
    expect(el.querySelectorAll('.seg')).toHaveLength(3);

    // Edit a segment; it's saved after a pause
    await type(el.querySelectorAll<HTMLTextAreaElement>('.seg-text')[1], 'leaps over');
    await settle(el, (t) => t.includes('· Saved'));
    await act(async () => new Promise((r) => setTimeout(r, 700)));
    expect((await transcriptStore.get('smoke1'))?.segments[1].text).toBe('leaps over');

    // Exports
    downloads.length = 0;
    await click(el.querySelector('[aria-label="Download SRT"]'));
    await click(el.querySelector('[aria-label="Download VTT"]'));
    await click(el.querySelector('[aria-label="Download TXT"]'));
    const [srt, vtt, txt] = downloads;
    expect(srt.name).toBe('Smoke-talk.srt');
    expect(await srt.text).toContain('2\n00:00:04,000 --> 00:01:02,345\nleaps over\n');
    expect(vtt.name).toBe('Smoke-talk.vtt');
    expect(await vtt.text).toMatch(/^WEBVTT\n\n00:00:00\.000 --> 00:00:04\.000\nThe quick brown fox\n/);
    expect(await txt.text).toBe('The quick brown fox\nleaps over\nthe lazy dog.\n');
    expect(errors).toEqual([]);
    await done();
    audioSpy.mockRestore();
  });
});

describe('transcription flow (fake worker)', () => {
  it('runs, streams progress, saves and opens the transcript', async () => {
    const { el, errors, done } = await renderAt('/');
    await act(async () => {
      jobStore.setDecoded({ source: 'file', title: 'clip', fileName: 'clip.mp3', blob: new Blob(['x'], { type: 'audio/mpeg' }), samples: new Float32Array(16000 * 40).fill(0.1), duration: 40 });
    });
    expect(el.textContent).toContain('clip.mp3');
    expect(el.textContent).toContain('Spoken language');
    expect(el.querySelectorAll('.model-card')).toHaveLength(3);
    // Choose "Words" timestamps and English
    await click(byText(el, '.seg-opt', 'Words')!.querySelector('input'));
    const lang = el.querySelector<HTMLSelectElement>('select.input')!;
    await act(async () => {
      lang.value = 'en';
      lang.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await click(byText(el, 'button', 'Transcribe'));
    await settle(el, (t) => t.includes('Hello café world.'));
    expect(el.textContent).toContain('Transcript so far');
    expect(el.querySelector('.badge')?.textContent).toContain('WASM');
    const msg = posted.find((m) => m.type === 'transcribe')!;
    expect(msg).toMatchObject({ type: 'transcribe', language: 'en', timestamps: 'word', task: 'transcribe', model: 'Xenova/whisper-tiny' });
    expect((msg as { ortBase: string }).ortBase).toMatch(/\/ort\/[^/]+\/$/);
    // Finishes, saves and navigates to the editor
    await settle(el, () => !!el.querySelector('.title-input'));
    expect(el.querySelector<HTMLInputElement>('.title-input')?.value).toBe('clip');
    expect(el.querySelectorAll('.seg')).toHaveLength(2);
    const saved = (await transcriptStore.list()).find((m) => m.title === 'clip')!;
    expect(saved).toMatchObject({ language: 'en', timestamps: 'word', hasAudio: true, audioType: 'audio/mpeg', segmentCount: 2 });
    expect(errors).toEqual([]);
    await done();
  });

  it('cancel keeps the partial result and offers to save it', async () => {
    autoFinish = false;
    const { el, errors, done } = await renderAt('/');
    await act(async () => {
      jobStore.setDecoded({ source: 'mic', title: 'rec', blob: new Blob(['x'], { type: 'audio/webm' }), samples: new Float32Array(16000 * 40), duration: 40 });
    });
    await click(byText(el, 'button', 'Transcribe'));
    await settle(el, (t) => t.includes('Hello café world.'));
    await click(byText(el, 'button', 'Cancel'));
    expect(el.textContent).toContain('Cancelled');
    expect(el.textContent).toContain('1 segment was transcribed');
    await click(byText(el, 'button', 'Save what’s done'));
    await settle(el, () => !!el.querySelector('.title-input'));
    expect(el.textContent).toContain('Partial transcript');
    const saved = (await transcriptStore.list()).find((m) => m.title === 'rec')!;
    expect(saved).toMatchObject({ partial: true, hasAudio: true, audioType: 'audio/wav', source: 'mic' });
    expect(errors).toEqual([]);
    await done();
    autoFinish = true;
  });
});

import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { luminance, normalizeHex, parseColor, toHex } from './color';
import { baseName, formatBytes, formatMs, outputName } from './format';
import { History } from './history';
import { getModel, MODELS, modelUrl, planRun } from './models';
import { DEFAULT_PREFS, normalizePrefs } from './prefs';
import { makeZip } from './zip';

describe('colour parsing', () => {
  it('accepts hex and rgb() forms', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseColor('1a2B3c')).toEqual({ r: 0x1a, g: 0x2b, b: 0x3c });
    expect(parseColor('#1a2b3c80')).toEqual({ r: 0x1a, g: 0x2b, b: 0x3c });
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30 });
    expect(parseColor('rgb(10 20 30 / 50%)')).toEqual({ r: 10, g: 20, b: 30 });
    expect(parseColor('rgba(300,-5,100%,0.5)')).toEqual({ r: 255, g: 0, b: 255 });
    expect(parseColor(' RGB(0%, 50%, 100%) ')).toEqual({ r: 0, g: 128, b: 255 });
  });

  it('rejects anything else', () => {
    for (const bad of ['', '#ff', '#ggg', 'red', 'rgb(1,2)', 'rgb(a,b,c)', '#12345']) expect(parseColor(bad)).toBeNull();
  });

  it('round-trips to #rrggbb', () => {
    expect(toHex({ r: 1, g: 171, b: 255 })).toBe('#01abff');
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('nope', '#000000')).toBe('#000000');
  });

  it('computes luminance', () => {
    expect(luminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1);
    expect(luminance({ r: 0, g: 0, b: 0 })).toBe(0);
  });
});

describe('file names and sizes', () => {
  it('derives output names and de-duplicates them', () => {
    const taken = new Set<string>();
    expect(outputName('photo.JPG', 'png', taken)).toBe('photo-nobg.png');
    expect(outputName('photo.jpeg', 'png', taken)).toBe('photo-nobg (2).png');
    expect(outputName('Photo.png', 'png', taken)).toBe('Photo-nobg (3).png');
    expect(outputName('a/b:c?.webp', 'jpeg')).toBe('a_b_c_-nobg.jpg');
    expect(baseName('.png')).toBe('image');
  });

  it('formats bytes and durations', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(4_574_861)).toBe('4.4 MB');
    expect(formatBytes(224_005_088)).toBe('214 MB');
    expect(formatMs(350)).toBe('350 ms');
    expect(formatMs(1500)).toBe('1.5 s');
  });
});

describe('History', () => {
  it('undoes and redoes in order, and a new push clears redo', () => {
    const h = new History<number>();
    h.push(1);
    h.push(2);
    expect(h.undo()).toBe(2);
    expect(h.canRedo).toBe(true);
    expect(h.redo()).toBe(2);
    h.undo();
    h.push(3);
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBe(3);
    expect(h.undo()).toBe(1);
    expect(h.undo()).toBeUndefined();
  });

  it('drops the oldest entries past the count or byte budget', () => {
    const h = new History<number>(3);
    for (let i = 1; i <= 5; i++) h.push(i);
    expect(h.size.undo).toBe(3);
    const b = new History<number>(100, 10, (n) => n);
    b.push(6);
    b.push(6);
    expect(b.size).toEqual({ undo: 1, redo: 0, bytes: 6 });
  });
});

describe('models', () => {
  it('pins every file to a commit and a SHA-256', () => {
    for (const m of MODELS) {
      expect(m.revision).toMatch(/^[0-9a-f]{40}$/);
      for (const f of Object.values(m.files)) {
        expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(f.bytes).toBeGreaterThan(1_000_000);
        expect(modelUrl(m, f)).toMatch(new RegExp(`^https://huggingface\\.co/${m.repo}/resolve/${m.revision}/onnx/`));
      }
      expect(['MIT', 'Apache-2.0']).toContain(m.licence);
    }
  });

  it('plans backends: WASM without WebGPU, WebGPU-only models refused', () => {
    const none = { webgpu: 'none', shaderF16: false } as const;
    expect(planRun(getModel('fast'), none)).toMatchObject({ backend: 'wasm', precision: 'fp32' });
    expect(planRun(getModel('quality'), none)).toBeNull();
  });

  it('uses fp16 on GPUs with shader-f16 and keeps small models on WASM with a software adapter', () => {
    const hw = { webgpu: 'hardware', shaderF16: true } as const;
    const sw = { webgpu: 'software', shaderF16: false } as const;
    expect(planRun(getModel('quality'), hw)).toMatchObject({ backend: 'webgpu', precision: 'fp16' });
    expect(planRun(getModel('quality'), sw)).toMatchObject({ backend: 'webgpu', precision: 'fp32' });
    expect(planRun(getModel('portrait'), hw)).toMatchObject({ backend: 'webgpu', precision: 'fp32' });
    expect(planRun(getModel('portrait'), sw)).toMatchObject({ backend: 'wasm' });
  });
});

describe('prefs', () => {
  it('fills defaults and clamps bad values', () => {
    expect(normalizePrefs(null)).toEqual(DEFAULT_PREFS);
    const p = normalizePrefs({ model: 'quality', background: 'image', color: '#ABC', quality: 5, padding: -3, format: 'gif', brushSize: 'x' });
    expect(p.model).toBe('quality');
    expect(p.background).toBe('transparent'); // custom images aren't persisted
    expect(p.color).toBe('#aabbcc');
    expect(p.quality).toBe(1);
    expect(p.padding).toBe(0);
    expect(p.format).toBe('png');
    expect(p.brushSize).toBe(DEFAULT_PREFS.brushSize);
    expect(normalizePrefs({ model: 'nope' }).model).toBe(DEFAULT_PREFS.model);
  });
});

describe('zip', () => {
  it('stores files that unzip to the same bytes', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array(1000).fill(7);
    const zip = makeZip([
      { name: 'a-nobg.png', data: a },
      { name: 'b-nobg.png', data: b },
    ]);
    const out = unzipSync(zip);
    expect(Object.keys(out)).toEqual(['a-nobg.png', 'b-nobg.png']);
    expect(out['a-nobg.png']).toEqual(a);
    expect(out['b-nobg.png']).toEqual(b);
  });
});

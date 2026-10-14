import { describe, expect, it } from 'vitest';
import { micErrorInfo, dictationErrorInfo, decodeErrorInfo } from './errors';
import { DEFAULT_PREFS, parsePrefs } from './prefs';
import { dtypeFor, fileUrl, modelFiles, MODELS, parseFileUrl } from './models';

describe('prefs', () => {
  it('validates field by field', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs({ model: 'evil/model', language: '<script>', task: 'translate', timestamps: 'word', backend: 'cuda', keepAudio: false })).toEqual({
      ...DEFAULT_PREFS,
      task: 'translate',
      timestamps: 'word',
      keepAudio: false,
    });
    expect(parsePrefs({ model: 'Xenova/whisper-base', language: 'hi', backend: 'wasm' })).toMatchObject({ model: 'Xenova/whisper-base', language: 'hi', backend: 'wasm' });
  });
});

describe('models', () => {
  it('file lists match the dtype per backend', () => {
    expect(dtypeFor('wasm')).toEqual({ encoder_model: 'q8', decoder_model_merged: 'q8' });
    expect(modelFiles('wasm')).toContain('onnx/encoder_model_quantized.onnx');
    expect(modelFiles('wasm')).toContain('onnx/decoder_model_merged_quantized.onnx');
    expect(modelFiles('webgpu')).toContain('onnx/encoder_model.onnx');
    expect(modelFiles('webgpu')).toContain('onnx/decoder_model_merged_q4.onnx');
  });
  it('cache URLs round-trip', () => {
    const u = fileUrl('Xenova/whisper-tiny', 'onnx/encoder_model_quantized.onnx');
    expect(u).toBe('https://huggingface.co/Xenova/whisper-tiny/resolve/main/onnx/encoder_model_quantized.onnx');
    expect(parseFileUrl(u)).toEqual({ modelId: 'Xenova/whisper-tiny', path: 'onnx/encoder_model_quantized.onnx' });
    expect(parseFileUrl('https://example.com/x')).toBeNull();
  });
  it('sizes grow with model size', () => {
    expect(MODELS.map((m) => m.mb.wasm)).toEqual([...MODELS.map((m) => m.mb.wasm)].sort((a, b) => a - b));
  });
});

describe('error copy', () => {
  const e = (name: string) => Object.assign(new Error('x'), { name });
  it('mic', () => {
    expect(micErrorInfo(e('NotAllowedError'))).toMatchObject({ title: 'Microphone access was blocked', canRetry: true });
    expect(micErrorInfo(e('NotFoundError')).title).toBe('No microphone found');
    expect(micErrorInfo(e('NotReadableError')).title).toMatch(/in use/);
    expect(micErrorInfo(e('SecurityError')).canRetry).toBe(false);
  });
  it('decode and dictation', () => {
    expect(decodeErrorInfo(e('EncodingError'), 'a.xyz').message).toContain('“a.xyz”');
    expect(dictationErrorInfo('network').title).toBe('Dictation needs the internet');
    expect(dictationErrorInfo('not-allowed').title).toBe('Dictation was blocked');
  });
});

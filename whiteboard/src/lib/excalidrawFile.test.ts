import { describe, expect, it } from 'vitest';
import { ImportError, parseLibrary, parseScene, serializeScene } from './excalidrawFile';

const file = { id: 'f1', mimeType: 'image/png', dataURL: 'data:image/png;base64,AAAA', created: 1 };

describe('.excalidraw files', () => {
  it('round-trips a scene through the Excalidraw v2 format', () => {
    const elements = [{ id: 'a', type: 'image', fileId: 'f1' }, { id: 'b', type: 'rectangle' }];
    const json = serializeScene({ elements, appState: { viewBackgroundColor: '#fafafa', zoom: { value: 2 } }, files: [file] });
    const raw = JSON.parse(json);
    expect(raw).toMatchObject({ type: 'excalidraw', version: 2, files: { f1: file }, appState: { viewBackgroundColor: '#fafafa', gridSize: 20 } });
    expect(raw.appState.zoom).toBeUndefined();
    const back = parseScene(raw);
    expect(back.elements).toEqual(elements);
    expect(back.files).toEqual([file]);
    expect(back.appState.viewBackgroundColor).toBe('#fafafa');
  });

  it('reads the drawing name and rejects other JSON', () => {
    expect(parseScene({ type: 'excalidraw', elements: [], appState: { name: 'Plan' } }).name).toBe('Plan');
    expect(() => parseScene({ type: 'excalidrawlib', elements: [] })).toThrow(ImportError);
    expect(() => parseScene({ type: 'excalidraw' })).toThrow(ImportError);
  });

  it('parses v1 and v2 library files', () => {
    const v2 = parseLibrary({ type: 'excalidrawlib', version: 2, libraryItems: [{ id: 'L1', status: 'published', elements: [{ id: 'x', type: 'ellipse' }] }, { id: 'L2', elements: [] }] });
    expect(v2.items.map((i) => [i.id, i.status])).toEqual([['L1', 'published']]);
    const v1 = parseLibrary({ type: 'excalidrawlib', version: 1, library: [[{ id: 'x', type: 'ellipse' }]] });
    expect(v1.items).toHaveLength(1);
    expect(v1.items[0].status).toBe('unpublished');
    expect(() => parseLibrary({ type: 'excalidrawlib' })).toThrow(ImportError);
  });
});

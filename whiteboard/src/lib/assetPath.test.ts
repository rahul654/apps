import { describe, expect, it } from 'vitest';
import { excalidrawAssetPath } from './assetPath';

describe('excalidrawAssetPath', () => {
  it('is the absolute folder of the page, ignoring the hash route and query', () => {
    expect(excalidrawAssetPath('https://rahul654.github.io/apps/whiteboard/#/b/b_123')).toBe('https://rahul654.github.io/apps/whiteboard/');
    expect(excalidrawAssetPath('https://rahul654.github.io/apps/whiteboard/index.html?element=x#/')).toBe('https://rahul654.github.io/apps/whiteboard/');
    expect(excalidrawAssetPath('http://localhost:4323/')).toBe('http://localhost:4323/');
    // Font URIs are "./fonts/...", resolved against this base.
    expect(new URL('./fonts/Excalifont/a.woff2', excalidrawAssetPath('https://h/apps/whiteboard/#/')).href).toBe('https://h/apps/whiteboard/fonts/Excalifont/a.woff2');
  });
});

declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH?: string | string[];
  }
}

/**
 * Excalidraw loads fonts from `${EXCALIDRAW_ASSET_PATH}/fonts/...` and falls back to esm.sh.
 * It resolves a *relative* path against the site origin, not the page, so "./" would point
 * at https://host/fonts/ instead of /apps/whiteboard/fonts/. Use the absolute URL of the
 * folder holding index.html instead; vite.config.ts copies the fonts there (dist/fonts/).
 */
export function excalidrawAssetPath(href: string = window.location.href): string {
  return new URL('./', href).href;
}

export function installExcalidrawAssetPath(): void {
  if (typeof window !== 'undefined') window.EXCALIDRAW_ASSET_PATH = excalidrawAssetPath();
}

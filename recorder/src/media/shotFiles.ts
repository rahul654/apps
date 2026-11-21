/** Download / copy / share for screenshots: the annotated image is rendered on demand. */
import { safeFilename } from '../lib/format';
import { screenshotStore, type ScreenshotMeta } from '../lib/screenshotStore';
import { loadImage, renderScene, type ExportType, type LoadedImage } from './annotateRender';
import { downloadBlob } from './files';

const EXT: Record<ExportType, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

async function withImage<T>(m: ScreenshotMeta, fn: (img: LoadedImage) => Promise<T>, loaded?: LoadedImage): Promise<T> {
  if (loaded) return fn(loaded);
  const blob = await screenshotStore().getImage(m.id);
  if (!blob) throw new Error('The screenshot’s image is missing from this browser’s storage.');
  const img = await loadImage(blob);
  try {
    return await fn(img);
  } finally {
    img.close();
  }
}

/** The annotated, cropped image. Pass `loaded` when the editor already has it decoded. */
export function exportShot(m: ScreenshotMeta, type: ExportType = 'image/png', loaded?: LoadedImage): Promise<Blob> {
  return withImage(m, (img) => renderScene(img, m.scene, type), loaded);
}

export async function downloadShot(m: ScreenshotMeta, type: ExportType = 'image/png', loaded?: LoadedImage): Promise<void> {
  downloadBlob(await exportShot(m, type, loaded), safeFilename(m.title, EXT[type]));
}

export function canCopyImages(): boolean {
  return typeof ClipboardItem === 'function' && typeof navigator.clipboard?.write === 'function';
}

/**
 * Copies the PNG to the clipboard. The ClipboardItem gets a promise so the click's user
 * activation is still valid when Safari checks it.
 */
export async function copyShot(m: ScreenshotMeta, loaded?: LoadedImage): Promise<void> {
  if (!canCopyImages()) throw new Error('This browser can’t copy images. Download it instead.');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': exportShot(m, 'image/png', loaded) })]);
}

export function canShareImages(): boolean {
  try {
    return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
}

export async function shareShot(m: ScreenshotMeta, loaded?: LoadedImage): Promise<void> {
  const file = new File([await exportShot(m, 'image/png', loaded)], safeFilename(m.title, 'png'), { type: 'image/png' });
  if (!navigator.canShare?.({ files: [file] })) throw new Error('This browser can’t share images. Download it instead.');
  await navigator.share({ files: [file], title: m.title });
}

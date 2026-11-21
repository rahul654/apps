/** Download and Web Share for stored recordings. */
import { safeFilename } from '../lib/format';
import { describeMime } from '../lib/mime';
import { recordingStore, type RecordingMeta } from '../lib/recordingStore';

export function filenameFor(m: Pick<RecordingMeta, 'title' | 'mimeType'>): string {
  return safeFilename(m.title, describeMime(m.mimeType).ext);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // The download reads from the URL asynchronously; revoke once it has surely started.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadRecording(m: RecordingMeta): Promise<void> {
  const blob = await recordingStore().getBlob(m.id);
  downloadBlob(blob, filenameFor(m));
}

export function canShareRecordings(): boolean {
  try {
    return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([''], 'x.mp4', { type: 'video/mp4' })] });
  } catch {
    return false;
  }
}

export async function shareRecording(m: RecordingMeta): Promise<void> {
  const blob = await recordingStore().getBlob(m.id);
  const type = m.mimeType.split(';')[0];
  const file = new File([blob], filenameFor(m), { type });
  if (!navigator.canShare?.({ files: [file] })) throw new Error(`This browser can’t share ${describeMime(m.mimeType).label} files. Download it instead.`);
  await navigator.share({ files: [file], title: m.title });
}

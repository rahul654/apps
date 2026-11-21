/** Browser feature detection. Evaluated lazily so tests / SSR don't touch `window`. */

const w = () => (typeof window === 'undefined' ? undefined : window);

export function canRecordScreen(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

export function canUseDevices(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

export function hasMediaRecorder(): boolean {
  return typeof MediaRecorder !== 'undefined';
}

export function isTypeSupported(type: string): boolean {
  try {
    return hasMediaRecorder() && MediaRecorder.isTypeSupported(type);
  } catch {
    return false;
  }
}

/** Chromium "breakout box": main-thread MediaStreamTrackProcessor + MediaStreamTrackGenerator. */
export function hasBreakoutBox(): boolean {
  const g = w() as unknown as Record<string, unknown> | undefined;
  return !!g && typeof g.MediaStreamTrackProcessor === 'function' && typeof g.MediaStreamTrackGenerator === 'function' && typeof VideoFrame === 'function' && typeof OffscreenCanvas === 'function';
}

export function hasDocumentPip(): boolean {
  return !!w()?.documentPictureInPicture;
}

export function hasVideoPip(): boolean {
  return typeof document !== 'undefined' && !!document.pictureInPictureEnabled;
}

export function hasWebCodecs(): boolean {
  return typeof VideoEncoder === 'function' && typeof VideoDecoder === 'function';
}

export function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

/** Desktop Safari / iOS WebKit (no tab or system audio in getDisplayMedia). */
export function isSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\/|OPR\/|Firefox\//.test(ua);
}

export function isFirefox(): boolean {
  return typeof navigator !== 'undefined' && /Firefox\//.test(navigator.userAgent);
}

export function canShareFiles(file: File): boolean {
  try {
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export interface StorageInfo {
  usage: number;
  quota: number;
  persisted: boolean | null;
}

export async function storageInfo(): Promise<StorageInfo | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : null;
    return { usage, quota, persisted };
  } catch {
    return null;
  }
}

/** Asks the browser not to evict recordings under storage pressure. */
export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

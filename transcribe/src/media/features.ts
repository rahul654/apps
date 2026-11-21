/** Browser capability checks and storage info. */

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

export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

let gpuCheck: Promise<boolean> | null = null;
/** True when a WebGPU adapter can be obtained on the page. (The worker checks again for itself.) */
export function webGpuAvailable(): Promise<boolean> {
  if (!gpuCheck) {
    gpuCheck = (async () => {
      try {
        const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
        return !!gpu && !!(await gpu.requestAdapter());
      } catch {
        return false;
      }
    })();
  }
  return gpuCheck;
}

export function micSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
}

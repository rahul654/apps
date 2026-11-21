/** getDisplayMedia / getUserMedia wrappers (with test-mode fakes) and device listing. */
import type { ResolutionCap } from '../lib/geometry';
import { fakeCamera, fakeDevices, fakeMic, fakeScreen, isFakeMode } from './fake';
import { isFirefox, isSafari } from './features';

const CAP_BOX: Record<Exclude<ResolutionCap, 'source'>, { w: number; h: number }> = {
  '720': { w: 1280, h: 720 },
  '1080': { w: 1920, h: 1080 },
};

export function stopStream(s: MediaStream | null | undefined): void {
  s?.getTracks().forEach((t) => t.stop());
}

/** Must be called straight from a user gesture (no awaits before it). */
export function getScreen(opts: { audio: boolean; fps: number }): Promise<MediaStream> {
  if (isFakeMode()) return Promise.resolve(fakeScreen(opts.audio, opts.fps));
  // Safari and Firefox can't capture tab / system audio; asking for it can make the call fail.
  const wantAudio = opts.audio && !isSafari() && !isFirefox();
  const options: DisplayMediaStreamOptions = {
    // No resolution constraint: the capture is scaled in the compositor / via applyConstraints,
    // which keeps the aspect ratio. Frame rate is a ceiling.
    video: { frameRate: { ideal: opts.fps, max: opts.fps } },
    audio: wantAudio
      ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false }
      : false,
    // Chromium hints: offer system audio, hide this tab (avoids the "hall of mirrors"),
    // allow switching the shared tab mid-recording.
    systemAudio: wantAudio ? 'include' : 'exclude',
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
    monitorTypeSurfaces: 'include',
  };
  return navigator.mediaDevices.getDisplayMedia(options);
}

/** Downscale a screen track (keeps aspect) when recording it directly. Best effort. */
export async function capTrack(track: MediaStreamTrack, cap: ResolutionCap, fps: number): Promise<void> {
  if (cap === 'source') return;
  const s = track.getSettings();
  const box = CAP_BOX[cap];
  const portrait = (s.height ?? 0) > (s.width ?? 0);
  const maxW = portrait ? box.h : box.w;
  const maxH = portrait ? box.w : box.h;
  if ((s.width ?? 0) <= maxW && (s.height ?? 0) <= maxH) return;
  try {
    await track.applyConstraints({ width: { max: maxW }, height: { max: maxH }, frameRate: { max: fps } });
  } catch {
    /* not supported: record at source size */
  }
}

export function cameraConstraints(deviceId: string, cap: ResolutionCap, fps: number): MediaTrackConstraints {
  const box = cap === '720' ? CAP_BOX['720'] : CAP_BOX['1080'];
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    width: { ideal: box.w },
    height: { ideal: box.h },
    frameRate: { ideal: fps },
  };
}

const retryable = (e: unknown) => ['OverconstrainedError', 'NotFoundError'].includes((e as { name?: string })?.name ?? '');

export async function getCamera(deviceId: string, cap: ResolutionCap, fps: number): Promise<MediaStream> {
  if (isFakeMode()) return fakeCamera(fps);
  try {
    return await navigator.mediaDevices.getUserMedia({ video: cameraConstraints(deviceId, cap, fps), audio: false });
  } catch (e) {
    // A remembered device id that's gone: fall back to the default camera.
    if (deviceId && retryable(e)) return navigator.mediaDevices.getUserMedia({ video: cameraConstraints('', cap, fps), audio: false });
    throw e;
  }
}

export async function getMic(deviceId: string): Promise<MediaStream> {
  if (isFakeMode()) return fakeMic();
  const base: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { ...base, deviceId: { exact: deviceId } } : base, video: false });
  } catch (e) {
    if (deviceId && retryable(e)) return navigator.mediaDevices.getUserMedia({ audio: base, video: false });
    throw e;
  }
}

export interface DeviceLists {
  cameras: MediaDeviceInfo[];
  mics: MediaDeviceInfo[];
}

export async function listDevices(): Promise<DeviceLists> {
  if (isFakeMode()) return fakeDevices();
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    // Before permission, ids / labels are blank; keep one placeholder per kind.
    return {
      cameras: all.filter((d) => d.kind === 'videoinput'),
      mics: all.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications'),
    };
  } catch {
    return { cameras: [], mics: [] };
  }
}

/** "granted" | "denied" | "prompt" | null (unknown) for camera / microphone. */
export async function permissionState(name: 'camera' | 'microphone'): Promise<PermissionState | null> {
  if (isFakeMode()) return 'granted';
  try {
    const s = await navigator.permissions.query({ name: name as PermissionName });
    return s.state;
  } catch {
    return null;
  }
}

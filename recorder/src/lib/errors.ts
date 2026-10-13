import type { RecError } from './recorderMachine';

export type DeviceKind = 'screen' | 'camera' | 'microphone' | 'camera and microphone';

const NOUN: Record<DeviceKind, string> = {
  screen: 'Screen sharing',
  camera: 'Camera',
  microphone: 'Microphone',
  'camera and microphone': 'Camera and microphone',
};

/** Friendly copy for getUserMedia / getDisplayMedia / MediaRecorder failures. Pure. */
export function mediaErrorInfo(err: unknown, kind: DeviceKind): RecError {
  const name = (err as { name?: string } | null)?.name ?? '';
  const raw = (err as { message?: string } | null)?.message ?? String(err);
  const noun = NOUN[kind];
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      if (kind === 'screen') {
        return {
          title: 'Screen sharing was cancelled',
          message: 'Pick a tab, window or screen to share. If you didn’t see a picker, your browser or OS may be blocking screen recording (on macOS: System Settings → Privacy & Security → Screen Recording).',
          canRetry: true,
        };
      }
      return {
        title: `${noun} access was blocked`,
        message: `Allow ${kind} access for this site (click the camera or lock icon in the address bar), then try again.`,
        canRetry: true,
      };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return {
        title: `No ${kind === 'screen' ? 'screen source' : kind} found`,
        message: kind === 'screen' ? 'Your browser didn’t offer anything to share.' : `Connect a ${kind === 'camera and microphone' ? 'camera or microphone' : kind}, or pick another mode, then try again.`,
        canRetry: true,
      };
    case 'NotReadableError':
    case 'TrackStartError':
      return {
        title: `${noun} is in use or unavailable`,
        message: kind === 'screen'
          ? 'The browser couldn’t start the capture. Close other apps that are recording the screen and try again.'
          : `Another app (a video call, OBS…) may be using your ${kind}. Close it, or pick a different device, and try again.`,
        canRetry: true,
      };
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return {
        title: `The chosen ${kind} isn’t available`,
        message: 'It may have been unplugged. Pick another device and try again.',
        canRetry: true,
      };
    case 'SecurityError':
      return {
        title: `${noun} isn’t allowed here`,
        message: 'Recording needs a secure page (https) and may be blocked by browser policy or an iframe.',
        canRetry: false,
      };
    case 'AbortError':
      return { title: `${noun} was interrupted`, message: 'Something stopped the capture before it started. Try again.', canRetry: true };
    case 'NotSupportedError':
      return { title: 'Not supported in this browser', message: raw || `This browser can’t record from the ${kind}.`, canRetry: false };
    default:
      return { title: 'Something went wrong', message: raw || 'Unknown error.', canRetry: true };
  }
}

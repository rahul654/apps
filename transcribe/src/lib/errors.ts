/** Friendly copy for getUserMedia / MediaRecorder / decoding failures. Pure. */

export interface ErrorInfo {
  title: string;
  message: string;
  canRetry: boolean;
}

export function micErrorInfo(err: unknown): ErrorInfo {
  const name = (err as { name?: string } | null)?.name ?? '';
  const raw = (err as { message?: string } | null)?.message ?? String(err);
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return {
        title: 'Microphone access was blocked',
        message: 'Allow microphone access for this site (click the microphone or lock icon in the address bar), then try again.',
        canRetry: true,
      };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return { title: 'No microphone found', message: 'Connect a microphone, or upload a file instead, then try again.', canRetry: true };
    case 'NotReadableError':
    case 'TrackStartError':
      return {
        title: 'Microphone is in use or unavailable',
        message: 'Another app (a video call, a recorder…) may be using it. Close that app or pick another microphone, and try again.',
        canRetry: true,
      };
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return { title: 'That microphone isn’t available', message: 'It may have been unplugged. Pick another one and try again.', canRetry: true };
    case 'SecurityError':
      return { title: 'Microphone isn’t allowed here', message: 'Recording needs a secure page (https) and may be blocked by browser policy or an iframe.', canRetry: false };
    case 'AbortError':
      return { title: 'Microphone was interrupted', message: 'Something stopped the capture before it started. Try again.', canRetry: true };
    case 'NotSupportedError':
      return { title: 'Not supported in this browser', message: raw || 'This browser can’t record from the microphone.', canRetry: false };
    default:
      return { title: 'Something went wrong', message: raw || 'Unknown error.', canRetry: true };
  }
}

export function decodeErrorInfo(err: unknown, fileName?: string): ErrorInfo {
  const name = (err as { name?: string } | null)?.name ?? '';
  const what = fileName ? `“${fileName}”` : 'This file';
  if (name === 'EncodingError' || name === 'NotSupportedError' || /decode|unable to/i.test(String((err as Error)?.message))) {
    return {
      title: 'Can’t read the audio',
      message: `${what} has no audio track this browser can decode. Try MP3, WAV, M4A/AAC, OGG/Opus, WebM or MP4.`,
      canRetry: false,
    };
  }
  if (name === 'QuotaExceededError' || /memory|allocation/i.test(String((err as Error)?.message))) {
    return { title: 'Not enough memory', message: `${what} is too long to decode in one go here. Try a shorter file.`, canRetry: false };
  }
  return { title: 'Couldn’t open the file', message: String((err as Error)?.message ?? err), canRetry: false };
}

/** Errors from the Web Speech API (`SpeechRecognitionErrorEvent.error`). */
export function dictationErrorInfo(code: string): ErrorInfo {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return { title: 'Dictation was blocked', message: 'Allow microphone access for this site. Some browsers also turn the speech service off by policy.', canRetry: true };
    case 'network':
      return { title: 'Dictation needs the internet', message: 'Live dictation sends audio to your browser’s speech service, and it couldn’t be reached. Use the Whisper modes to work offline.', canRetry: true };
    case 'audio-capture':
      return { title: 'No microphone found', message: 'Connect a microphone and try again.', canRetry: true };
    case 'language-not-supported':
      return { title: 'Language not supported', message: 'The speech service doesn’t support that language. Pick another one.', canRetry: true };
    default:
      return { title: 'Dictation stopped', message: `The speech service reported “${code}”.`, canRetry: true };
  }
}

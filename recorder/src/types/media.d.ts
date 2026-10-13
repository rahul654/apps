// Experimental / non-standard media APIs not (yet) in TypeScript's DOM lib.

// MediaStreamTrackProcessor / MediaStreamTrackGenerator come from @types/dom-mediacapture-transform.

/** Spec: VideoTrackGenerator, exposed in dedicated workers (Safari 18+). */
declare class VideoTrackGenerator {
  constructor();
  readonly writable: WritableStream<VideoFrame>;
  readonly track: MediaStreamTrack;
  muted: boolean;
}

/** Document Picture-in-Picture (Chromium 116+). */
interface DocumentPictureInPicture extends EventTarget {
  requestWindow(options?: { width?: number; height?: number; disallowReturnToOpener?: boolean; preferInitialWindowPlacement?: boolean }): Promise<Window>;
  readonly window: Window | null;
}
interface Window {
  documentPictureInPicture?: DocumentPictureInPicture;
}

/** getDisplayMedia extras (Chromium). */
interface DisplayMediaStreamOptions {
  systemAudio?: 'include' | 'exclude';
  selfBrowserSurface?: 'include' | 'exclude';
  surfaceSwitching?: 'include' | 'exclude';
  monitorTypeSurfaces?: 'include' | 'exclude';
  preferCurrentTab?: boolean;
}
interface MediaTrackConstraintSet {
  displaySurface?: ConstrainDOMString;
  suppressLocalAudioPlayback?: ConstrainBoolean;
}

interface HTMLMediaElement {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
}

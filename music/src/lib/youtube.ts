/**
 * Loads the YouTube IFrame Player API once and wraps the few `YT.Player` calls the app uses.
 * Types are declared here (no @types package). Clip ends are enforced by the caller polling
 * `getCurrentTime()`, never with `endSeconds`, so a song can switch to full playback mid-clip.
 */

export const PlayerState = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;

export interface YTPlayer {
  loadVideoById(options: { videoId: string; startSeconds?: number }): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  destroy(): void;
}

export interface YTEvent<T = unknown> {
  target: YTPlayer;
  data: T;
}

export interface YTPlayerOptions {
  width?: string | number;
  height?: string | number;
  videoId?: string;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (e: YTEvent) => void;
    onStateChange?: (e: YTEvent<number>) => void;
    onError?: (e: YTEvent<number>) => void;
  };
}

export interface YTNamespace {
  Player: new (el: HTMLElement, options: YTPlayerOptions) => YTPlayer;
}

declare global {
  interface Window {
    YT?: Partial<YTNamespace>;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export const IFRAME_API_URL = 'https://www.youtube.com/iframe_api';

let apiPromise: Promise<YTNamespace> | null = null;

function readyApi(): YTNamespace | null {
  const yt = window.YT;
  return yt && typeof yt.Player === 'function' ? (yt as YTNamespace) : null;
}

/** Injects the API script on first call; later calls share the same promise. A failed load can be retried. */
export function loadYouTubeApi(): Promise<YTNamespace> {
  const ready = readyApi();
  if (ready) return Promise.resolve(ready);
  apiPromise ??= new Promise<YTNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      const api = readyApi();
      if (api) resolve(api);
      else reject(new Error('The YouTube player API loaded without a Player.'));
    };
    const script = document.createElement('script');
    script.src = IFRAME_API_URL;
    script.async = true;
    script.onerror = () => {
      script.remove();
      window.onYouTubeIframeAPIReady = previous;
      apiPromise = null;
      reject(new Error('Couldn’t load the YouTube player. Check your connection or any content blocker.'));
    };
    document.head.appendChild(script);
  });
  return apiPromise;
}

export interface PlayerHandlers {
  onReady: () => void;
  onStateChange: (state: number) => void;
  onError: (code: number) => void;
}

/**
 * Creates a player inside `host` (in a child element the API replaces with its iframe, so React
 * never owns the replaced node). `onReady` fires once it can take commands; nothing is loaded or played.
 */
export function createPlayer(api: YTNamespace, host: HTMLElement, handlers: PlayerHandlers): YTPlayer {
  const mount = document.createElement('div');
  host.appendChild(mount);
  return new api.Player(mount, {
    width: '100%',
    height: '100%',
    playerVars: { playsinline: 1, rel: 0, origin: window.location.origin },
    events: {
      onReady: () => handlers.onReady(),
      onStateChange: (e) => handlers.onStateChange(e.data),
      onError: (e) => handlers.onError(e.data),
    },
  });
}

/** Human text for the player's error codes. */
export function describePlayerError(code: number): string {
  switch (code) {
    case 2:
      return 'YouTube rejected the video id';
    case 5:
      return 'This video can’t play in the browser’s player';
    case 100:
      return 'Removed or private on YouTube';
    case 101:
    case 150:
      return 'The owner doesn’t allow playing it here';
    default:
      return `YouTube couldn’t play it (error ${code})`;
  }
}

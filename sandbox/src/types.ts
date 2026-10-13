/** A web sandbox loads a URL; an HTML sandbox runs code you type (via `srcdoc`). */
export type SandboxKind = 'web' | 'html';

/** The `sandbox` attribute tokens this app exposes. `allow-top-navigation` is deliberately left out. */
export type SandboxToken =
  | 'allow-scripts'
  | 'allow-same-origin'
  | 'allow-forms'
  | 'allow-popups'
  | 'allow-popups-to-escape-sandbox'
  | 'allow-modals'
  | 'allow-downloads'
  | 'allow-pointer-lock'
  | 'allow-presentation'
  | 'allow-top-navigation-by-user-activation';

/** Permissions Policy features delegated through the iframe `allow` attribute. */
export type FeatureName =
  | 'fullscreen'
  | 'clipboard-write'
  | 'clipboard-read'
  | 'autoplay'
  | 'picture-in-picture'
  | 'camera'
  | 'microphone'
  | 'display-capture'
  | 'geolocation'
  | 'web-share'
  | 'payment';

export type ReferrerOption = 'no-referrer' | 'origin' | 'strict-origin-when-cross-origin';

export interface Viewport {
  /** A preset id from `lib/viewports.ts`: 'fill', 'custom' or a device. */
  preset: string;
  /** Used when preset is 'custom'. CSS pixels. */
  width: number;
  height: number;
  landscape: boolean;
  /** Scale the frame down to fit the stage instead of scrolling. */
  fit: boolean;
}

export interface Sandbox {
  id: string;
  name: string;
  /** True until the user renames it; the name then stops following the URL's host. */
  autoName: boolean;
  kind: SandboxKind;
  /** Web sandboxes: the address loaded into the frame ('' = not opened yet). */
  url: string;
  /** HTML sandboxes: the document source. */
  html: string;
  /** HTML sandboxes: re-run shortly after each edit. */
  autoRun: boolean;
  tokens: SandboxToken[];
  features: FeatureName[];
  referrer: ReferrerOption;
  /** Load as a `credentialless` iframe (Chromium): no cookies, temporary storage. */
  credentialless: boolean;
  viewport: Viewport;
  createdAt: number;
  updatedAt: number;
}

export interface AppData {
  version: 1;
  sandboxes: Sandbox[];
}

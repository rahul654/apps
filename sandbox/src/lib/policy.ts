import type { FeatureName, ReferrerOption, Sandbox, SandboxToken } from '../types';
import { originOf } from './url';

export interface TokenInfo {
  token: SandboxToken;
  label: string;
  help: string;
  /** Weakens isolation noticeably; the UI flags it. */
  risky?: boolean;
}

/** In display order; `sandbox` attributes are always written in this order. */
export const TOKENS: TokenInfo[] = [
  { token: 'allow-scripts', label: 'Run JavaScript', help: 'Most modern sites need this.' },
  {
    token: 'allow-same-origin',
    label: 'Keep the site’s own origin',
    help: 'Lets the page use its own cookies and storage. Without it the page gets an anonymous origin, and sites that use storage often break.',
  },
  { token: 'allow-forms', label: 'Submit forms', help: 'Search boxes, sign-in forms and so on.' },
  { token: 'allow-popups', label: 'Open popups and new tabs', help: 'New windows inherit this sandbox.' },
  { token: 'allow-popups-to-escape-sandbox', label: 'Popups leave the sandbox', help: 'New windows open without these restrictions.', risky: true },
  { token: 'allow-modals', label: 'Dialogs', help: 'alert(), confirm(), prompt() and print().' },
  { token: 'allow-downloads', label: 'Download files', help: '' },
  { token: 'allow-pointer-lock', label: 'Pointer lock', help: 'Mostly used by games.' },
  { token: 'allow-presentation', label: 'Presentation API', help: 'Casting to a second screen.' },
  {
    token: 'allow-top-navigation-by-user-activation',
    label: 'Replace this app when a link is clicked',
    help: 'A link inside the page may navigate this whole tab away, but only when you click it.',
    risky: true,
  },
];

const ORDER = new Map(TOKENS.map((t, i) => [t.token, i]));

export type PresetId = 'strict' | 'isolated' | 'standard';

export const PRESETS: Record<PresetId, { label: string; help: string; tokens: SandboxToken[] }> = {
  strict: {
    label: 'Strict',
    help: 'No JavaScript, forms or popups. A static view of the page.',
    tokens: [],
  },
  isolated: {
    label: 'Isolated',
    help: 'JavaScript runs, but the page gets an anonymous origin with no cookies or storage. Some sites break.',
    tokens: ['allow-scripts', 'allow-forms', 'allow-popups', 'allow-modals'],
  },
  standard: {
    label: 'Standard',
    help: 'JavaScript, forms, popups and the site’s own storage. It still can’t reach this app or navigate it away.',
    tokens: ['allow-scripts', 'allow-same-origin', 'allow-forms', 'allow-popups', 'allow-modals', 'allow-downloads'],
  },
};

export const PRESET_IDS = Object.keys(PRESETS) as PresetId[];

/** Dedupes, drops unknown tokens and sorts into display order. */
export function orderTokens(tokens: readonly string[]): SandboxToken[] {
  const known = tokens.filter((t): t is SandboxToken => ORDER.has(t as SandboxToken));
  return [...new Set(known)].sort((a, b) => ORDER.get(a)! - ORDER.get(b)!);
}

export function presetOf(tokens: readonly SandboxToken[]): PresetId | 'custom' {
  const key = orderTokens(tokens).join(' ');
  return PRESET_IDS.find((id) => orderTokens(PRESETS[id].tokens).join(' ') === key) ?? 'custom';
}

export interface DroppedToken {
  token: SandboxToken;
  reason: string;
}

/**
 * The tokens actually written to the iframe. `allow-scripts` + `allow-same-origin` on content
 * that shares this app's origin would let it delete its own `sandbox` attribute, so that pair
 * is never allowed for HTML sandboxes (srcdoc inherits our origin) or same-origin URLs.
 */
export function effectiveTokens(
  sb: Pick<Sandbox, 'kind' | 'tokens' | 'url'>,
  appOrigin: string,
): { tokens: SandboxToken[]; dropped: DroppedToken[] } {
  const tokens = orderTokens(sb.tokens);
  const dropped: DroppedToken[] = [];
  if (tokens.includes('allow-same-origin')) {
    if (sb.kind === 'html') {
      dropped.push({
        token: 'allow-same-origin',
        reason: 'HTML sandboxes always run with an anonymous origin. Otherwise the code would share this app’s origin and could remove its own sandbox.',
      });
    } else if (tokens.includes('allow-scripts') && originOf(sb.url) === appOrigin) {
      dropped.push({
        token: 'allow-same-origin',
        reason: 'This page is on the same origin as this app. With JavaScript and its own origin it could remove its own sandbox, so it runs with an anonymous origin.',
      });
    }
  }
  const drop = new Set(dropped.map((d) => d.token));
  return { tokens: tokens.filter((t) => !drop.has(t)), dropped };
}

export interface FeatureInfo {
  feature: FeatureName;
  label: string;
}

export const FEATURES: FeatureInfo[] = [
  { feature: 'fullscreen', label: 'Fullscreen' },
  { feature: 'clipboard-write', label: 'Write to clipboard' },
  { feature: 'clipboard-read', label: 'Read clipboard' },
  { feature: 'autoplay', label: 'Autoplay media with sound' },
  { feature: 'picture-in-picture', label: 'Picture-in-picture' },
  { feature: 'camera', label: 'Camera' },
  { feature: 'microphone', label: 'Microphone' },
  { feature: 'display-capture', label: 'Screen sharing' },
  { feature: 'geolocation', label: 'Location' },
  { feature: 'web-share', label: 'Share sheet' },
  { feature: 'payment', label: 'Payment Request' },
];

const FEATURE_ORDER = new Map(FEATURES.map((f, i) => [f.feature, i]));

export function orderFeatures(features: readonly string[]): FeatureName[] {
  const known = features.filter((f): f is FeatureName => FEATURE_ORDER.has(f as FeatureName));
  return [...new Set(known)].sort((a, b) => FEATURE_ORDER.get(a)! - FEATURE_ORDER.get(b)!);
}

/**
 * Value for the iframe `allow` attribute. `*` rather than the default `'src'` so delegation also
 * works for srcdoc frames, whose origin is opaque. Anything not listed is denied to the frame.
 */
export function allowAttr(features: readonly FeatureName[]): string {
  return orderFeatures(features)
    .map((f) => `${f} *`)
    .join('; ');
}

export const REFERRERS: { value: ReferrerOption; label: string }[] = [
  { value: 'no-referrer', label: 'Send nothing' },
  { value: 'origin', label: 'Only this app’s origin' },
  { value: 'strict-origin-when-cross-origin', label: 'Browser default' },
];

/** Whether this browser supports `<iframe credentialless>` (Chromium 110+). */
export function supportsCredentialless(): boolean {
  return typeof HTMLIFrameElement !== 'undefined' && 'credentialless' in HTMLIFrameElement.prototype;
}

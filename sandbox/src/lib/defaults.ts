import type { Sandbox, SandboxKind, Viewport } from '../types';
import { PRESETS } from './policy';
import { hostOf } from './url';

export const DEFAULT_VIEWPORT: Viewport = { preset: 'fill', width: 1280, height: 800, landscape: false, fit: true };

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function defaultName(kind: SandboxKind, url: string): string {
  if (kind === 'html') return 'HTML playground';
  return hostOf(url).replace(/^www\./, '') || 'New sandbox';
}

export const STARTER_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Playground</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; line-height: 1.5; }
    button { font: inherit; padding: .5rem 1rem; border-radius: .5rem; border: 1px solid #888; cursor: pointer; }
  </style>
</head>
<body>
  <h1>Hello from the sandbox</h1>
  <p>This page runs in an isolated frame. It can’t read this app’s storage or navigate it away.</p>
  <button id="btn">Click me</button>

  <script>
    let clicks = 0;
    document.getElementById('btn').addEventListener('click', () => {
      clicks++;
      console.log('Clicked', clicks, 'times', { at: new Date().toLocaleTimeString() });
    });
    console.info('Origin inside the sandbox:', location.origin);
    try {
      localStorage.setItem('x', '1');
    } catch (e) {
      console.warn('No storage here:', e.name);
    }
  </script>
</body>
</html>
`;

export function createSandbox(kind: SandboxKind, init: Partial<Sandbox> = {}, now = Date.now()): Sandbox {
  const url = init.url ?? '';
  const sandbox: Sandbox = {
    id: newId(),
    name: defaultName(kind, url),
    autoName: true,
    kind,
    url,
    html: kind === 'html' ? STARTER_HTML : '',
    autoRun: true,
    tokens: kind === 'html' ? [...PRESETS.isolated.tokens] : [...PRESETS.standard.tokens],
    features: kind === 'html' ? ['fullscreen', 'clipboard-write'] : ['fullscreen'],
    referrer: 'no-referrer',
    credentialless: kind === 'web',
    viewport: { ...DEFAULT_VIEWPORT },
    createdAt: now,
    updatedAt: now,
    ...init,
  };
  if (!init.name) sandbox.name = defaultName(kind, sandbox.url);
  return sandbox;
}

/** A copy with a new id and a "(copy)" name. */
export function duplicateSandbox(sb: Sandbox, now = Date.now()): Sandbox {
  return { ...sb, id: newId(), name: `${sb.name} (copy)`, autoName: false, viewport: { ...sb.viewport }, createdAt: now, updatedAt: now };
}

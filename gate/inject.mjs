// Build-time half of the password gate (Node only; used by scripts/build-site.mjs).

/**
 * Apps the gate leaves open: anyone can view them without the site password.
 * - files: public by design (viewing needs nothing; uploads/deletes have their own password,
 *   checked by its own Apps Script; see "Files" in README.md).
 */
export const PUBLIC_APPS = ['files'];

/** Files copied to _site/gate/. Everything else in gate/ (this file, tests) stays out of the site. */
export const GATE_FILES = ['auth-gate.js', 'core.js', 'config.js'];

const MARKER = 'data-apps-gate';
// Until auth-gate.js has opened the page, nothing in <body> shows; if the gate can't load, it stays hidden.
const HIDE_CSS = 'html:not([data-gate="open"]) body{visibility:hidden!important}';

/**
 * Adds the gate to one built page.
 * - Renames every <script type="module"> to type="text/x-gated-module" (inert) so the app only
 *   starts when auth-gate.js puts them back after a correct password.
 * - Inserts the hiding style and the gate script at the start of <head>.
 * @param {string} html the page
 * @param {string} gateDir URL of the _site/gate/ folder relative to the page, ending in "/"
 */
export function injectGate(html, gateDir) {
  if (html.includes(MARKER)) throw new Error('The page already has the password gate.');
  const head = /<head\b[^>]*>/i.exec(html);
  if (!head) throw new Error('The page has no <head>.');
  const tags =
    `\n    <style ${MARKER}>${HIDE_CSS}</style>` +
    `\n    <script ${MARKER} type="module" src="${gateDir}auth-gate.js"></script>`;
  const at = head.index + head[0].length;
  const withGate = html.slice(0, at) + tags + html.slice(at);
  // Runs after inserting, so the gate's own tag (it has the marker before type) is left alone.
  return withGate.replace(/<script\b(?![^>]*\bdata-apps-gate\b)([^>]*?)\stype\s*=\s*(["']?)module\2(?=[\s>/])/gi, '<script$1 type="text/x-gated-module"');
}

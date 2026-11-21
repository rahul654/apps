/**
 * Tesseract's WebAssembly core prints diagnostics to stderr, which Emscripten routes to
 * console.error — harmless lines then show up red in DevTools. The self-hosted worker
 * is started through a tiny wrapper (generated below, emitted by vite.config.ts) that
 * drops known-benign lines and downgrades anything else to console.warn, so real
 * problems still surface. Pure — imported by vite.config.ts and by tests.
 */

export const BENIGN_TESSERACT_STDERR: RegExp[] = [
  /^Warning: Parameter not found: /,
  /^Estimating resolution as \d+/,
  /^Warning: Invalid resolution \d+ dpi\. Using \d+ instead\./,
  /^Detected \d+ diacritics/,
  /^Empty page!*/,
  /^Image too small to scale!*/,
  /^Line cannot be recognized!*/,
  /^Too few characters\. Skipping this page/,
  /^Failed to load any lstm-specific dictionaries/,
];

export function isBenignTesseractMessage(message: string): boolean {
  const s = message.trim();
  return s === '' || BENIGN_TESSERACT_STDERR.some((re) => re.test(s));
}

/** Source of the classic-worker wrapper that filters stderr and then loads `workerFile`. */
export function workerWrapperSource(workerFile: string): string {
  const patterns = JSON.stringify(BENIGN_TESSERACT_STDERR.map((r) => r.source));
  return `// File Tools: filter benign Tesseract stderr (see src/lib/ocr/stderr.ts), then start tesseract.js.
(function () {
  var benign = ${patterns}.map(function (s) { return new RegExp(s); });
  var warn = (console.warn || console.log).bind(console);
  var debug = (console.debug || function () {}).bind(console);
  console.error = function () {
    var msg = Array.prototype.map.call(arguments, String).join(' ').trim();
    if (msg === '' || benign.some(function (re) { return re.test(msg); })) { debug('[tesseract]', msg); return; }
    warn.apply(null, ['[tesseract]'].concat(Array.prototype.slice.call(arguments)));
  };
})();
importScripts(${JSON.stringify(workerFile)});
`;
}

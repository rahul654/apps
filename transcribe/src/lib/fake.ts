/**
 * Test mode: `?fake=1` (in the query or after the hash) swaps the microphone for a generated
 * tone, so the recording pipeline can be exercised in automated Chromium without a device.
 * For speech, launch Chromium with --use-fake-device-for-media-stream and
 * --use-file-for-fake-audio-capture=<wav> instead.
 */
export function isFakeMode(): boolean {
  if (typeof location === 'undefined') return false;
  const fromSearch = new URLSearchParams(location.search).get('fake');
  const hashQuery = location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?') + 1) : '';
  return fromSearch === '1' || new URLSearchParams(hashQuery).get('fake') === '1';
}

/** `?debug=1`: the worker logs each window's raw output (used to build merge test fixtures). */
export function isDebugMode(): boolean {
  if (typeof location === 'undefined') return false;
  const hashQuery = location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?') + 1) : '';
  return new URLSearchParams(location.search).get('debug') === '1' || new URLSearchParams(hashQuery).get('debug') === '1';
}

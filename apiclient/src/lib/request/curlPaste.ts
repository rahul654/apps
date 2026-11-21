/**
 * Pasting a cURL command into the URL bar (Postman behaviour): recognise it, parse it with the
 * same importer as Data → cURL, and replace the tab's request with it.
 */
import { curlToRequest } from '../postman/importers';
import type { PmRequestObject } from '../postman/types';

/** A pasted command line: optional `$ ` prompt, then `curl` or `curl.exe` and an argument. */
const CURL = /^\s*(?:\$\s*)?curl(?:\.exe)?(?=\s)/i;

export function looksLikeCurl(text: string): boolean {
  return CURL.test(text);
}

/** Parse a pasted command (prompt and `curl.exe` normalised). Throws with a readable message. */
export function parseCurlPaste(text: string): PmRequestObject {
  return curlToRequest(text.replace(CURL, 'curl').trim()).request;
}

/**
 * The tab's request after importing: method, URL, headers, body and auth come from the command;
 * the description stays. A command that carries its own credentials (`Authorization` header, or
 * `-u` which the importer turns into Basic auth) gets that auth only, so an inherited collection
 * auth isn't added on top. Without credentials the request inherits auth again.
 */
export function mergeCurlRequest(current: PmRequestObject, imported: PmRequestObject): PmRequestObject {
  const next: PmRequestObject = { ...imported };
  if (current.description !== undefined) next.description = current.description;
  const headers = Array.isArray(next.header) ? next.header : [];
  if (!next.auth && headers.some((h) => h.key.toLowerCase() === 'authorization')) next.auth = { type: 'noauth' };
  return next;
}

export function curlImportSummary(r: PmRequestObject): string {
  const headers = Array.isArray(r.header) ? r.header.length : 0;
  const parts = [`${headers} header${headers === 1 ? '' : 's'}`];
  const mode = r.body?.mode;
  if (mode === 'raw') parts.push(`a ${r.body?.options?.raw?.language === 'json' ? 'JSON' : 'raw'} body`);
  else if (mode === 'urlencoded') parts.push('a form (urlencoded) body');
  else if (mode === 'formdata') parts.push('a multipart form body');
  else if (mode === 'file') parts.push('a file body');
  if (r.auth?.type === 'basic') parts.push('Basic auth');
  return `Imported cURL: ${r.method ?? 'GET'} with ${parts.join(', ').replace(/, ([^,]*)$/, ' and $1')}.`;
}

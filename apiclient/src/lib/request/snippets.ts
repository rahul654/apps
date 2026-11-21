import type { PreparedRequest } from './build';

/** POSIX shell single-quoting (bash, zsh, Git Bash, WSL, macOS Terminal). */
const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Double-quoted value inside a curl -F argument (file names). */
const formQuote = (s: string) => `"${s.replace(/[\\"]/g, (c) => `\\${c}`)}"`;

/**
 * The resolved request as a curl command, like Postman's "Copy as cURL".
 *  - `--location`: the app follows redirects (fetch's default), so the command does too.
 *  - `--request` only where curl wouldn't pick the method itself (GET without data, POST with data).
 *  - `--head` for HEAD (`-X HEAD` makes curl wait for a body that never comes).
 *  - `--globoff` when the URL has [] or {}, which curl would otherwise treat as ranges.
 *  - Text form fields that curl would parse (`@file`, `<file`, `;type=`) go as `--form-string`.
 */
export function toCurl(req: PreparedRequest): string {
  const method = req.method.toUpperCase();
  const data: string[] = [];
  const b = req.body;
  if (b.kind === 'text' && b.text) data.push(`--data-raw ${sh(b.text)}`);
  else if (b.kind === 'form') {
    for (const p of b.parts) {
      if (p.file || p.fileName) data.push(`--form ${sh(`${p.key}=@${formQuote(p.fileName ?? 'file')}${p.contentType ? `;type=${p.contentType}` : ''}`)}`);
      else {
        const v = p.value ?? '';
        data.push(/^[@<]|;/.test(v) ? `--form-string ${sh(`${p.key}=${v}`)}` : `--form ${sh(`${p.key}=${v}`)}`);
      }
    }
  } else if (b.kind === 'bytes') data.push(`--data-binary ${sh(`@${b.fileName ?? 'file'}`)}`);

  const first = ['curl', '--location'];
  if (/[[\]{}]/.test(req.url)) first.push('--globoff');
  if (method === 'HEAD') first.push('--head');
  else if (!(method === 'GET' && data.length === 0) && !(method === 'POST' && data.length > 0)) first.push(`--request ${method}`);
  first.push(sh(req.url));

  const lines = [first.join(' ')];
  for (const h of req.headers) lines.push(`--header ${sh(`${h.key}: ${h.value}`)}`);
  lines.push(...data);
  return lines.join(' \\\n  ');
}

const js = (s: string) => JSON.stringify(s);

export function toFetch(req: PreparedRequest): string {
  const headers = req.headers.length ? `  headers: {\n${req.headers.map((h) => `    ${js(h.key)}: ${js(h.value)},`).join('\n')}\n  },\n` : '';
  let body = '';
  const b = req.body;
  if (b.kind === 'text' && b.text) body = `  body: ${js(b.text)},\n`;
  else if (b.kind === 'form') {
    const parts = b.parts.map((p) => (p.file ? `form.append(${js(p.key)}, fileInput.files[0]); // ${p.fileName ?? ''}` : `form.append(${js(p.key)}, ${js(p.value ?? '')});`)).join('\n');
    return `const form = new FormData();\n${parts}\n\nconst res = await fetch(${js(req.url)}, {\n  method: ${js(req.method)},\n${headers.replace(/ {4}"content-type": [^\n]*\n/i, '')}  body: form,\n});\nconsole.log(res.status, await res.text());`;
  } else if (b.kind === 'bytes') body = `  body: fileInput.files[0], // ${b.fileName ?? ''}\n`;
  return `const res = await fetch(${js(req.url)}, {\n  method: ${js(req.method)},\n${headers}${body}});\nconsole.log(res.status, await res.text());`;
}

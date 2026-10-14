import type { PreparedRequest } from './build';

const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export function toCurl(req: PreparedRequest): string {
  const lines = [`curl -X ${req.method} ${sh(req.url)}`];
  for (const h of req.headers) lines.push(`  -H ${sh(`${h.key}: ${h.value}`)}`);
  const b = req.body;
  if (b.kind === 'text' && b.text) lines.push(`  --data-raw ${sh(b.text)}`);
  else if (b.kind === 'form') for (const p of b.parts) lines.push(p.file ? `  -F ${sh(`${p.key}=@${p.fileName ?? 'file'}`)}` : `  -F ${sh(`${p.key}=${p.value ?? ''}`)}`);
  else if (b.kind === 'bytes') lines.push(`  --data-binary ${sh(`@${b.fileName ?? 'file'}`)}`);
  return lines.join(' \\\n');
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

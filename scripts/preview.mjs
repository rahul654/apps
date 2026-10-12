// Serves ./_site under /apps/ so the local URLs match GitHub Pages:
//   http://localhost:4173/apps/            → landing page
//   http://localhost:4173/apps/splitwise/  → Splitwise
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const site = resolve(import.meta.dirname, '..', '_site');
const BASE = '/apps/';
const PORT = Number(process.env.PORT) || 4173;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

if (!existsSync(site)) {
  console.error('No _site/ folder yet — run `npm run build` first.');
  process.exit(1);
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/' ) return res.writeHead(302, { Location: BASE }).end();
  if (!url.pathname.startsWith(BASE)) return res.writeHead(404).end('Not found');

  let file = join(site, normalize(decodeURIComponent(url.pathname.slice(BASE.length))));
  if (!file.startsWith(site)) return res.writeHead(403).end();
  if (existsSync(file) && statSync(file).isDirectory()) {
    // Mirror GitHub Pages: /apps/splitwise → /apps/splitwise/
    if (!url.pathname.endsWith('/')) return res.writeHead(301, { Location: `${url.pathname}/` }).end();
    file = join(file, 'index.html');
  }
  if (!existsSync(file)) {
    res.writeHead(404, { 'Content-Type': TYPES['.html'] });
    return createReadStream(join(site, '404.html')).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Preview: http://localhost:${PORT}${BASE}`));

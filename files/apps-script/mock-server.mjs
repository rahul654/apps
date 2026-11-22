// Local stand-in for the deployed Apps Script, for trying the page without Google:
//   FILES_PASSWORD=test-pass npm run mock          (port 4336; LIMIT_MB=… to test the limit)
//   VITE_FILES_URL=http://localhost:4336/exec VITE_FILES_MEDIA=http://localhost:4336 npm run dev
// POST /exec runs the real Code.gs (runtime.mjs) against an in-memory Drive. Because the fake
// files don't exist on drive.google.com, VITE_FILES_MEDIA points the page's thumbnails, previews
// and downloads here instead: /thumb/<id>, /preview/<id>, /media/<id>.
// FILES_MOCK_DELAY_MS (default 250) slows every script call down like Apps Script does.
// `kill -USR2 <pid>` changes the password to FILES_PASSWORD_NEXT (default "next-pass").
import { createServer } from 'node:http';
import { loadFilesScript } from './runtime.mjs';

const PORT = Number(process.env.FILES_MOCK_PORT || 4336);
const DELAY = Number(process.env.FILES_MOCK_DELAY_MS ?? 250);
const props = process.env.LIMIT_MB ? { LIMIT_MB: process.env.LIMIT_MB } : {};
const gs = loadFilesScript({ password: process.env.FILES_PASSWORD || 'test-pass', props });

process.on('SIGUSR2', () => {
  gs.props.set('UPLOAD_PASSWORD', process.env.FILES_PASSWORD_NEXT || 'next-pass');
  console.log('password changed');
});

const CORS = { 'Access-Control-Allow-Origin': '*' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const send = (code, headers, body) => {
    res.writeHead(code, { ...CORS, ...headers });
    res.end(body);
  };
  if (url.pathname === '/exec') {
    await new Promise((r) => setTimeout(r, DELAY));
    if (req.method === 'GET') return send(200, { 'Content-Type': 'application/json' }, JSON.stringify(gs.get()));
    if (req.method !== 'POST') return send(405, {}, '');
    const chunks = [];
    try {
      for await (const c of req) chunks.push(c);
    } catch {
      return; // the browser gave up on the request (navigated away, cancelled): nothing to answer
    }
    const body = Buffer.concat(chunks).toString('utf8');
    const reply = gs.post(body);
    let action = '?';
    try {
      action = JSON.parse(body).action;
    } catch {
      /* logged as ? */
    }
    console.log(`${new Date().toISOString().slice(11, 19)} ${action} → ${reply.ok ? 'ok' : reply.error}${reply.received !== undefined ? ` ${reply.received}` : ''}`);
    return send(200, { 'Content-Type': 'application/json' }, JSON.stringify(reply));
  }

  const m = /^\/(media|thumb|preview)\/([\w-]+)$/.exec(url.pathname);
  const file = m && gs.drive.files.get(m[2]);
  if (!file) return send(404, { 'Content-Type': 'text/plain' }, 'not found');
  const type = file.mimeType || 'application/octet-stream';
  if (m[1] === 'thumb') {
    if (!type.startsWith('image/')) return send(404, {}, '');
    return send(200, { 'Content-Type': type }, file.content);
  }
  if (m[1] === 'preview') {
    const src = `/media/${file.id}`;
    const inner = type.startsWith('image/')
      ? `<img src="${src}" alt="">`
      : type.startsWith('video/')
        ? `<video src="${src}" controls playsinline></video>`
        : type.startsWith('audio/')
          ? `<audio src="${src}" controls></audio>`
          : `<p>No preview available (mock)</p>`;
    return send(200, { 'Content-Type': 'text/html; charset=utf-8' }, `<!doctype html><title>${esc(file.name)}</title><style>html,body{margin:0;height:100%;background:#202124;color:#eee;display:grid;place-items:center;font:14px system-ui}img,video{max-width:100%;max-height:100vh}</style>${inner}`);
  }
  // media, with Range support so <video> can seek
  const total = file.content.length;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  const disposition = url.searchParams.has('download') ? { 'Content-Disposition': `attachment; filename="${encodeURIComponent(file.name)}"` } : {};
  if (range && total) {
    const start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
    return send(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${total}`, 'Accept-Ranges': 'bytes', ...disposition }, file.content.subarray(start, end + 1));
  }
  return send(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', ...disposition }, file.content);
}).listen(PORT, () => console.log(`Mock files Apps Script on http://localhost:${PORT}/exec (pid ${process.pid})`));

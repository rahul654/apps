// Local stand-in for the deployed Apps Script, running the real gate/apps-script.gs, for
// trying the password gate in a browser without deploying anything:
//
//   GATE_PASSWORD=test-password-1 node gate/mock-server.mjs     → http://localhost:4335/exec
//
// Then build, set GATE_URL in _site/gate/config.js (the built copy) to that URL and run
// `npm run preview`. Like Apps Script it answers GET and POST with CORS allowed for any origin
// and doesn't answer OPTIONS preflights. Env: PORT (4335), GATE_PASSWORD (unset = no password).
// Every reply is delayed by DELAY_MS (default 300) to feel like the real thing.
import { createServer } from 'node:http';
import { loadAppsScript } from './gas-runtime.mjs';

const PORT = Number(process.env.PORT) || 4335;
const DELAY_MS = Number(process.env.DELAY_MS ?? 300);
const gs = loadAppsScript({ password: process.env.GATE_PASSWORD });

createServer((req, res) => {
  const send = (status, body) =>
    setTimeout(() => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(body);
    }, DELAY_MS);
  if (new URL(req.url, 'http://x').pathname !== '/exec') return send(404, '{"error":"not found"}');
  if (req.method === 'GET') {
    const { mimeType, ...reply } = gs.get();
    return send(200, JSON.stringify(reply));
  }
  if (req.method !== 'POST') return send(405, '{"error":"method"}');
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const { mimeType, ...reply } = gs.post(body);
    send(200, JSON.stringify(reply));
  });
}).listen(PORT, () => console.log(`Mock Apps Script: http://localhost:${PORT}/exec`));

// Lets a test change the password while running: kill -USR2 <pid> sets it from GATE_PASSWORD_NEXT.
process.on('SIGUSR2', () => {
  gs.props.set('PASSWORD', process.env.GATE_PASSWORD_NEXT ?? '');
  console.log('Password changed.');
});

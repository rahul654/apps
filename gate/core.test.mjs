import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callGate, GateError, MESSAGES, readSession, SESSION_MS, sessionFrom } from './core.js';
import { loadAppsScript } from './gas-runtime.mjs';

const URL_ = 'https://script.google.com/macros/s/TEST/exec';

/** A fetch that answers like the deployed Apps Script, using the real apps-script.gs. */
function fakeFetch(gs, seen = []) {
  return async (url, init) => {
    seen.push({ url, init });
    const reply = gs.post(init.body);
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

test('callGate sends a CORS-simple POST and returns the reply', async () => {
  const seen = [];
  const gs = loadAppsScript({ password: 'secret-pass' });
  const reply = await callGate(URL_, { action: 'login', password: 'secret-pass' }, { fetchImpl: fakeFetch(gs, seen) });
  assert.equal(reply.ok, true);
  assert.equal(seen[0].url, URL_);
  assert.equal(seen[0].init.method, 'POST');
  // text/plain keeps it a "simple" request: no OPTIONS preflight, which Apps Script can't answer.
  assert.equal(seen[0].init.headers['Content-Type'], 'text/plain;charset=utf-8');
  assert.equal(seen[0].init.credentials, 'omit');
  assert.deepEqual(JSON.parse(seen[0].init.body), { action: 'login', password: 'secret-pass' });
});

test('login then check through callGate, like the page does', async () => {
  const gs = loadAppsScript({ password: 'secret-pass' });
  const fetchImpl = fakeFetch(gs);
  const login = await callGate(URL_, { action: 'login', password: 'secret-pass' }, { fetchImpl });
  const s = sessionFrom(login.token, login.ttl, 1000);
  assert.deepEqual(s, { v: 2, token: login.token, exp: 1000 + SESSION_MS });
  assert.equal((await callGate(URL_, { action: 'check', token: s.token }, { fetchImpl })).ok, true);
  assert.equal((await callGate(URL_, { action: 'login', password: 'nope' }, { fetchImpl })).error, 'wrong');
});

test('callGate turns network failures and odd replies into GateError("network")', async () => {
  const cases = [
    async () => {
      throw new TypeError('Failed to fetch');
    },
    async () => new Response('Server error', { status: 500 }),
    async () => new Response('<html>Sign in</html>', { status: 200 }), // e.g. deployed with the wrong access
    async () => new Response('{"hello":1}', { status: 200 }),
    async () => new Response('null', { status: 200 }),
  ];
  for (const fetchImpl of cases) {
    await assert.rejects(callGate(URL_, { action: 'ping' }, { fetchImpl }), (e) => e instanceof GateError && e.code === 'network');
  }
});

test('callGate without a URL says the service isn’t set up', async () => {
  await assert.rejects(callGate('', { action: 'ping' }), (e) => e.code === 'no-url' && e.message === MESSAGES['no-url']);
});

test('every error the script can send has a message', () => {
  for (const code of ['wrong', 'too-many', 'not-configured', 'expired', 'changed', 'invalid', 'bad-request']) {
    assert.ok(MESSAGES[code], code);
    assert.equal(new GateError(code).message, MESSAGES[code]);
  }
  assert.equal(new GateError('something-new').message, MESSAGES['bad-request']);
});

test('sessionFrom caps the length at 12 hours and refuses bad replies', () => {
  assert.equal(sessionFrom('t', SESSION_MS * 5, 0).exp, SESSION_MS);
  assert.equal(sessionFrom('t', 1000, 0).exp, 1000);
  for (const [token, ttl] of [['', 1000], [null, 1000], ['t', 0], ['t', -5], ['t', NaN], ['t', '1000']]) {
    assert.equal(sessionFrom(token, ttl, 0), null, `${token} ${ttl}`);
  }
});

test('a stored session lasts until its exp', () => {
  const now = 1_700_000_000_000;
  const raw = JSON.stringify(sessionFrom('tok', SESSION_MS, now));
  assert.deepEqual(readSession(raw, now), { v: 2, token: 'tok', exp: now + SESSION_MS });
  assert.ok(readSession(raw, now + SESSION_MS - 1));
  assert.equal(readSession(raw, now + SESSION_MS), null);
});

test('rejects malformed sessions, old-format ones and ones that end too far ahead', () => {
  const now = 1_700_000_000_000;
  for (const raw of [
    null,
    '',
    'not json',
    'null',
    '{}',
    JSON.stringify({ v: 1, id: 'abc', exp: now + 1000 }), // the old sheet-based session
    JSON.stringify({ v: 2, token: '', exp: now + 1000 }),
    JSON.stringify({ v: 2, token: 't', exp: 'later' }),
    JSON.stringify({ v: 2, token: 't', exp: now + SESSION_MS + 1 }), // edited, or clock set back
  ]) {
    assert.equal(readSession(raw, now), null, String(raw));
  }
});

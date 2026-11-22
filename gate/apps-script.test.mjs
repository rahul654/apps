import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadAppsScript } from './gas-runtime.mjs';

const HOUR = 3_600_000;
const login = (gs, password) => gs.post({ action: 'login', password });
const check = (gs, token) => gs.post({ action: 'check', token });

test('GET says whether the password is set', () => {
  assert.deepEqual(loadAppsScript({ password: 'secret-pass' }).get(), { ok: true, service: 'apps-gate', configured: true, mimeType: 'application/json' });
  assert.equal(loadAppsScript().get().configured, false);
});

test('right password gives a 1-hour token that checks out', () => {
  const clock = { now: 1_700_000_000_000 };
  const gs = loadAppsScript({ password: 'secret-pass', clock });
  const res = login(gs, 'secret-pass');
  assert.equal(res.ok, true);
  assert.equal(res.ttl, HOUR);
  assert.match(res.token, /^\d+\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{43}$/);
  assert.ok(!res.token.includes('secret-pass'));
  assert.deepEqual(check(gs, res.token), { ok: true, ttl: HOUR, mimeType: 'application/json' });
  clock.now += HOUR - 1000;
  assert.equal(check(gs, res.token).ttl, 1000);
});

test('wrong, empty and missing passwords are refused', () => {
  const gs = loadAppsScript({ password: 'secret-pass' });
  for (const pw of ['secret-pas', 'Secret-pass', 'secret-pass ', '', undefined]) {
    assert.deepEqual(gs.post({ action: 'login', password: pw }), { ok: false, error: 'wrong', mimeType: 'application/json' }, String(pw));
  }
});

test('no PASSWORD property → not-configured, and checks fail', () => {
  const gs = loadAppsScript();
  assert.equal(login(gs, 'anything').error, 'not-configured');
  assert.equal(check(gs, '1.2.3').error, 'invalid');
});

test('the token ends after an hour', () => {
  const clock = { now: 1_700_000_000_000 };
  const gs = loadAppsScript({ password: 'secret-pass', clock });
  const { token } = login(gs, 'secret-pass');
  clock.now += HOUR;
  assert.equal(check(gs, token).error, 'expired');
});

test('an edited or made-up token is invalid', () => {
  const gs = loadAppsScript({ password: 'secret-pass' });
  const { token } = login(gs, 'secret-pass');
  const [exp, version, sig] = token.split('.');
  for (const bad of [
    `${Number(exp) + HOUR}.${version}.${sig}`, // longer expiry
    `${exp}.${version}.${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`, // one character changed
    `${exp}.${version}`,
    '',
    'not a token',
  ]) {
    assert.equal(check(gs, bad).error, 'invalid', bad);
  }
  // A token signed by another deployment (different secret) is invalid too.
  const other = loadAppsScript({ password: 'secret-pass' });
  assert.equal(check(other, token).error, 'invalid');
});

test('changing PASSWORD ends existing tokens and the new one works', () => {
  const gs = loadAppsScript({ password: 'old-password' });
  const { token } = login(gs, 'old-password');
  gs.props.set('PASSWORD', 'new-password');
  assert.equal(check(gs, token).error, 'changed');
  assert.equal(login(gs, 'old-password').error, 'wrong');
  assert.equal(check(gs, login(gs, 'new-password').token).ok, true);
});

test('the signing secret is made once and kept', () => {
  const gs = loadAppsScript({ password: 'secret-pass' });
  assert.equal(gs.props.get('SIGNING_SECRET'), undefined);
  const first = login(gs, 'secret-pass').token;
  const secret = gs.props.get('SIGNING_SECRET');
  assert.ok(secret.length >= 96);
  login(gs, 'secret-pass');
  assert.equal(gs.props.get('SIGNING_SECRET'), secret);
  assert.equal(check(gs, first).ok, true);
});

test('after 30 wrong passwords every login waits 10 minutes', () => {
  const clock = { now: 1_700_000_000_000 };
  const gs = loadAppsScript({ password: 'secret-pass', clock });
  for (let i = 0; i < 30; i++) assert.equal(login(gs, `guess-${i}`).error, 'wrong');
  assert.equal(login(gs, 'guess-x').error, 'too-many');
  assert.equal(login(gs, 'secret-pass').error, 'too-many');
  clock.now += 600_000;
  assert.equal(login(gs, 'secret-pass').ok, true);
});

test('a right password resets the wrong-password count', () => {
  const gs = loadAppsScript({ password: 'secret-pass' });
  for (let i = 0; i < 29; i++) login(gs, 'nope');
  assert.equal(login(gs, 'secret-pass').ok, true);
  for (let i = 0; i < 29; i++) assert.equal(login(gs, 'nope').error, 'wrong');
});

test('ping and bad requests', () => {
  const gs = loadAppsScript({ password: 'secret-pass' });
  assert.equal(gs.post({ action: 'ping' }).ok, true);
  for (const body of ['not json', 'null', '"text"', '{}', '{"action":"delete"}']) {
    assert.equal(gs.post(body).error, 'bad-request', body);
  }
});

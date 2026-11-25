/**
 * Password check for https://rahul654.github.io/apps/ (see "Password" in README.md).
 *
 * Paste this whole file into a Google Apps Script project and deploy it as a web app
 * (Execute as: Me, Who has access: Anyone). Set the password in
 * Project Settings → Script properties → PASSWORD. Changing it there works at once and logs
 * everyone out; no new deployment is needed. Editing THIS CODE does need one
 * (Deploy → Manage deployments → edit → Version: New version).
 *
 * Requests are POSTs with a JSON text body (text/plain, so browsers send them without a CORS
 * preflight, which Apps Script can't answer):
 *   {"action":"login","password":"…"} → {"ok":true,"token":"…","ttl":43200000}
 *                                       {"ok":false,"error":"wrong"|"too-many"|"not-configured"}
 *   {"action":"check","token":"…"}    → {"ok":true,"ttl":<ms left>}
 *                                       {"ok":false,"error":"expired"|"changed"|"invalid"}
 *   {"action":"ping"}                 → {"ok":true} (wakes the script up while the user types)
 * Opening the /exec URL in a browser (GET) shows whether PASSWORD is set.
 *
 * Token = "<expiry ms>.<password version>.<signature>". The signature is an HMAC with a random
 * secret this script makes on first use and keeps in Script properties (SIGNING_SECRET), so a
 * token can't be made or edited without it. The password version is derived from the password,
 * so changing PASSWORD ends every token. The password itself is never sent back.
 */

var SESSION_MS = 12 * 60 * 60 * 1000; // 12 hours; the lock screen text says "12 hours" too
var MAX_FAILS = 30; // wrong passwords allowed in a row…
var FAIL_WINDOW_S = 600; // …within 10 minutes of each other; then every login waits

function doGet() {
  return json_({ ok: true, service: 'apps-gate', configured: Boolean(password_()) });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '');
  } catch (err) {
    return json_({ ok: false, error: 'bad-request' });
  }
  if (!req || typeof req !== 'object') return json_({ ok: false, error: 'bad-request' });
  if (req.action === 'ping') return json_({ ok: true });
  if (req.action === 'login') return json_(login_(String(req.password || '')));
  if (req.action === 'check') return json_(check_(String(req.token || '')));
  return json_({ ok: false, error: 'bad-request' });
}

function login_(password) {
  var expected = password_();
  if (!expected) return { ok: false, error: 'not-configured' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var cache = CacheService.getScriptCache();
    var fails = Number(cache.get('gate:fails') || 0);
    if (fails >= MAX_FAILS) return { ok: false, error: 'too-many' };
    if (!sameText_(password, expected)) {
      cache.put('gate:fails', String(fails + 1), FAIL_WINDOW_S);
      return { ok: false, error: 'wrong' };
    }
    cache.remove('gate:fails');
    var secret = secret_(true);
    var exp = Date.now() + SESSION_MS;
    var body = exp + '.' + version_(secret, expected);
    return { ok: true, token: body + '.' + sign_(secret, body), ttl: SESSION_MS };
  } finally {
    lock.releaseLock();
  }
}

function check_(token) {
  var expected = password_();
  var secret = secret_(false);
  var parts = token.split('.');
  if (!expected || !secret || parts.length !== 3) return { ok: false, error: 'invalid' };
  var body = parts[0] + '.' + parts[1];
  if (!sameText_(parts[2], sign_(secret, body))) return { ok: false, error: 'invalid' };
  if (!sameText_(parts[1], version_(secret, expected))) return { ok: false, error: 'changed' };
  var left = Number(parts[0]) - Date.now();
  if (!(left > 0)) return { ok: false, error: 'expired' };
  return { ok: true, ttl: Math.min(left, SESSION_MS) };
}

function password_() {
  return PropertiesService.getScriptProperties().getProperty('PASSWORD') || '';
}

/** The signing secret; made on first login (callers hold the script lock when create is true). */
function secret_(create) {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('SIGNING_SECRET');
  if (!secret && create) {
    secret = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('SIGNING_SECRET', secret);
  }
  return secret || '';
}

function sign_(secret, text) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(text, secret)).replace(/=+$/, '');
}

function version_(secret, password) {
  return sign_(secret, 'password:' + password).slice(0, 16);
}

/** Compares without stopping at the first difference. */
function sameText_(a, b) {
  a = String(a);
  b = String(b);
  var diff = a.length ^ b.length;
  for (var i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

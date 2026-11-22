/**
 * Backend for https://rahul654.github.io/apps/files/ (see "Files" in README.md).
 *
 * Paste this whole file into a Google Apps Script project and deploy it as a web app
 * (Execute as: Me, Who has access: Anyone). It runs as YOU, so it can write to your Drive while
 * the people using the page never sign in to Google.
 *
 * Script properties (Project Settings → Script properties):
 *   UPLOAD_PASSWORD  required. The password for uploading and deleting. Changing it works at once
 *                    and signs every device out; no new deployment is needed.
 *   LIMIT_MB         optional, default 1024. Total size allowed in the folder.
 *   FOLDER_ID        optional. Made by the script on first use (folder "files-app-uploads" in My
 *                    Drive, shared "anyone with the link can view"). Set it yourself to use
 *                    another folder.
 *   SIGNING_SECRET   made by the script; signs the 1-hour login tokens. Don't share it.
 * Editing THIS CODE needs Deploy → Manage deployments → edit → Version: New version.
 *
 * Requests are POSTs with a JSON text body (text/plain, so browsers send them without a CORS
 * preflight, which Apps Script can't answer). Every reply has "ok"; failures have "error".
 *   Anyone:
 *     {"action":"list"}                      → {"ok":true,"items":[…],"used":n,"limit":n}
 *     {"action":"text","id":"…"}             → {"ok":true,"text":"…"} (full text of a text item)
 *     {"action":"login","password":"…"}      → {"ok":true,"token":"…","ttl":3600000}
 *     {"action":"check","token":"…"}         → {"ok":true,"ttl":<ms left>}
 *     {"action":"ping"}                      → {"ok":true}
 *   With "token" (else "expired" | "changed" | "invalid"):
 *     {"action":"start","name","size","type"} → {"ok":true,"uploadId","chunkBytes"} | {"ok":true,"done":true,"item"}
 *     {"action":"chunk","uploadId","offset","data":<base64>} → {"ok":true,"received":n} | {"ok":true,"done":true,"item"}
 *     {"action":"status","uploadId"}         → same as chunk, without sending bytes (to resume)
 *     {"action":"cancel","uploadId"}         → {"ok":true}
 *     {"action":"addText","text":"…"}        → {"ok":true,"item"}
 *     {"action":"delete","ids":[…]}          → {"ok":true,"deleted":[…],"missing":[…],"refused":[…]}
 *
 * Uploads: "start" opens a Drive resumable upload and keeps its URL in Script properties (the
 * browser never gets it). Each "chunk" is a slice of the file, a multiple of 256 KiB except the
 * last, passed on to Drive. The file appears in the folder only when the last chunk arrives.
 * The size limit counts the files in the folder plus uploads still in progress, checked under a
 * lock, so two uploads at once can't both get past it.
 *
 * Delete is permanent (no Drive Trash), and only for files directly inside the folder.
 */

var SESSION_MS = 60 * 60 * 1000; // 1 hour; the page says "1 hour" too
var MAX_FAILS = 30; // wrong passwords allowed…
var FAIL_WINDOW_S = 600; // …within 10 minutes; then every login waits
var DEFAULT_LIMIT_MB = 1024;
var CHUNK_BYTES = 8 * 1024 * 1024; // largest chunk accepted (32 × 256 KiB)
var CHUNK_UNIT = 256 * 1024; // Drive needs every chunk but the last to be a multiple of this
var UPLOAD_TTL_MS = 24 * 60 * 60 * 1000; // an unfinished upload holds its space this long
var MAX_TEXT_CHARS = 200000;
var PREVIEW_CHARS = 300;
var MAX_DELETE = 200;
var FOLDER_NAME = 'files-app-uploads';
var API = 'https://www.googleapis.com/drive/v3';
var UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
var FILE_FIELDS = 'id,name,mimeType,size,createdTime,appProperties,description';
var FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Run this once from the editor (Run ▶ setup): it asks for Drive permission and makes the folder. */
function setup() {
  var id = folderId_(true);
  Logger.log('Folder: https://drive.google.com/drive/folders/' + id);
  Logger.log(password_() ? 'UPLOAD_PASSWORD is set.' : 'Add UPLOAD_PASSWORD in Project Settings → Script properties.');
  Logger.log('Files in it: ' + listFiles_(id).length);
}

function doGet() {
  return json_({ ok: true, service: 'files', configured: Boolean(password_()) });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '');
  } catch (err) {
    return json_({ ok: false, error: 'bad-request' });
  }
  if (!req || typeof req !== 'object') return json_({ ok: false, error: 'bad-request' });
  try {
    return json_(route_(req));
  } catch (err) {
    return json_({ ok: false, error: 'server', detail: String((err && err.message) || err).slice(0, 300) });
  }
}

function route_(req) {
  switch (req.action) {
    case 'ping':
      return { ok: true };
    case 'list':
      return list_();
    case 'text':
      return readText_(String(req.id || ''));
    case 'login':
      return login_(String(req.password || ''));
    case 'check':
      return check_(String(req.token || ''));
  }
  var auth = check_(String(req.token || ''));
  if (!auth.ok) return auth;
  switch (req.action) {
    case 'start':
      return start_(req);
    case 'chunk':
      return chunk_(String(req.uploadId || ''), req.offset, req.data);
    case 'status':
      return status_(String(req.uploadId || ''));
    case 'cancel':
      return cancel_(String(req.uploadId || ''));
    case 'addText':
      return addText_(req.text);
    case 'delete':
      return delete_(req.ids);
  }
  return { ok: false, error: 'bad-request' };
}

// ---------------------------------------------------------------- password and tokens
// Same scheme as gate/apps-script.gs. Token = "<expiry ms>.<password version>.<HMAC>".

function login_(password) {
  var expected = password_();
  if (!expected) return { ok: false, error: 'not-configured' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var cache = CacheService.getScriptCache();
    var fails = Number(cache.get('files:fails') || 0);
    if (fails >= MAX_FAILS) return { ok: false, error: 'too-many' };
    if (!sameText_(password, expected)) {
      cache.put('files:fails', String(fails + 1), FAIL_WINDOW_S);
      return { ok: false, error: 'wrong' };
    }
    cache.remove('files:fails');
    var secret = secret_(true);
    var body = Date.now() + SESSION_MS + '.' + version_(secret, expected);
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
  return PropertiesService.getScriptProperties().getProperty('UPLOAD_PASSWORD') || '';
}

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

function sameText_(a, b) {
  a = String(a);
  b = String(b);
  var diff = a.length ^ b.length;
  for (var i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

// ---------------------------------------------------------------- folder, list, text

/** The uploads folder's id; made (and shared "anyone with the link can view") when create is true. */
function folderId_(create) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('FOLDER_ID');
  if (id || !create) return id || '';
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    id = props.getProperty('FOLDER_ID');
    if (!id) {
      var folder = DriveApp.createFolder(FOLDER_NAME);
      folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      id = folder.getId();
      props.setProperty('FOLDER_ID', id);
    }
    return id;
  } finally {
    lock.releaseLock();
  }
}

function limit_() {
  var mb = Number(PropertiesService.getScriptProperties().getProperty('LIMIT_MB'));
  return (mb > 0 ? mb : DEFAULT_LIMIT_MB) * 1024 * 1024;
}

function listFiles_(folder) {
  var files = [];
  var pageToken = '';
  do {
    var url =
      API +
      '/files?q=' +
      encodeURIComponent("'" + folder + "' in parents and trashed = false") +
      '&fields=' +
      encodeURIComponent('nextPageToken,files(' + FILE_FIELDS + ')') +
      '&orderBy=' +
      encodeURIComponent('createdTime desc') +
      '&pageSize=1000' +
      (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    var res = drive_('get', url);
    if (res.code !== 200) throw new Error('Drive list failed (' + res.code + '): ' + res.text.slice(0, 200));
    var body = JSON.parse(res.text);
    files = files.concat(body.files || []);
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return files.filter(function (f) {
    return f.mimeType !== FOLDER_MIME;
  });
}

function item_(f) {
  var isText = Boolean(f.appProperties && f.appProperties.kind === 'text');
  var item = { id: f.id, name: f.name, mimeType: f.mimeType || '', size: Number(f.size || 0), created: f.createdTime || '', kind: isText ? 'text' : 'file' };
  if (isText) item.preview = f.description || '';
  return item;
}

function sumSize_(files) {
  var used = 0;
  for (var i = 0; i < files.length; i++) used += Number(files[i].size || 0);
  return used;
}

function list_() {
  var folder = folderId_(false);
  if (!folder) return { ok: true, items: [], used: 0, limit: limit_() };
  var files = listFiles_(folder);
  return { ok: true, items: files.map(item_), used: sumSize_(files), limit: limit_() };
}

/** Metadata of a file directly inside the folder, or null. */
function ownFile_(id, folder) {
  if (!id || !/^[\w-]+$/.test(id)) return null;
  var res = drive_('get', API + '/files/' + id + '?fields=' + encodeURIComponent('id,parents,trashed,' + FILE_FIELDS));
  if (res.code === 404) return null;
  if (res.code !== 200) throw new Error('Drive get failed (' + res.code + '): ' + res.text.slice(0, 200));
  var f = JSON.parse(res.text);
  if (f.trashed || !f.parents || f.parents.indexOf(folder) < 0) return null;
  return f;
}

function readText_(id) {
  var folder = folderId_(false);
  var f = folder && ownFile_(id, folder);
  if (!f || item_(f).kind !== 'text') return { ok: false, error: 'not-found' };
  var res = drive_('get', API + '/files/' + id + '?alt=media');
  if (res.code !== 200) throw new Error('Drive download failed (' + res.code + ')');
  return { ok: true, text: res.text };
}

// ---------------------------------------------------------------- uploads

function uploadKey_(id) {
  return 'upload:' + id;
}

function getUpload_(id) {
  if (!/^[\w-]{8,64}$/.test(id)) return null;
  var raw = PropertiesService.getScriptProperties().getProperty(uploadKey_(id));
  if (!raw) return null;
  var up = JSON.parse(raw);
  return up.exp > Date.now() ? up : null;
}

/** Bytes held by unfinished uploads; drops the expired ones. Call under the script lock. */
function pendingBytes_() {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var total = 0;
  for (var key in all) {
    if (key.indexOf('upload:') !== 0) continue;
    var up = JSON.parse(all[key]);
    if (up.exp > Date.now()) total += up.size;
    else props.deleteProperty(key);
  }
  return total;
}

function pendingNames_() {
  var all = PropertiesService.getScriptProperties().getProperties();
  var names = [];
  for (var key in all) if (key.indexOf('upload:') === 0) names.push(JSON.parse(all[key]).name);
  return names;
}

function cleanName_(name, fallback) {
  var clean = String(name || '')
    .replace(/[\u0000-\u001f\u007f/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return clean || fallback;
}

/** "a.jpg" → "a (2).jpg" when the name is taken (case-insensitive). */
function uniqueName_(name, taken) {
  var lower = {};
  for (var i = 0; i < taken.length; i++) lower[String(taken[i]).toLowerCase()] = true;
  if (!lower[name.toLowerCase()]) return name;
  var dot = name.lastIndexOf('.');
  var base = dot > 0 ? name.slice(0, dot) : name;
  var ext = dot > 0 ? name.slice(dot) : '';
  for (var n = 2; ; n++) {
    var next = base + ' (' + n + ')' + ext;
    if (!lower[next.toLowerCase()]) return next;
  }
}

/** Checks the space and returns the folder's files; null plus a reply when it doesn't fit. Call under the lock. */
function room_(folder, size) {
  var files = listFiles_(folder);
  var used = sumSize_(files) + pendingBytes_();
  var limit = limit_();
  if (used + size > limit) return { full: { ok: false, error: 'full', used: used, limit: limit, size: size } };
  return { files: files };
}

function start_(req) {
  var size = req.size;
  if (typeof size !== 'number' || !(size >= 0) || Math.floor(size) !== size) return { ok: false, error: 'bad-request' };
  var type = String(req.type || '').slice(0, 200) || 'application/octet-stream';
  var folder = folderId_(true);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var room = room_(folder, size);
    if (room.full) return room.full;
    var taken = room.files.map(function (f) {
      return f.name;
    });
    var name = uniqueName_(cleanName_(req.name, 'file'), taken.concat(pendingNames_()));
    if (size === 0) return { ok: true, done: true, item: item_(createFile_({ name: name, parents: [folder], mimeType: type }, '', type)) };

    var res = drive_('post', UPLOAD_API + '/files?uploadType=resumable&fields=' + encodeURIComponent(FILE_FIELDS), {
      json: { name: name, parents: [folder], mimeType: type },
      headers: { 'X-Upload-Content-Type': type, 'X-Upload-Content-Length': String(size) },
    });
    var url = header_(res.headers, 'location');
    if (res.code !== 200 || !url) return { ok: false, error: 'drive', status: res.code, detail: res.text.slice(0, 300) };
    var id = Utilities.getUuid().replace(/-/g, '');
    PropertiesService.getScriptProperties().setProperty(uploadKey_(id), JSON.stringify({ url: url, size: size, name: name, type: type, exp: Date.now() + UPLOAD_TTL_MS }));
    return { ok: true, uploadId: id, name: name, chunkBytes: CHUNK_BYTES };
  } finally {
    lock.releaseLock();
  }
}

function chunk_(id, offset, data) {
  var up = getUpload_(id);
  if (!up) return { ok: false, error: 'upload-gone' };
  offset = Number(offset);
  var bytes = Utilities.base64Decode(String(data || ''));
  var len = bytes.length;
  if (!len || !(offset >= 0) || Math.floor(offset) !== offset || offset + len > up.size || len > CHUNK_BYTES) return { ok: false, error: 'bad-request' };
  if (offset + len < up.size && len % CHUNK_UNIT) return { ok: false, error: 'bad-request' };
  var res = drive_('put', up.url, {
    payload: Utilities.newBlob(bytes, up.type),
    contentType: up.type,
    headers: { 'Content-Range': 'bytes ' + offset + '-' + (offset + len - 1) + '/' + up.size },
  });
  return progress_(id, up, res);
}

function status_(id) {
  var up = getUpload_(id);
  if (!up) return { ok: false, error: 'upload-gone' };
  var res = drive_('put', up.url, { payload: '', headers: { 'Content-Range': 'bytes */' + up.size } });
  return progress_(id, up, res);
}

function cancel_(id) {
  var up = getUpload_(id);
  PropertiesService.getScriptProperties().deleteProperty(uploadKey_(id));
  if (up) drive_('delete', up.url); // Drive answers 499; nothing to check
  return { ok: true };
}

/** Turns Drive's answer to a chunk (or status query) into a reply. */
function progress_(id, up, res) {
  if (res.code === 200 || res.code === 201) {
    PropertiesService.getScriptProperties().deleteProperty(uploadKey_(id));
    var f = JSON.parse(res.text);
    share_(f.id);
    return { ok: true, done: true, received: up.size, item: item_(f) };
  }
  if (res.code === 308) {
    var range = header_(res.headers, 'range'); // "bytes=0-1234"
    var m = /-(\d+)$/.exec(range || '');
    return { ok: true, done: false, received: m ? Number(m[1]) + 1 : 0 };
  }
  if (res.code === 404 || res.code === 410) {
    PropertiesService.getScriptProperties().deleteProperty(uploadKey_(id));
    return { ok: false, error: 'upload-gone' };
  }
  return { ok: false, error: 'drive', status: res.code, detail: res.text.slice(0, 300) };
}

/** Lets anyone with the link view the file, in case the folder's sharing doesn't reach it. */
function share_(fileId) {
  drive_('post', API + '/files/' + fileId + '/permissions', { json: { type: 'anyone', role: 'reader' } });
}

// ---------------------------------------------------------------- text items

function textName_(text) {
  var first = String(text).split('\n')[0].trim();
  var name = cleanName_(first.slice(0, 40), 'Text');
  return /\.txt$/i.test(name) ? name : name + '.txt';
}

function addText_(text) {
  text = typeof text === 'string' ? text : '';
  if (!text.trim()) return { ok: false, error: 'bad-request' };
  if (text.length > MAX_TEXT_CHARS) return { ok: false, error: 'too-long', max: MAX_TEXT_CHARS };
  var size = Utilities.newBlob(text).getBytes().length;
  var folder = folderId_(true);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var room = room_(folder, size);
    if (room.full) return room.full;
    var taken = room.files.map(function (f) {
      return f.name;
    });
    var meta = {
      name: uniqueName_(textName_(text), taken.concat(pendingNames_())),
      parents: [folder],
      mimeType: 'text/plain',
      appProperties: { kind: 'text' },
      description: text.slice(0, PREVIEW_CHARS),
    };
    return { ok: true, item: item_(createFile_(meta, text, 'text/plain; charset=UTF-8')) };
  } finally {
    lock.releaseLock();
  }
}

/** One-request upload (metadata + content) for small files. */
function createFile_(meta, content, type) {
  var boundary = 'files-app-' + Utilities.getUuid();
  var body =
    '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) + '\r\n' +
    '--' + boundary + '\r\nContent-Type: ' + type + '\r\n\r\n' + content + '\r\n' +
    '--' + boundary + '--';
  var contentType = 'multipart/related; boundary=' + boundary;
  var res = drive_('post', UPLOAD_API + '/files?uploadType=multipart&fields=' + encodeURIComponent(FILE_FIELDS), {
    payload: Utilities.newBlob(body, contentType).getBytes(),
    contentType: contentType,
  });
  if (res.code !== 200) throw new Error('Drive create failed (' + res.code + '): ' + res.text.slice(0, 200));
  var f = JSON.parse(res.text);
  share_(f.id);
  return f;
}

// ---------------------------------------------------------------- delete

function delete_(ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_DELETE) return { ok: false, error: 'bad-request' };
  var folder = folderId_(false);
  var out = { ok: true, deleted: [], missing: [], refused: [] };
  for (var i = 0; i < ids.length; i++) {
    var id = String(ids[i]);
    if (!folder || !/^[\w-]+$/.test(id)) {
      out.refused.push(id);
      continue;
    }
    var meta = drive_('get', API + '/files/' + id + '?fields=' + encodeURIComponent('id,parents'));
    if (meta.code === 404) {
      out.missing.push(id);
      continue;
    }
    var parents = meta.code === 200 ? JSON.parse(meta.text).parents || [] : [];
    if (parents.indexOf(folder) < 0) {
      out.refused.push(id); // not ours: never touch anything outside the folder
      continue;
    }
    var res = drive_('delete', API + '/files/' + id); // permanent: skips Drive Trash
    if (res.code === 204 || res.code === 200) out.deleted.push(id);
    else if (res.code === 404) out.missing.push(id);
    else out.refused.push(id);
  }
  return out;
}

// ---------------------------------------------------------------- helpers

/** Calls the Drive REST API as the script's owner. Never throws for HTTP errors. */
function drive_(method, url, opts) {
  opts = opts || {};
  var headers = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
  for (var k in opts.headers || {}) headers[k] = opts.headers[k];
  var params = { method: method, headers: headers, muteHttpExceptions: true, followRedirects: false };
  if (opts.json !== undefined) {
    params.contentType = 'application/json; charset=UTF-8';
    params.payload = JSON.stringify(opts.json);
  } else if (opts.payload !== undefined) {
    params.payload = opts.payload;
    if (opts.contentType) params.contentType = opts.contentType;
  }
  var res = UrlFetchApp.fetch(url, params);
  return { code: res.getResponseCode(), headers: res.getAllHeaders(), text: res.getContentText('UTF-8') };
}

function header_(headers, name) {
  for (var k in headers) if (k.toLowerCase() === name) return String(headers[k]);
  return '';
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

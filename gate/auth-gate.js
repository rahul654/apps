// Password gate for every page of the site. scripts/build-site.mjs adds it to each built
// index.html (see gate/inject.mjs) and renames the page's own <script type="module"> tags to
// type="text/x-gated-module", so the app doesn't run until this script starts it.
//
// The password is checked by the Apps Script at GATE_URL (gate/apps-script.gs). It keeps casual
// visitors out; it is not access control: GitHub Pages serves every file to anyone who asks.
import { callGate, GateError, MESSAGES, OLD_SESSION_KEYS, readSession, SESSION_KEY, sessionFrom } from './core.js';
import { GATE_URL } from './config.js';

const root = document.documentElement;
const CHECK_EVERY_MS = 15_000;

const storage = {
  available: (() => {
    try {
      localStorage.setItem(`${SESSION_KEY}:probe`, '1');
      localStorage.removeItem(`${SESSION_KEY}:probe`);
      return true;
    } catch {
      return false;
    }
  })(),
  get() {
    try {
      return localStorage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
  },
  set(session) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      /* private mode: the session lasts as long as this page */
    }
  },
  remove() {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  },
};

let session = null; // the session this page is open with
let appsStarted = false;

// ---------------------------------------------------------------- open / lock

function startApps() {
  if (appsStarted) return;
  appsStarted = true;
  for (const old of document.querySelectorAll('script[type="text/x-gated-module"]')) {
    const s = document.createElement('script');
    for (const { name, value } of old.attributes) if (name !== 'type') s.setAttribute(name, value);
    s.type = 'module';
    if (!old.hasAttribute('src')) s.textContent = old.textContent;
    old.replaceWith(s);
  }
}

function open(s) {
  session = s;
  root.dataset.gate = 'open';
  document.body.inert = false;
  overlay.hide();
  startApps();
}

function lock(message) {
  session = null;
  root.dataset.gate = 'locked';
  document.body.inert = true;
  overlay.show(message);
  callGate(GATE_URL, { action: 'ping' }).catch(() => {}); // wake the script while the user types
}

/** Locks the page when its session has ended (expired, removed, or replaced in another tab). */
function recheck() {
  const now = Date.now();
  if (!session) {
    // Another tab may have unlocked meanwhile.
    const stored = readSession(storage.get(), now);
    if (stored) open(stored);
    return;
  }
  if (!storage.available) {
    if (session.exp <= now) lock(MESSAGES.expired);
    return;
  }
  const stored = readSession(storage.get(), now);
  if (!stored) lock(MESSAGES.expired);
  else session = stored; // possibly a newer login from another tab
}

/** Asks the script whether this page's token is still good (signature, password, expiry). */
async function verify() {
  const checked = session;
  let reply;
  try {
    reply = await callGate(GATE_URL, { action: 'check', token: checked.token });
  } catch {
    return; // offline or the script is unreachable: an unexpired session keeps working
  }
  if (reply.ok || session !== checked) return;
  if (readSession(storage.get(), Date.now())?.token === checked.token) storage.remove();
  lock(MESSAGES[reply.error] ?? MESSAGES.invalid);
}

/** @returns {Promise<boolean>} false for a wrong password; throws GateError for other problems */
async function unlock(password) {
  const reply = await callGate(GATE_URL, { action: 'login', password });
  if (!reply.ok) {
    if (reply.error === 'wrong') return false;
    throw new GateError(reply.error);
  }
  const fresh = sessionFrom(reply.token, reply.ttl, Date.now());
  if (!fresh) throw new GateError('bad-request');
  storage.set(fresh);
  open(fresh);
  return true;
}

// ---------------------------------------------------------------- lock screen

const overlay = (() => {
  const host = document.createElement('apps-gate');
  host.setAttribute('style', 'all: initial; position: fixed; inset: 0; z-index: 2147483647; display: none;');
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { color-scheme: light dark; }
      .wrap {
        --bg: #f6f7f9; --card: #ffffff; --text: #16181d; --muted: #5b6270; --border: #d9dde3;
        --accent: #1d6fd6; --accent-text: #ffffff; --error: #b42318;
        position: fixed; inset: 0; display: grid; place-items: center; padding: 16px; box-sizing: border-box;
        background: var(--bg); color: var(--text); overflow: auto;
        font: 16px/1.45 system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
      }
      @media (prefers-color-scheme: dark) {
        .wrap { --bg: #0f1115; --card: #181b21; --text: #e8eaee; --muted: #9aa1ad; --border: #2c313a;
                --accent: #4c94ef; --accent-text: #0b0d10; --error: #ff8a80; }
      }
      form { width: min(360px, 100%); box-sizing: border-box; padding: 28px 24px 24px; background: var(--card);
             border: 1px solid var(--border); border-radius: 14px; box-shadow: 0 10px 30px rgb(0 0 0 / 0.08); }
      .icon { font-size: 28px; line-height: 1; margin-bottom: 12px; }
      h1 { margin: 0 0 4px; font-size: 1.25rem; font-weight: 650; }
      p { margin: 0; color: var(--muted); font-size: 0.92rem; }
      label { display: block; margin: 20px 0 6px; font-weight: 550; font-size: 0.9rem; }
      input { width: 100%; box-sizing: border-box; padding: 10px 12px; font: inherit; color: var(--text);
              background: transparent; border: 1px solid var(--border); border-radius: 9px; }
      input:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      button { width: 100%; margin-top: 14px; padding: 10px 12px; font: inherit; font-weight: 600; cursor: pointer;
               color: var(--accent-text); background: var(--accent); border: 0; border-radius: 9px; }
      button:disabled { opacity: 0.6; cursor: progress; }
      .error { min-height: 1.3em; margin-top: 10px; color: var(--error); font-size: 0.88rem; }
      .note { margin-top: 6px; font-size: 0.82rem; }
    </style>
    <div class="wrap">
      <form novalidate>
        <div class="icon" aria-hidden="true">🔒</div>
        <h1>Apps are locked</h1>
        <p class="lead">Enter the password to continue.</p>
        <input type="text" name="username" autocomplete="username" value="apps" hidden />
        <label for="gate-password">Password</label>
        <input id="gate-password" name="password" type="password" autocomplete="current-password" required />
        <button type="submit">Unlock</button>
        <div class="error" role="alert" aria-live="assertive"></div>
        <p class="note">You’ll stay unlocked on this browser for 1 hour.</p>
      </form>
    </div>`;

  const form = shadow.querySelector('form');
  const input = shadow.querySelector('#gate-password');
  const button = shadow.querySelector('button');
  const error = shadow.querySelector('.error');
  const lead = shadow.querySelector('.lead');

  // Keys and clipboard events typed here must not reach the app's own shortcuts underneath.
  for (const type of ['keydown', 'keyup', 'keypress', 'paste', 'copy', 'cut', 'beforeinput', 'input']) {
    host.addEventListener(type, (e) => e.stopPropagation());
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (button.disabled) return;
    const password = input.value;
    if (!password) {
      error.textContent = 'Enter the password.';
      input.focus();
      return;
    }
    button.disabled = true;
    button.textContent = 'Checking…';
    error.textContent = '';
    try {
      if (await unlock(password)) {
        input.value = '';
        return;
      }
      error.textContent = MESSAGES.wrong;
      input.select();
    } catch (err) {
      error.textContent = err instanceof GateError ? err.message : MESSAGES['bad-request'];
    } finally {
      button.disabled = false;
      button.textContent = 'Unlock';
    }
    input.focus();
  });

  return {
    show(message) {
      if (!host.isConnected) root.appendChild(host);
      host.style.display = 'block';
      lead.textContent = message || 'Enter the password to continue.';
      error.textContent = GATE_URL ? '' : MESSAGES['no-url'];
      input.focus();
    },
    hide() {
      host.style.display = 'none';
      input.value = '';
    },
  };
})();

// ---------------------------------------------------------------- start

for (const key of OLD_SESSION_KEYS) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

const saved = readSession(storage.get(), Date.now());
if (saved) {
  open(saved);
  verify();
} else {
  storage.remove();
  lock();
}

setInterval(recheck, CHECK_EVERY_MS);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && recheck());
window.addEventListener('storage', (e) => e.key === SESSION_KEY && recheck());
window.addEventListener('pageshow', (e) => e.persisted && recheck()); // back/forward cache

import { useState } from 'react';
import { IconWarn } from '../components/Icons';
import { CopyButton, ProxyControl, useStartCommand } from '../components/ProxyControl';
import { allowedByDefault, appBaseUrl, appFileUrl, guessOs, openStartLink, parsePort, portFromUrl, proxyUrlForPort, type CommandOs } from '../lib/proxy/control';
import { useAppStore } from '../store/AppStore';

const OS_LABEL: Record<CommandOs, string> = { unix: 'macOS / Linux', windows: 'Windows (PowerShell)' };

export default function ProxyPage() {
  const { state, dispatch } = useAppStore();
  const prefs = state.prefs;
  const savedPort = portFromUrl(prefs.proxyUrl);
  const [portText, setPortText] = useState(String(savedPort));
  const typedPort = parsePort(portText);
  const port = typedPort ?? savedPort;
  const [os, setOs] = useState<CommandOs>(guessOs);
  const command = useStartCommand(port, os);
  const origin = typeof location === 'undefined' ? 'http://localhost' : location.origin;
  const launcherSetup = `curl -fsSL ${appFileUrl('install-launcher.sh')} | APICLIENT_URL=${appBaseUrl()} bash -s -- --port ${port}`;

  // The field is the single source of the port: the command shows it immediately, and the app
  // connects to it as soon as it's a valid port.
  const changePort = (text: string) => {
    setPortText(text);
    const p = parsePort(text);
    if (p && p !== savedPort) dispatch({ type: 'prefs/set', prefs: { ...prefs, proxyUrl: proxyUrlForPort(p) } });
  };

  return (
    <div className="page">
      <div className="page-inner proxy-page">
        <div className="page-head">
          <div className="stack-sm">
            <h1>Local proxy</h1>
            <p className="muted small">
              A web page can only call APIs that allow cross-origin requests (CORS), can’t set headers like Cookie, Host, User-Agent or Origin, and never sees Set-Cookie. The proxy is a
              small Node script on your machine that sends requests for the app, the way Postman’s desktop agent does.
            </p>
          </div>
        </div>

        <section className="card proxy-steps">
          <h2>Start the proxy</h2>
          <ol className="steps">
            <li>
              <label className="field port-field">
                <span>Port</span>
                <input
                  className="input mono"
                  inputMode="numeric"
                  value={portText}
                  onChange={(e) => changePort(e.target.value.replace(/[^\d]/g, ''))}
                  onBlur={() => typedPort === null && setPortText(String(savedPort))}
                  aria-invalid={typedPort === null}
                  aria-describedby="port-help"
                />
              </label>
              <p id="port-help" className="small muted">
                {typedPort === null ? 'Use a port between 1024 and 65535.' : `The app connects to http://localhost:${port}. Any free port works; 4399 is the default.`}
              </p>
            </li>
            <li>
              <div className="row">
                <span className="field-label">Copy this command</span>
                <div className="segmented" role="group" aria-label="Operating system">
                  {(Object.keys(OS_LABEL) as CommandOs[]).map((o) => (
                    <button key={o} type="button" aria-pressed={os === o} onClick={() => setOs(o)}>
                      {OS_LABEL[o]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="command-box">
                <code className="mono">{command}</code>
                <CopyButton text={command} className="btn primary small" />
              </div>
            </li>
            <li>
              <p className="small">
                Paste it in a terminal and press Enter. It downloads the latest proxy and starts it on port {port}. Keep the window open while you use the app. Needs{' '}
                <a href="https://nodejs.org" target="_blank" rel="noreferrer">
                  Node.js 18+
                </a>
                ; nothing else is installed.
              </p>
            </li>
            <li>
              <p className="small">The status below turns green within two seconds and requests switch to the proxy automatically.</p>
            </li>
          </ol>
          <ul className="small muted bullets">
            <li>Running the command again restarts the proxy: a proxy already on that port is stopped first.</li>
            <li>If another program uses the port, the proxy says so and exits; pick another port here and copy the command again.</li>
            <li>Stop it with the Stop button below, or Ctrl+C in its terminal.</li>
          </ul>
          {!allowedByDefault(origin) && (
            <p className="note warn">
              <IconWarn size={16} />
              <span>
                This page is served from <code>{origin}</code>, so the command includes <code>--allow {origin}</code>.
              </span>
            </p>
          )}
        </section>

        <section className="card">
          <h2>Status</h2>
          <ProxyControl />
          <div className="segmented" role="group" aria-label="Send mode">
            <button type="button" aria-pressed={prefs.mode === 'direct'} onClick={() => dispatch({ type: 'prefs/set', prefs: { ...prefs, mode: 'direct' } })}>
              Direct (browser fetch)
            </button>
            <button type="button" aria-pressed={prefs.mode === 'proxy'} onClick={() => dispatch({ type: 'prefs/set', prefs: { ...prefs, mode: 'proxy' } })}>
              Through the proxy
            </button>
          </div>
          <p className="small muted">
            The mode applies to every send, including the runner and <code>pm.sendRequest</code>. The top bar shows a “proxy” badge while proxy mode is on.
          </p>
        </section>

        <section className="card">
          <h2>What the proxy does</h2>
          <ul className="bullets">
            <li>Forwards the method, URL, every header you set (including forbidden ones) and the body, byte for byte.</li>
            <li>
              Follows redirects (up to 10), decompresses gzip/deflate/br so you see the text, and returns every response header plus <code>Set-Cookie</code> as a list.
            </li>
            <li>Measures DNS, TCP connect, TLS, time-to-first-byte and download separately.</li>
            <li>Listens on 127.0.0.1 only and answers only this app’s site (origin allowlist), so other websites and other machines can’t use it. It stores nothing.</li>
            <li>
              Accepts self-signed certificates (<code>rejectUnauthorized: false</code>), so use it for development servers you trust.
            </li>
          </ul>
        </section>

        <details className="card details">
          <summary>Optional: a Start button instead of a terminal (Linux)</summary>
          <p className="small">
            A web page can’t run programs, but after a one-time setup the browser can hand an <code>apiclient-proxy://</code> link to your desktop, which starts the proxy in the
            background. Setup (once, in a terminal):
          </p>
          <div className="command-box">
            <code className="mono">{launcherSetup}</code>
            <CopyButton text={launcherSetup} />
          </div>
          <div className="row">
            <button type="button" className="btn" onClick={openStartLink}>
              Start via launcher
            </button>
            <span className="small muted">
              The first time, the browser asks to open <code>xdg-open</code>: tick “Always allow”. The launcher uses the port chosen at setup. Remove it with{' '}
              <code>bash install-launcher.sh --uninstall</code>.
            </span>
          </div>
        </details>
      </div>
    </div>
  );
}

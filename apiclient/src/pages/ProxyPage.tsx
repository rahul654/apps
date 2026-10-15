import { useEffect, useState } from 'react';
import { IconCheck, IconWarn } from '../components/Icons';
import { pingProxy, type ProxyStatus } from '../lib/request/send';
import { useAppStore } from '../store/AppStore';

export default function ProxyPage() {
  const { state, dispatch } = useAppStore();
  const prefs = state.prefs;
  const [status, setStatus] = useState<ProxyStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [url, setUrl] = useState(prefs.proxyUrl);
  const check = async (u = url) => {
    setChecking(true);
    setStatus(await pingProxy(u));
    setChecking(false);
  };
  useEffect(() => {
    void check(prefs.proxyUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const origin = typeof location !== 'undefined' ? location.origin : 'http://localhost';
  const isAllowedByDefault = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) || origin === 'https://rahul654.github.io';
  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div className="stack-sm">
            <h1>Local proxy</h1>
            <p className="muted small">A web page can only call APIs that allow cross-origin requests, cannot set headers like Cookie, Host, User-Agent or Origin, and never sees Set-Cookie. The proxy is a small Node script running on your machine that sends the request for you and returns everything, including a timing breakdown.</p>
          </div>
        </div>
        <div className="grid-2">
          <section className="card">
            <h2>1. Run it</h2>
            <a className="btn primary self-start" href="./apiclient-proxy.mjs" download="apiclient-proxy.mjs">Download apiclient-proxy.mjs</a>
            <p className="small">Then, in a terminal (Node 18+; no npm install needed):</p>
            <pre className="codeview">node apiclient-proxy.mjs</pre>
            <p className="small muted">Options: <code>--port 4399</code>, <code>--allow http://localhost:*,https://rahul654.github.io</code>, <code>--quiet</code>. It listens on 127.0.0.1 only and refuses requests from other origins.</p>
            {!isAllowedByDefault && (
              <div className="note warn">
                <IconWarn size={16} />
                <span>This page is served from <code>{origin}</code>, which is not in the default allowlist. Start the proxy with <code>--allow {origin}</code>.</span>
              </div>
            )}
          </section>
          <section className="card">
            <h2>2. Connect</h2>
            <label className="field">
              <span>Proxy URL</span>
              <input className="input mono" value={url} onChange={(e) => setUrl(e.target.value)} />
            </label>
            <div className="row">
              <button type="button" className="btn" onClick={() => { dispatch({ type: 'prefs/set', prefs: { ...prefs, proxyUrl: url } }); void check(url); }} disabled={checking}>
                {checking ? 'Checking…' : 'Save & check'}
              </button>
              {status && (status.ok ? <span className="pill ok"><IconCheck size={12} /> connected (v{status.version})</span> : <span className="pill err">not reachable</span>)}
            </div>
            {status && !status.ok && <p className="small muted">{status.message}. Is the script running? Is the port right?</p>}
            <div className="segmented" role="group" aria-label="Send mode">
              <button type="button" aria-pressed={prefs.mode === 'direct'} onClick={() => dispatch({ type: 'prefs/set', prefs: { ...prefs, mode: 'direct' } })}>Direct (browser fetch)</button>
              <button type="button" aria-pressed={prefs.mode === 'proxy'} onClick={() => dispatch({ type: 'prefs/set', prefs: { ...prefs, mode: 'proxy' } })}>Through the proxy</button>
            </div>
            <p className="small muted">The mode applies to every send, including the runner and <code>pm.sendRequest</code>. The top bar shows a “proxy” badge while proxy mode is on.</p>
          </section>
        </div>
        <section className="card">
          <h2>What the proxy does</h2>
          <ul className="bullets">
            <li>Forwards the method, URL, every header you set (including forbidden ones) and the body, byte for byte.</li>
            <li>Follows redirects (up to 10), decompresses gzip/deflate/br so you see the text, and returns every response header plus <code>Set-Cookie</code> as a list.</li>
            <li>Measures DNS, TCP connect, TLS, time-to-first-byte and download separately.</li>
            <li>Does not store anything and does not accept connections from other machines or other websites (origin allowlist + CORS).</li>
            <li>Accepts self-signed certificates (<code>rejectUnauthorized: false</code>), so use it for development servers you trust.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}

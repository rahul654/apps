import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { IconAlert, IconCode, IconGlobe, IconInfo, IconShield, IconTrash } from '../components/Icons';
import { useRemoveSandbox } from '../components/Layout';
import { SUGGESTIONS } from '../components/SandboxView';
import { PresetPicker } from '../components/SettingsPanel';
import { createSandbox } from '../lib/defaults';
import { PRESETS, presetOf, supportsCredentialless } from '../lib/policy';
import { normalizeUrl } from '../lib/url';
import { useSandboxes } from '../store/SandboxStore';
import type { SandboxToken } from '../types';

function relativeTime(ts: number, now = Date.now()): string {
  const s = Math.round((now - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function HomePage() {
  const { sandboxes, dispatch } = useSandboxes();
  const navigate = useNavigate();
  const remove = useRemoveSandbox();
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [tokens, setTokens] = useState<SandboxToken[]>([...PRESETS.standard.tokens]);
  const clSupported = supportsCredentialless();
  const [fresh, setFresh] = useState(true);

  const openUrl = (text: string) => {
    const r = normalizeUrl(text);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const sb = createSandbox('web', { url: r.url, tokens, credentialless: fresh });
    dispatch({ type: 'create', sandbox: sb });
    navigate(`/s/${sb.id}`);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    openUrl(address);
  };
  const newPlayground = () => {
    const sb = createSandbox('html');
    dispatch({ type: 'create', sandbox: sb });
    navigate(`/s/${sb.id}`);
  };

  return (
    <div className="home">
      <div className="home-inner">
        <section className="hero card">
          <h1>Open a website in a sandbox</h1>
          <p className="muted">
            Each sandbox is an isolated frame. The page can’t read this app, navigate it away or use your camera, mic or location unless you allow it.
          </p>
          <form className="hero-form" onSubmit={submit} noValidate>
            <label className="sr-only" htmlFor="home-url">
              Web address
            </label>
            <input
              id="home-url"
              className="input big"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                setError('');
              }}
              placeholder="example.com"
              autoFocus
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              inputMode="url"
              enterKeyHint="go"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'home-url-error' : undefined}
            />
            <button type="submit" className="btn primary big">
              Open in sandbox
            </button>
          </form>
          {error && (
            <p id="home-url-error" className="field-error" role="alert">
              <IconAlert size={15} /> {error}
            </p>
          )}
          <div className="hero-options">
            <PresetPicker tokens={tokens} onChange={setTokens} />
            <label className="check">
              <input type="checkbox" checked={fresh && clSupported} disabled={!clSupported} onChange={(e) => setFresh(e.target.checked)} />
              <span>
                Fresh session
                <span className="block muted tiny">
                  {clSupported ? 'Don’t send cookies from your browser; give the page temporary storage.' : 'Needs Chrome or Edge 110+. Other browsers may send cookies you already have for the site.'}
                </span>
              </span>
            </label>
          </div>
          <div className="row try-row">
            <span className="muted small">Try:</span>
            {SUGGESTIONS.map((s) => (
              <button key={s.url} type="button" className="chip" onClick={() => openUrl(s.url)}>
                {s.label}
              </button>
            ))}
            <span className="spacer" />
            <button type="button" className="btn small" onClick={newPlayground}>
              <IconCode size={15} /> New HTML playground
            </button>
          </div>
        </section>

        {sandboxes.length > 0 && (
          <section className="stack-sm">
            <div className="row">
              <h2>Your sandboxes</h2>
              <span className="spacer" />
              <span className="muted tiny">Saved in this browser only</span>
            </div>
            <ul className="sandbox-list">
              {sandboxes.map((sb) => {
                const preset = presetOf(sb.tokens);
                return (
                  <li key={sb.id} className="sandbox-item card">
                    <span className="item-icon" aria-hidden="true">
                      {sb.kind === 'html' ? <IconCode /> : <IconGlobe />}
                    </span>
                    <Link to={`/s/${sb.id}`} className="item-main">
                      <strong className="item-name">{sb.name}</strong>
                      <span className="muted small item-sub">{sb.kind === 'html' ? 'HTML playground' : sb.url || 'No address yet'}</span>
                    </Link>
                    <span className="pill">{preset === 'custom' ? 'Custom' : PRESETS[preset].label}</span>
                    <span className="muted tiny item-time">{relativeTime(sb.updatedAt)}</span>
                    <button type="button" className="btn ghost icon small" onClick={() => remove(sb.id)} aria-label={`Close ${sb.name}`} title="Close sandbox">
                      <IconTrash size={16} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="facts">
          <div className="card">
            <h2>
              <IconShield size={18} /> What the sandbox does
            </h2>
            <ul className="bullets">
              <li>Runs the page in a separate origin. It can’t read this app’s pages, storage or other sandboxes.</li>
              <li>Blocks it from navigating this tab away, and popups inherit the same limits.</li>
              <li>Camera, mic, location, clipboard and other device access are off unless you tick them.</li>
              <li>Fresh session (Chrome, Edge) keeps your real cookies out, so you see the site logged out.</li>
              <li>Preview phone, tablet and desktop sizes side by side in separate tabs.</li>
            </ul>
          </div>
          <div className="card">
            <h2>
              <IconInfo size={18} /> Limits
            </h2>
            <ul className="bullets">
              <li>
                Sites like Google, GitHub and most banks forbid being framed. Their frame stays blank; open them in a normal tab instead. Embed links (YouTube, maps, published docs) work.
              </li>
              <li>This is browser isolation, not a virtual machine. It doesn’t protect against browser exploits or downloads you choose to open.</li>
              <li>Sandboxes and HTML code are saved in this browser’s storage. Nothing is sent to a server.</li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}

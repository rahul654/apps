import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { appendEntry, parseBridgeMessage, withBridge, type ConsoleEntry } from '../lib/consoleBridge';
import { newId, STARTER_HTML } from '../lib/defaults';
import { embedAdvice } from '../lib/embed';
import { allowAttr, effectiveTokens, PRESETS, presetOf, supportsCredentialless } from '../lib/policy';
import { normalizeUrl } from '../lib/url';
import { useSandboxes } from '../store/SandboxStore';
import type { Sandbox, Viewport } from '../types';
import { ConsolePanel } from './ConsolePanel';
import { IconAlert, IconClose, IconExternal, IconInfo, IconPlay, IconReload, IconShield, IconSliders } from './Icons';
import { SandboxFrame } from './SandboxFrame';
import { SettingsPanel } from './SettingsPanel';
import { Stage, ViewportControls } from './Stage';

export const SUGGESTIONS = [
  { label: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Sandbox_(computer_security)' },
  { label: 'example.com', url: 'https://example.com/' },
  { label: 'OpenStreetMap', url: 'https://www.openstreetmap.org/export/embed.html?bbox=72.77,18.89,72.99,19.12&layer=mapnik' },
  { label: 'YouTube video', url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' },
];

function useFramePolicy(sb: Sandbox) {
  const eff = effectiveTokens(sb, window.location.origin);
  const allow = allowAttr(sb.features);
  const credentialless = sb.kind === 'web' && sb.credentialless && supportsCredentialless();
  const preset = presetOf(sb.tokens);
  const summary = [preset === 'custom' ? 'Custom' : PRESETS[preset].label, credentialless ? 'fresh session' : ''].filter(Boolean).join(' · ');
  return { tokens: eff.tokens.join(' '), dropped: eff.dropped, allow, credentialless, summary, scripts: eff.tokens.includes('allow-scripts') };
}

export function SandboxView({ sb, active }: { sb: Sandbox; active: boolean }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const toggleSettings = () => setSettingsOpen((o) => !o);
  return (
    <section className="sandbox" hidden={!active} aria-label={sb.name}>
      {sb.kind === 'web' ? (
        <WebSandbox sb={sb} active={active} settingsOpen={settingsOpen} toggleSettings={toggleSettings} />
      ) : (
        <HtmlSandbox sb={sb} settingsOpen={settingsOpen} toggleSettings={toggleSettings} />
      )}
    </section>
  );
}

interface ViewProps {
  sb: Sandbox;
  settingsOpen: boolean;
  toggleSettings: () => void;
}

function PolicyButton({ summary, open, onClick }: { summary: string; open: boolean; onClick: () => void }) {
  return (
    <button type="button" className="btn small policy-btn" onClick={onClick} aria-pressed={open} aria-label={`Sandbox settings (${summary})`} title="Sandbox settings">
      <IconSliders size={16} />
      <span className="policy-text">{summary}</span>
    </button>
  );
}

/* ---------------------------------------------------------------- web ---- */

function WebSandbox({ sb, active, settingsOpen, toggleSettings }: ViewProps & { active: boolean }) {
  const { dispatch } = useSandboxes();
  const update = useCallback((patch: Partial<Sandbox>) => dispatch({ type: 'update', id: sb.id, patch }), [dispatch, sb.id]);
  const policy = useFramePolicy(sb);

  const [address, setAddress] = useState(sb.url);
  const [prevUrl, setPrevUrl] = useState(sb.url);
  if (prevUrl !== sb.url) {
    setPrevUrl(sb.url);
    setAddress(sb.url);
  }
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);

  // A new key gives a brand-new iframe: sandbox flags only apply on creation/navigation, and
  // replacing the frame (rather than changing src) keeps the browser's back button for the app.
  const frameKey = [sb.url, policy.tokens, policy.allow, sb.referrer, policy.credentialless, nonce].join('|');
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loading = Boolean(sb.url) && loadedKey !== frameKey;
  const [slowKey, setSlowKey] = useState<string | null>(null);
  useEffect(() => {
    if (!loading) return;
    const t = window.setTimeout(() => setSlowKey(frameKey), 12000);
    return () => window.clearTimeout(t);
  }, [loading, frameKey]);

  const advice = useMemo(() => (sb.url ? embedAdvice(sb.url, window.location.protocol) : null), [sb.url]);
  const [dismissedUrl, setDismissedUrl] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (active && !sb.url) inputRef.current?.focus();
  }, [active, sb.url]);

  const open = (text: string) => {
    const r = normalizeUrl(text);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError('');
    setHelpOpen(false);
    if (r.url === sb.url) setNonce((n) => n + 1);
    else update({ url: r.url });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    open(address);
  };

  const showAdvice = advice && dismissedUrl !== sb.url && (advice.blocked || advice.mixedContent);

  return (
    <>
      <div className="toolbar">
        <button type="button" className="btn small icon" onClick={() => setNonce((n) => n + 1)} disabled={!sb.url} aria-label="Reload" title="Reload (goes back to the address shown)">
          <IconReload size={16} />
        </button>
        <form className="address" onSubmit={submit} role="search">
          <span className="address-icon" title="Sandboxed" aria-hidden="true">
            <IconShield size={15} />
          </span>
          <input
            ref={inputRef}
            className="address-input"
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              if (error) setError('');
            }}
            onFocus={(e) => e.currentTarget.select()}
            placeholder="Type a web address, e.g. wikipedia.org"
            aria-label="Web address"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `err-${sb.id}` : undefined}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            inputMode="url"
            enterKeyHint="go"
          />
          <button type="submit" className="btn small primary">
            Open
          </button>
        </form>
        <ViewportControls viewport={sb.viewport} onChange={(viewport: Viewport) => update({ viewport })} />
        <a
          className="btn small icon"
          href={sb.url || undefined}
          target="_blank"
          rel="noopener noreferrer"
          aria-disabled={!sb.url}
          onClick={(e) => !sb.url && e.preventDefault()}
          aria-label="Open in a new browser tab (not sandboxed)"
          title="Open in a new browser tab (not sandboxed)"
        >
          <IconExternal size={16} />
        </a>
        <PolicyButton summary={policy.summary} open={settingsOpen} onClick={toggleSettings} />
      </div>
      {error && (
        <p id={`err-${sb.id}`} className="bar warn" role="alert">
          <IconAlert size={15} /> {error}
        </p>
      )}

      <div className={settingsOpen ? 'sandbox-body with-settings' : 'sandbox-body'}>
        <div className="viewer">
          {showAdvice && (
            <div className="bar warn" role="note">
              <IconAlert size={15} />
              <span className="grow">
                {advice.mixedContent
                  ? 'Browsers block http:// pages inside an https:// page. Try the https:// address if the site has one.'
                  : 'This site usually refuses to be shown inside other pages, so the frame will likely stay blank or say it “refused to connect”.'}
              </span>
              {advice.suggestion && (
                <button type="button" className="btn small" onClick={() => open(advice.suggestion!.url)}>
                  {advice.suggestion.label}
                </button>
              )}
              <button type="button" className="btn ghost icon small" onClick={() => setDismissedUrl(sb.url)} aria-label="Dismiss">
                <IconClose size={14} />
              </button>
            </div>
          )}
          {policy.dropped.map((d) => (
            <p key={d.token} className="bar warn small">
              <IconAlert size={15} /> {d.reason}
            </p>
          ))}

          {sb.url ? (
            <Stage
              viewport={sb.viewport}
              overlay={
                loading && (
                  <div className="stage-status" role="status">
                    <span className="spinner" aria-hidden="true" />
                    {slowKey === frameKey ? 'Still loading… the site may be slow or blocking the frame.' : 'Loading…'}
                  </div>
                )
              }
            >
              <SandboxFrame
                key={frameKey}
                src={sb.url}
                title={`Sandboxed page: ${sb.name}`}
                sandbox={policy.tokens}
                allow={policy.allow}
                referrerPolicy={sb.referrer}
                credentialless={policy.credentialless}
                onLoad={() => setLoadedKey(frameKey)}
              />
            </Stage>
          ) : (
            <div className="empty">
              <IconShield size={40} className="empty-icon" />
              <h2>Open a website in this sandbox</h2>
              <p className="muted">Type an address above, or try one of these.</p>
              <div className="chips">
                {SUGGESTIONS.map((s) => (
                  <button key={s.url} type="button" className="chip" onClick={() => open(s.url)}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {sb.url && (
            <div className="viewer-foot">
              <button type="button" className="linkish small" onClick={() => setHelpOpen(!helpOpen)} aria-expanded={helpOpen}>
                <IconInfo size={14} /> Page blank or “refused to connect”?
              </button>
              {helpOpen && (
                <div className="help small">
                  <p>
                    The site tells browsers not to show it inside other pages (<code>X-Frame-Options</code> or <code>frame-ancestors</code>). The browser enforces that, so no web
                    app can get around it without a proxy server.
                  </p>
                  <p>
                    What you can do: look for the site’s own embed link (videos, maps and published docs usually have one), or{' '}
                    <a href={sb.url} target="_blank" rel="noopener noreferrer">
                      open it in a new tab
                    </a>{' '}
                    (that tab is a normal browser tab, not sandboxed).
                  </p>
                  <p className="muted">Links you click inside the frame aren’t shown in the address bar; the browser hides cross-site navigation from this app.</p>
                </div>
              )}
            </div>
          )}
        </div>
        {settingsOpen && <SettingsPanel sb={sb} onClose={toggleSettings} />}
      </div>
    </>
  );
}

/* --------------------------------------------------------------- html ---- */

function HtmlSandbox({ sb, settingsOpen, toggleSettings }: ViewProps) {
  const { dispatch } = useSandboxes();
  const update = useCallback((patch: Partial<Sandbox>) => dispatch({ type: 'update', id: sb.id, patch }), [dispatch, sb.id]);
  const policy = useFramePolicy(sb);

  // What is currently running. A fresh channel per run means late messages from an old frame are ignored.
  const [run, setRun] = useState(() => ({ html: sb.html, channel: newId(), n: 0 }));
  const runNow = useCallback(() => setRun((r) => ({ html: sb.html, channel: newId(), n: r.n + 1 })), [sb.html]);
  useEffect(() => {
    if (!sb.autoRun || sb.html === run.html) return;
    const t = window.setTimeout(runNow, 600);
    return () => window.clearTimeout(t);
  }, [sb.autoRun, sb.html, run.html, runNow]);

  const srcDoc = useMemo(() => withBridge(run.html, run.channel), [run]);
  const frameKey = [run.n, run.channel, policy.tokens, policy.allow].join('|');
  const frameRef = useRef<HTMLIFrameElement>(null);

  const [log, setLog] = useState<ConsoleEntry[]>([]);
  const nextId = useRef(0);
  const [loggedKey, setLoggedKey] = useState(frameKey);
  if (loggedKey !== frameKey) {
    setLoggedKey(frameKey);
    setLog([]);
  }
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!frameRef.current || e.source !== frameRef.current.contentWindow) return;
      const msg = parseBridgeMessage(e.data, run.channel);
      if (msg) setLog((l) => appendEntry(l, msg, ++nextId.current));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [run.channel]);

  const stale = sb.html !== run.html;
  const escaped = useRef(false);
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const afterEscape = escaped.current;
    escaped.current = e.key === 'Escape';
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      runNow();
    } else if (e.key === 'Tab' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      // Indent instead of leaving the editor; Esc then Tab still moves focus (no keyboard trap).
      if (afterEscape) return;
      e.preventDefault();
      const el = e.currentTarget;
      el.setRangeText('  ', el.selectionStart, el.selectionEnd, 'end');
      update({ html: el.value });
    }
  };

  return (
    <>
      <div className="toolbar">
        <button type="button" className="btn small primary" onClick={runNow} title="Run (Ctrl+Enter)">
          <IconPlay size={14} /> Run
        </button>
        <label className="check inline small">
          <input type="checkbox" checked={sb.autoRun} onChange={(e) => update({ autoRun: e.target.checked })} />
          <span>Run as I type</span>
        </label>
        {stale && !sb.autoRun && <span className="pill">Edited, not run</span>}
        <span className="spacer" />
        <ViewportControls viewport={sb.viewport} onChange={(viewport: Viewport) => update({ viewport })} />
        <PolicyButton summary={policy.summary} open={settingsOpen} onClick={toggleSettings} />
      </div>

      <div className={settingsOpen ? 'sandbox-body with-settings' : 'sandbox-body'}>
        <div className="playground">
          <div className="editor-pane">
            <div className="pane-head">
              <label htmlFor={`code-${sb.id}`} className="field-label">
                HTML, CSS and JavaScript
              </label>
              <span className="spacer" />
              <button
                type="button"
                className="btn ghost small"
                onClick={() => {
                  if (sb.html === STARTER_HTML || window.confirm('Replace your code with the starter page?')) update({ html: STARTER_HTML });
                }}
              >
                Reset
              </button>
            </div>
            <textarea
              id={`code-${sb.id}`}
              className="code mono"
              value={sb.html}
              onChange={(e) => update({ html: e.target.value })}
              onKeyDown={onKeyDown}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              aria-describedby={`code-hint-${sb.id}`}
            />
            <p id={`code-hint-${sb.id}`} className="muted tiny pane-foot">
              <kbd>Ctrl</kbd>+<kbd>Enter</kbd> runs · <kbd>Tab</kbd> indents (press <kbd>Esc</kbd> first to move focus) · saved in this browser
            </p>
          </div>
          <div className="preview-pane">
            {policy.dropped.map((d) => (
              <p key={d.token} className="bar info small">
                <IconInfo size={15} /> {d.reason}
              </p>
            ))}
            <Stage viewport={sb.viewport}>
              <SandboxFrame frameRef={frameRef} key={frameKey} srcDoc={srcDoc} title={`Sandboxed preview: ${sb.name}`} sandbox={policy.tokens} allow={policy.allow} />
            </Stage>
            <ConsolePanel entries={log} onClear={() => setLog([])} scriptsOff={!policy.scripts} />
          </div>
        </div>
        {settingsOpen && <SettingsPanel sb={sb} onClose={toggleSettings} />}
      </div>
    </>
  );
}

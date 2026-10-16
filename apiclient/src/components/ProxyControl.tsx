import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { allowedByDefault, appFileUrl, guessOs, portFromUrl, proxyCommand, stopProxy, waitForProxy } from '../lib/proxy/control';
import { pingProxy } from '../lib/request/send';
import { useAppStore } from '../store/AppStore';
import { IconCheck, IconCopy, IconStop, IconWarn } from './Icons';

type Phase = 'checking' | 'running' | 'stopped' | 'stopping' | 'stop-failed';

const POLL_MS = 2000;

/** The one-line start command for the saved port, for this OS and origin. */
export function useStartCommand(port: number, os = guessOs()): string {
  const origin = typeof location === 'undefined' ? 'http://localhost' : location.origin;
  return proxyCommand({ os, port, scriptUrl: appFileUrl('apiclient-proxy.mjs'), allow: allowedByDefault(origin) ? undefined : origin });
}

export function CopyButton({ text, label = 'Copy', className = 'btn small' }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false));
      }}
    >
      {copied ? <IconCheck size={14} /> : <IconCopy size={14} />} {copied ? 'Copied' : label}
    </button>
  );
}

/**
 * Live proxy status with Stop. While the proxy is down it keeps checking, so running the start
 * command in a terminal is picked up without a click: when it comes up, sends switch to proxy
 * mode; stopping it here switches them back to direct.
 */
export function ProxyControl({ compact = false }: { compact?: boolean }) {
  const { state, dispatch } = useAppStore();
  const prefs = state.prefs;
  const port = portFromUrl(prefs.proxyUrl);
  const command = useStartCommand(port);
  const [phase, setPhase] = useState<Phase>('checking');
  const [version, setVersion] = useState<string | undefined>();
  const prefsRef = useRef(prefs);
  useEffect(() => {
    prefsRef.current = prefs;
  });

  const setMode = (mode: 'direct' | 'proxy') => {
    if (prefsRef.current.mode !== mode) dispatch({ type: 'prefs/set', prefs: { ...prefsRef.current, mode } });
  };

  // Check now, then keep watching (one request to localhost every 2 s), so a proxy started or
  // stopped in a terminal shows up here without a click.
  const seenDown = useRef(false);
  useEffect(() => {
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    seenDown.current = false;
    setPhase('checking');
    const tick = async () => {
      const s = await pingProxy(prefs.proxyUrl, ctrl.signal);
      if (ctrl.signal.aborted) return;
      if (s.ok) {
        setVersion(s.version);
        setPhase((p) => (p === 'stopping' || p === 'stop-failed' ? p : 'running'));
        if (seenDown.current) {
          seenDown.current = false;
          setMode('proxy'); // it just came up: the user started it to use it
        }
      } else {
        seenDown.current = true;
        setPhase((p) => (p === 'stopping' ? p : 'stopped'));
      }
      timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
    // setMode only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.proxyUrl]);

  const stop = () => {
    setPhase('stopping');
    void (async () => {
      await stopProxy(prefs.proxyUrl);
      const down = await waitForProxy(prefs.proxyUrl, 'down', 5000);
      setPhase(down ? 'stopped' : 'stop-failed');
      if (down) setMode('direct');
    })();
  };

  const running = phase === 'running' || phase === 'stopping' || phase === 'stop-failed';

  return (
    <div className={compact ? 'proxy-control compact' : 'proxy-control'}>
      <div className="row">
        <span role="status" aria-live="polite">
          {phase === 'checking' && <span className="pill muted">checking port {port}…</span>}
          {running && (
            <span className="pill ok">
              <IconCheck size={12} /> running on port {port}
              {version ? ` (v${version})` : ''}
              {prefs.mode === 'proxy' ? ' · in use' : ''}
            </span>
          )}
          {phase === 'stopped' && <span className="pill muted">not running on port {port}</span>}
        </span>
        {running && (
          <button type="button" className="btn small" onClick={stop} disabled={phase === 'stopping'}>
            <IconStop size={12} /> {phase === 'stopping' ? 'Stopping…' : 'Stop proxy'}
          </button>
        )}
        {running && prefs.mode !== 'proxy' && (
          <button type="button" className="btn small primary" onClick={() => setMode('proxy')}>
            Use the proxy
          </button>
        )}
        {phase === 'stopped' && compact && <CopyButton text={command} label="Copy start command" className="btn small primary" />}
      </div>
      {phase === 'stopped' && compact && (
        <p className="small">
          Paste it in a terminal (Node 18+) and keep it open; this switches to the proxy as soon as it’s up. Details and other ports on the <Link to="/proxy">Proxy page</Link>.
        </p>
      )}
      {phase === 'stop-failed' && (
        <p className="note warn">
          <IconWarn size={16} />
          <span>The proxy is still answering. If it’s an older version, stop it with Ctrl+C in its terminal.</span>
        </p>
      )}
    </div>
  );
}

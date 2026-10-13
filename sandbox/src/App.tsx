import { useEffect, useRef, useState } from 'react';
import { Link, matchPath, Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Layout } from './components/Layout';
import { SandboxView } from './components/SandboxView';
import { createSandbox } from './lib/defaults';
import { normalizeUrl } from './lib/url';
import { HomePage } from './pages/HomePage';
import { useSandboxes } from './store/SandboxStore';

/** `#/open?url=…` creates a web sandbox for that address, so sandboxes can be bookmarked or linked. */
function OpenFromLink() {
  const [params] = useSearchParams();
  const { dispatch } = useSandboxes();
  const navigate = useNavigate();
  const target = params.get('url') ?? '';
  const parsed = normalizeUrl(target);
  // Refs survive StrictMode's effect re-run, so one link creates exactly one sandbox.
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!parsed.ok || handled.current === parsed.url) return;
    handled.current = parsed.url;
    const sb = createSandbox('web', { url: parsed.url });
    dispatch({ type: 'create', sandbox: sb });
    navigate(`/s/${sb.id}`, { replace: true });
  }, [parsed, dispatch, navigate]);
  if (parsed.ok) return null;
  return (
    <div className="home">
      <div className="home-inner">
        <div className="card stack-sm">
          <h1>Can’t open that link</h1>
          <p className="muted">{target ? parsed.error : 'The link has no address in it.'}</p>
          <Link to="/" className="btn primary self-start">
            Go to Sandbox
          </Link>
        </div>
      </div>
    </div>
  );
}

function MissingSandbox() {
  return (
    <div className="home">
      <div className="home-inner">
        <div className="card stack-sm">
          <h1>That sandbox doesn’t exist</h1>
          <p className="muted">It may have been closed here or in another tab.</p>
          <Link to="/" className="btn primary self-start">
            All sandboxes
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { pathname } = useLocation();
  const { sandboxes, get } = useSandboxes();
  const activeId = matchPath('/s/:id', pathname)?.params.id ?? null;
  const active = activeId ? get(activeId) : undefined;

  // Frames are mounted the first time a sandbox is opened and then kept alive while hidden,
  // so switching tabs doesn't reload pages or lose what you were doing in them.
  const [mounted, setMounted] = useState<ReadonlySet<string>>(() => new Set(activeId ? [activeId] : []));
  if (active && !mounted.has(active.id)) setMounted(new Set([...mounted, active.id]));

  useEffect(() => {
    document.title = active ? `${active.name} · Sandbox` : 'Sandbox';
  }, [active]);

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/open" element={<OpenFromLink />} />
        <Route path="/s/:id" element={active ? null : <MissingSandbox />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {sandboxes
        .filter((sb) => mounted.has(sb.id))
        .map((sb) => (
          <SandboxView key={sb.id} sb={sb} active={sb.id === activeId} />
        ))}
    </Layout>
  );
}

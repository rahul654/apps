import { Link } from 'react-router-dom';
import { usePref } from '../hooks/prefs';
import { findTool, TOOLS, toolPath } from '../tools/registry';

export function Home() {
  const [recent] = usePref<string[]>('recent', [], Array.isArray);
  const recentTools = recent.map(findTool).filter((t) => t !== undefined);
  return (
    <div className="home">
      <section className="hero">
        <h1>Dev Tools</h1>
        <p className="muted">Everyday developer utilities. Everything runs locally in your browser — paste tokens and secrets without them leaving your machine.</p>
      </section>
      {recentTools.length > 0 && (
        <section aria-labelledby="recent-h" className="recent">
          <h2 id="recent-h" className="section-title">
            Recently used
          </h2>
          <div className="chips">
            {recentTools.map((t) => (
              <Link key={t.id} to={toolPath(t)} className="chip">
                <span aria-hidden="true" className="chip-icon">
                  {t.icon}
                </span>
                {t.name}
              </Link>
            ))}
          </div>
        </section>
      )}
      <section aria-labelledby="all-h">
        <h2 id="all-h" className="section-title">
          All tools
        </h2>
        <ul className="tool-grid">
          {TOOLS.map((t) => (
            <li key={t.id}>
              <Link to={toolPath(t)} className="tool-card">
                <span className="tool-card-icon" aria-hidden="true">
                  {t.icon}
                </span>
                <span className="tool-card-body">
                  <strong>{t.name}</strong>
                  <span className="muted">{t.description}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

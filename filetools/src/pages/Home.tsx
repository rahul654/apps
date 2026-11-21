import { Link } from 'react-router-dom';
import { TOOL_GROUPS, TOOLS } from '../tools/registry';

export function Home() {
  return (
    <>
      <section className="hero">
        <h1>File Tools</h1>
        <p>
          Everyday tools for images, PDFs and QR codes. Everything runs in your browser — your files are processed on this device and never uploaded anywhere.
        </p>
      </section>
      {TOOL_GROUPS.map((group) => (
        <section key={group} className="tool-group" aria-labelledby={`g-${group}`}>
          <h2 id={`g-${group}`}>{group}</h2>
          <div className="tool-grid">
            {TOOLS.filter((t) => t.group === group).map((t) => (
              <Link key={t.id} to={t.path} className="tool-card">
                <span className="emoji" aria-hidden="true">{t.emoji}</span>
                <span>
                  <h3>
                    {t.title}
                    {t.badge && <span className="badge">{t.badge}</span>}
                  </h3>
                  <p>{t.description}</p>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

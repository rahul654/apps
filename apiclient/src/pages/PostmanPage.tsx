import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CopyButton } from '../components/ProxyControl';
import { downloadsPath, exportCommand, importCommand } from '../lib/postman/commands';
import { appFileUrl, guessOs, type CommandOs } from '../lib/proxy/control';

const OS_LABEL: Record<CommandOs, string> = { unix: 'macOS / Linux', windows: 'Windows (PowerShell)' };
const GUIDES = 'https://github.com/rahul654/apps/blob/main/apiclient/scripts';
const today = () => new Date().toISOString().slice(0, 10);

function Command({ text }: { text: string }) {
  return (
    <div className="command-box">
      <code className="mono">{text}</code>
      <CopyButton text={text} className="btn primary small" />
    </div>
  );
}

export default function PostmanPage() {
  const [os, setOs] = useState<CommandOs>(guessOs);
  const [outFile, setOutFile] = useState(() => downloadsPath(`postman-export-${today()}.zip`, guessOs()));
  // The import file starts as the export's "Save as" path and follows it until edited, so
  // "export, then import that zip" needs no typing.
  const [inputText, setInputText] = useState<string | null>(null);
  const input = inputText ?? outFile;
  const setInput = (v: string) => setInputText(v);
  const [perWorkspace, setPerWorkspace] = useState(true);
  const [workspace, setWorkspace] = useState('Team Workspace');
  const [dryRun, setDryRun] = useState(false);
  const [skipExisting, setSkipExisting] = useState(false);

  // Keep the default paths in the OS's style when switching, unless the user typed their own.
  const switchOs = (next: CommandOs) => {
    const swap = (p: string) => (p.startsWith('~/Downloads/') || p.startsWith('~\\Downloads\\') ? downloadsPath(p.slice('~/Downloads/'.length), next) : p);
    setOutFile(swap);
    setInputText((v) => (v === null ? null : swap(v)));
    setOs(next);
  };

  const exportCmd = exportCommand({ os, scriptUrl: appFileUrl('export-from-postman.mjs'), outFile: outFile.trim() || downloadsPath('postman-export.zip', os) });
  const importCmd = importCommand({
    os,
    scriptUrl: appFileUrl('import-to-postman.mjs'),
    input: input.trim() || outFile.trim() || downloadsPath('postman-export.zip', os),
    workspace: perWorkspace ? null : workspace.trim() || 'Team Workspace',
    dryRun,
    skipExisting,
  });

  return (
    <div className="page">
      <div className="page-inner proxy-page">
        <div className="page-head">
          <div className="stack-sm">
            <h1>Postman export &amp; import</h1>
            <p className="muted small">
              Move collections, environments and globals between Postman and this app. Two small scripts run on your computer and talk to the Postman API with your key. Each command
              downloads the latest script and runs it; the key is asked for when it runs (input hidden), so it never appears in the command or your shell history. Needs{' '}
              <a href="https://nodejs.org" target="_blank" rel="noreferrer">
                Node.js 18+
              </a>
              .
            </p>
          </div>
          <div className="segmented" role="group" aria-label="Operating system">
            {(Object.keys(OS_LABEL) as CommandOs[]).map((o) => (
              <button key={o} type="button" aria-pressed={os === o} onClick={() => switchOs(o)}>
                {OS_LABEL[o]}
              </button>
            ))}
          </div>
        </div>

        <section className="card">
          <h2>1. Create a Postman API key</h2>
          <ol className="steps small">
            <li>
              Open <a href="https://postman.co" target="_blank" rel="noreferrer">postman.co</a>, click your avatar (top right) and check the team under your email.{' '}
              <strong>A key only sees the team you’re in when you create it</strong>; use <em>Switch to ›</em> to change team. The address bar then shows that team’s domain, e.g.{' '}
              <code>acme-jane.postman.co</code>.
            </li>
            <li>
              Go to <code>https://&lt;team-domain&gt;/settings/me/api-keys</code> (your personal keys; “Postman keys” in team settings is a different, Enterprise page).
            </li>
            <li>
              Click <strong>Generate API Key</strong>, name it, and copy it (starts with <code>PMAK-</code>). Paste it when the script asks.
            </li>
            <li>Delete the key on the same page when you’re done.</li>
          </ol>
        </section>

        <section className="card">
          <h2>2. Export from Postman → this app</h2>
          <p className="small">Downloads every collection, environment and globals set the key can see into one zip.</p>
          <label className="field">
            <span>Save as</span>
            <input className="input mono" value={outFile} onChange={(e) => setOutFile(e.target.value)} spellCheck={false} />
          </label>
          <Command text={exportCmd} />
          <p className="small">
            Then open <Link to="/data">Data</Link> → <strong>Import</strong> and pick the zip. Choose a target workspace, or “Create one workspace per Postman workspace”.
          </p>
          <p className="small muted">Values of Postman variables marked <em>secret</em> come back blank from the API; the zip’s <code>manifest.json</code> lists them so you can re-enter them.</p>
        </section>

        <section className="card">
          <h2>3. Import into Postman ← this app</h2>
          <p className="small">
            Uploads straight through the Postman API, so every value arrives exactly as in the file. Postman’s own Import screen empties values its secret scanner flags; this
            doesn’t. First export from <Link to="/data">Data</Link> → <strong>Export all workspaces</strong> (or one workspace).
          </p>
          <label className="field">
            <span>Zip, unzipped folder, or a single Postman file (starts as the export file above)</span>
            <input className="input mono" value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} />
          </label>
          <fieldset className="fieldset">
            <legend className="field-label">Into which Postman workspace</legend>
            <label className="check">
              <input type="radio" name="target" checked={perWorkspace} onChange={() => setPerWorkspace(true)} />
              <span>Same names as in the file (one Postman workspace per workspace; missing ones are created)</span>
            </label>
            <label className="check">
              <input type="radio" name="target" checked={!perWorkspace} onChange={() => setPerWorkspace(false)} />
              <span>Everything into one workspace:</span>
            </label>
            {!perWorkspace && <input className="input" aria-label="Postman workspace name" value={workspace} onChange={(e) => setWorkspace(e.target.value)} />}
          </fieldset>
          <label className="check">
            <input type="checkbox" checked={skipExisting} onChange={(e) => setSkipExisting(e.target.checked)} />
            <span>Leave collections and environments that already exist untouched (default: update same-named ones in place, no duplicates)</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
            <span>Dry run: only show what would change</span>
          </label>
          <Command text={importCmd} />
          <p className="small muted">
            It lists every change (create / update / skip) and asks before writing anything. Postman may still show a “secrets detected” warning afterwards; choose Override, the values
            stay.
          </p>
        </section>

        <p className="small muted">
          Full guides:{' '}
          <a href={`${GUIDES}/EXPORT-FROM-POSTMAN.md`} target="_blank" rel="noreferrer">
            export
          </a>{' '}
          ·{' '}
          <a href={`${GUIDES}/IMPORT-TO-POSTMAN.md`} target="_blank" rel="noreferrer">
            import
          </a>
          . Scripts: <a href="./export-from-postman.mjs" download>export-from-postman.mjs</a>, <a href="./import-to-postman.mjs" download>import-to-postman.mjs</a>.
        </p>
      </div>
    </div>
  );
}

import { useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { demoData } from '../lib/demo';
import { CURRENCIES } from '../lib/money';
import { emptyData, parseData } from '../lib/storage';
import { useApp } from '../store/AppStore';
import { ME } from '../types';

export function SettingsPage() {
  const { data, dispatch, person } = useApp();
  const me = person(ME);
  const [name, setName] = useState(me?.name ?? '');
  const [email, setEmail] = useState(me?.email ?? '');
  const [message, setMessage] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const sizeKb = (new Blob([JSON.stringify(data)]).size / 1024).toFixed(1);

  function saveProfile() {
    dispatch({ type: 'person/update', id: ME, name: name.trim() || 'You', email: email.trim() });
    setMessage('Profile saved.');
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `splitwise-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importData(file: File) {
    const parsed = parseData(await file.text());
    if (!parsed) {
      setMessage("That file isn't a valid Splitwise backup.");
      return;
    }
    if (window.confirm('Replace all current data with this backup?')) {
      dispatch({ type: 'data/replace', data: parsed, message: 'You imported a backup.' });
      setMessage('Backup imported.');
    }
  }

  return (
    <>
      <PageHeader title="Settings" />
      <div className="settings">
        <section className="card">
          <h3>Your profile</h3>
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button type="button" className="btn btn-primary" onClick={saveProfile}>Save profile</button>
        </section>

        <section className="card">
          <h3>Currency</h3>
          <label className="field">
            <span>Shown on all amounts</span>
            <select
              value={data.settings.currency}
              onChange={(e) => dispatch({ type: 'settings/update', settings: { currency: e.target.value } })}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <p className="muted small">Changing currency relabels amounts; it doesn't convert them.</p>
        </section>

        <section className="card">
          <h3>Your data</h3>
          <p className="muted small">
            Everything is stored in this browser's localStorage ({sizeKb} KB). Clearing site data or switching
            browsers loses it, so export a backup now and then.
          </p>
          <div className="button-row">
            <button type="button" className="btn" onClick={exportData}>Export backup (JSON)</button>
            <button type="button" className="btn" onClick={() => fileRef.current?.click()}>Import backup</button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importData(f);
                e.target.value = '';
              }}
            />
          </div>
          <div className="button-row">
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (window.confirm('Replace all current data with demo data?'))
                  dispatch({ type: 'data/replace', data: demoData(data.settings.currency), message: 'You loaded the demo data.' });
              }}
            >
              Load demo data
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                if (window.confirm('Delete all friends, groups and expenses? This cannot be undone.')) {
                  dispatch({ type: 'data/replace', data: emptyData(), message: 'You reset all data.' });
                  setName('You');
                  setEmail('');
                }
              }}
            >
              Reset all data
            </button>
          </div>
        </section>
        {message && <p className="hint" role="status">{message}</p>}
      </div>
    </>
  );
}

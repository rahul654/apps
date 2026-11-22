import { useState } from 'react';
import { ApiError, MESSAGES } from '../lib/api';
import { auth, closeLogin, login } from '../store/auth';
import { useStore } from '../store/createStore';
import { Modal } from './Modal';

/** The upload password dialog. Opened by "Upload", by a write that needs a login, or by an expired login mid-upload. */
export function LoginDialog() {
  const { prompt } = useStore(auth);
  if (!prompt) return null;
  return <LoginForm message={prompt.message} />;
}

function LoginForm({ message }: { message?: string }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!password) {
      setError('Enter the password.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await login(password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : MESSAGES['bad-request']);
      setBusy(false);
    }
  };

  return (
    <Modal title="Upload password" onClose={closeLogin} initialFocus="input[type=password]">
      <form className="login" onSubmit={submit} noValidate>
        <div className="login-icon" aria-hidden="true">
          🔑
        </div>
        <h2>Upload password</h2>
        <p className="muted small">{message || 'Uploading, adding text and deleting need the password. Viewing doesn’t.'}</p>
        <input type="text" name="username" autoComplete="username" value="files" hidden readOnly />
        <label className="field">
          <span>Password</span>
          <input type="password" name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} />
        </label>
        <p className="error small" role="alert">
          {error}
        </p>
        <div className="row end">
          <button type="button" className="btn ghost" onClick={closeLogin}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Checking…' : 'Unlock'}
          </button>
        </div>
        <p className="muted tiny">You stay signed in on this browser for 1 hour.</p>
      </form>
    </Modal>
  );
}

import { Component, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Notice } from './Feedback';

interface State {
  error: Error | null;
}

/** Keeps a crash in one tool (e.g. out of memory on a huge file) from blanking the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    const chunk = /dynamically imported module|Loading chunk|Importing a module script failed/i.test(this.state.error.message);
    return (
      <div className="stack" style={{ maxWidth: 640 }}>
        <Notice kind="error">
          <strong>{chunk ? 'This tool couldn’t be loaded.' : 'Something went wrong.'}</strong>
          <p className="small">
            {chunk ? 'Check your connection (the tool’s code is downloaded the first time you open it) and reload.' : this.state.error.message}
          </p>
        </Notice>
        <div className="row">
          <button type="button" className="btn primary" onClick={() => location.reload()}>
            Reload
          </button>
          <Link to="/" className="btn">
            All tools
          </Link>
        </div>
      </div>
    );
  }
}

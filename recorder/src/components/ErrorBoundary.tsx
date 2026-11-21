import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      const chunk = /dynamically imported module|Loading chunk|Failed to fetch/i.test(this.state.error.message);
      return (
        <div className="notice error" role="alert">
          <div className="notice-body">
            <strong>{chunk ? 'Couldn’t load this page.' : 'Something went wrong.'}</strong>{' '}
            {chunk ? 'The app may have been updated. Reload to get the latest version.' : this.state.error.message}
          </div>
          <div className="notice-actions">
            <button type="button" className="btn small" onClick={() => location.reload()}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

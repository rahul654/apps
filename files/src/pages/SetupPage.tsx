/** Shown while FILES_URL (src/config.ts) is empty: the page has no Apps Script to talk to yet. */
export function SetupPage() {
  return (
    <div className="empty narrow">
      <div className="empty-icon" aria-hidden="true">
        🔌
      </div>
      <h1>Not connected yet</h1>
      <p className="muted">
        This page stores files in a Google Drive folder through a Google Apps Script. Deploy <code>files/apps-script/Code.gs</code> and put its web app URL in{' '}
        <code>files/src/config.ts</code>. The steps are in the repo’s README, under “Files”.
      </p>
    </div>
  );
}

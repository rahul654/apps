import { Link } from 'react-router-dom';

export default function AboutPage() {
  return (
    <div className="page">
      <div className="page-inner">
        <h1>Privacy, limits and compatibility</h1>
        <section className="card">
          <h2>Your data stays in this browser</h2>
          <p className="small">Workspaces with their collections, environments, globals, history and run reports are stored in IndexedDB on this device under the <code>apiclient</code> database; preferences in localStorage. Nothing is uploaded anywhere; there is no account and no backend. Requests go straight from your browser to the API you call (or to the local proxy on your machine). Clearing site data for this origin deletes everything, so <Link to="/data">export all workspaces</Link> now and then. Files picked for form-data or binary bodies are kept in memory only.</p>
        </section>
        <section className="card">
          <h2>Workspaces</h2>
          <p className="small">Each workspace has its own collections, environments, globals, active environment, history and saved runs; every page shows the current one, picked in the top bar. Proxy settings and the theme are shared. <strong>Default</strong> always exists. Unsaved request edits are kept per workspace while you switch (until the tab closes). <Link to="/workspaces">Manage workspaces</Link>.</p>
          <p className="small"><Link to="/data">Export all workspaces</Link> gives one zip: <code>workspaces/&lt;name&gt;/</code> holds only Postman files (collections, environments, <code>globals.postman_globals.json</code>), and <code>_apiclient/&lt;name&gt;/</code> holds history, runs and settings. To move a workspace to Postman, unzip and import <code>workspaces/&lt;name&gt;</code> with <strong>Import → Folders</strong>.</p>
        </section>
        <section className="card">
          <h2>What a web page can’t do (and the proxy can)</h2>
          <ul className="bullets">
            <li><strong>CORS.</strong> The browser only lets the page read a response when the server sends <code>Access-Control-Allow-Origin</code> for this origin. When it fails you get a generic “Failed to fetch”: the browser does not say whether it was CORS, DNS, TLS or a refused connection.</li>
            <li><strong>Forbidden headers.</strong> <code>Cookie</code>, <code>Host</code>, <code>User-Agent</code>, <code>Origin</code>, <code>Referer</code>, <code>Accept-Encoding</code> and a few others are silently dropped by the browser.</li>
            <li><strong>Hidden response headers.</strong> Only CORS-safelisted headers are visible unless the server sends <code>Access-Control-Expose-Headers</code>; <code>Set-Cookie</code> is never visible.</li>
            <li><strong>Timing.</strong> Without <code>Timing-Allow-Origin</code> only the wall-clock total is known. The <Link to="/proxy">local proxy</Link> fixes all of the above and reports DNS / connect / TLS / TTFB / download.</li>
            <li>Direct mode sends with <code>credentials: 'omit'</code>: your browser cookies are never attached to API calls.</li>
          </ul>
        </section>
        <section className="card">
          <h2>Scripts: the supported <code>pm</code> API</h2>
          <p className="small">Scripts run in a sandboxed iframe with an opaque origin (no access to this app, its storage or the page), with chai bundled for <code>pm.expect</code>. They are stored in the Postman <code>event</code> array, so they export and run in Postman unchanged.</p>
          <ul className="bullets small">
            <li><code>pm.environment</code>, <code>pm.globals</code>, <code>pm.collectionVariables</code>, <code>pm.variables</code>: <code>get</code>, <code>set</code>, <code>unset</code>, <code>has</code>, <code>toObject</code>, <code>clear</code>, <code>replaceIn</code>; <code>pm.iterationData.get/has/toObject</code>.</li>
            <li><code>pm.request</code>: <code>method</code>, <code>url</code> (string-like; assignable), <code>headers.add/upsert/remove/get/has</code>, <code>body</code>; changes in pre-request scripts are applied before sending.</li>
            <li><code>pm.response</code>: <code>code</code>, <code>status</code>, <code>headers.get/has</code>, <code>json()</code>, <code>text()</code>, <code>responseTime</code>, <code>responseSize</code>, <code>to.have.status/header/jsonBody/body</code>, <code>to.be.ok/success/error/clientError/serverError/json/redirection</code>, and <code>to.not.*</code>.</li>
            <li><code>pm.test(name, fn)</code> (sync or async), <code>pm.test.skip</code>, <code>pm.expect</code> (chai 4), <code>pm.sendRequest(urlOrOptions, callback)</code> (also returns a promise), <code>pm.info</code>, <code>pm.execution.setNextRequest</code>, <code>postman.setNextRequest</code>, <code>console.log/info/warn/error</code>.</li>
            <li>Legacy: <code>tests[name] = bool</code>, <code>responseBody</code>, <code>responseCode</code>, <code>responseHeaders</code>, <code>postman.setEnvironmentVariable/getEnvironmentVariable/setGlobalVariable</code>.</li>
            <li>Dynamic variables: <code>{'{{$guid}}'}</code>, <code>{'{{$timestamp}}'}</code>, <code>{'{{$isoTimestamp}}'}</code>, <code>{'{{$randomInt}}'}</code> and a small set of <code>$random*</code> helpers.</li>
          </ul>
          <p className="small"><strong>Not supported:</strong> <code>require()</code> and Postman’s bundled libraries (lodash, moment, cheerio, ajv…), <code>pm.response.to.have.jsonSchema</code>, <code>pm.cookies</code>, <code>pm.visualizer</code>, <code>pm.vault</code>, <code>pm.execution.skipRequest</code>, <code>pm.environment.name</code>, certificates and proxies per request. OAuth 2.0 flows are not run (an access token can be pasted); digest, hawk, AWS, NTLM and OAuth 1 auth are kept on round-trip but not applied.</p>
        </section>
        <section className="card">
          <h2>Postman compatibility</h2>
          <ul className="bullets small">
            <li>The internal model <em>is</em> Postman Collection v2.1, so import → export keeps everything, including fields this app doesn’t understand.</li>
            <li>Imports: Collection v2.1 and v2.0, environment and globals JSON, Postman “Export data” zips, <code>export-from-postman.mjs</code> zips (optionally one app workspace per Postman workspace), OpenAPI 3 (basic), curl commands. Collection v1 is not supported.</li>
            <li>Exports are validated against the official v2.1 JSON schema in this app’s test suite.</li>
            <li>Variable precedence follows Postman: local → data → environment → collection chain (request, folder, collection) → globals.</li>
          </ul>
        </section>
        <section className="card">
          <h2>Keyboard</h2>
          <p className="small"><kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Enter</kbd> sends the open request · <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>S</kbd> saves it · tab strips use <kbd>←</kbd>/<kbd>→</kbd>.</p>
        </section>
      </div>
    </div>
  );
}

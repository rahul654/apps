import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { SCRIPT_URL } from './lib/env';
import { startAuthWatch } from './store/auth';
import { startLibraryWatch } from './store/library';
import './index.css';

if (SCRIPT_URL) {
  startAuthWatch();
  startLibraryWatch();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);

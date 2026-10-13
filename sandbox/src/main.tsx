import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { SandboxProvider } from './store/SandboxStore';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <SandboxProvider>
        <App />
      </SandboxProvider>
    </HashRouter>
  </StrictMode>,
);

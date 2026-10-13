import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { RecorderProvider } from './store/RecorderContext';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <RecorderProvider>
        <App />
      </RecorderProvider>
    </HashRouter>
  </StrictMode>,
);

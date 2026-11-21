import { installExcalidrawAssetPath } from './lib/assetPath';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { ThemeProvider } from './components/Theme';
import { BoardsProvider } from './store/BoardsStore';
import './index.css';

// Before the editor chunk loads: fonts come from our own dist/fonts/, never a CDN.
installExcalidrawAssetPath();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <ThemeProvider>
        <BoardsProvider>
          <App />
        </BoardsProvider>
      </ThemeProvider>
    </HashRouter>
  </StrictMode>,
);

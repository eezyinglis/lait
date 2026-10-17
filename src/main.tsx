import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { DataProvider } from './store';
import { ensureLibrary } from './db';
import './styles.css';

void ensureLibrary();
// Ask the browser not to evict our IndexedDB under storage pressure (granted for Home Screen apps on iOS).
void navigator.storage?.persist?.();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('./sw.js'); });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DataProvider>
      <App />
    </DataProvider>
  </StrictMode>,
);

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Handle stale Vite chunk errors across browsers without infinite reload loops
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  const retryKey = 'drmedex_vite_preload_retry';
  const lastRetry = sessionStorage.getItem(retryKey);
  const now = Date.now();
  if (!lastRetry || now - parseInt(lastRetry, 10) > 10000) {
    sessionStorage.setItem(retryKey, String(now));
    window.location.reload();
  } else {
    console.error('Vite preload error encountered; skipping reload to prevent loop:', event);
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

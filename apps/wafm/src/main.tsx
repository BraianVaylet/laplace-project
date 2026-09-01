import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App.js';
import './index.css';

/**
 * Registro del service worker. Cuando hay version nueva se emite un evento y el
 * `UpdateGate` muestra el popup: la app no se actualiza sola abajo de los pies
 * de alguien que esta reservando.
 */
const updateSW = registerSW({
  onNeedRefresh: () => globalThis.dispatchEvent(new Event('laplace:sw-update')),
});

globalThis.addEventListener('laplace:sw-apply', () => void updateSW(true));

const root = document.getElementById('root');
if (!root) throw new Error('Falta el elemento #root en index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

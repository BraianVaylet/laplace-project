import { ViteReactSSG } from 'vite-react-ssg';
import { routes } from './routes.js';
import './index.css';

/**
 * Entrada de la landing. `ViteReactSSG` hidrata en el navegador y prerenderiza
 * en el build: el mismo codigo produce HTML servible y una SPA.
 */
export const createRoot = ViteReactSSG({ routes });

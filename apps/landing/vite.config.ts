import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Temporal } from '@js-temporal/polyfill';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    /**
     * `sitemap.xml` y `robots.txt` salen del build, derivados de las mismas
     * paginas que se prerenderizan: no pueden quedar desincronizados con lo que
     * realmente existe (§5.1.4).
     */
    {
      name: 'laplace:seo-files',
      apply: 'build',
      async closeBundle() {
        const { buildRobots, buildSitemap } = await import('./src/seo.js');
        const out = resolve(import.meta.dirname, 'dist');
        // La fecha del sitemap en UTC: no depende de donde se corra el build.
        const today = Temporal.Now.plainDateISO('UTC').toString();

        writeFileSync(resolve(out, 'sitemap.xml'), buildSitemap(today), 'utf8');
        writeFileSync(resolve(out, 'robots.txt'), buildRobots(), 'utf8');
      },
    },
  ],
  server: { port: 5176 },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.tsx', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      // Raiz de composicion: cableado sin logica propia. Lo que arman esta
      // testeado en @laplace/client y @laplace/ui.
      exclude: ['src/**/*.test.{ts,tsx}', 'src/main.tsx', 'src/api.ts', 'src/index.css'],
      // 50% para UI generica y landing (§6). El resto del rigor va en los
      // tests de accesibilidad y en los E2E, no en el porcentaje.
      thresholds: { lines: 50, statements: 50, branches: 50, functions: 50 },
    },
  },
});

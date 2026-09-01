import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    /**
     * PWA instalable (§5.1.3). `registerType: 'prompt'` y no `autoUpdate`
     * porque la spec pide avisar al usuario antes de actualizar, no cambiarle la
     * app abajo de los pies mientras reserva.
     */
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: 'Laplace',
        short_name: 'Laplace',
        description: 'Reservá tus clases y llevá tus marcas.',
        lang: 'es-AR',
        start_url: '/',
        display: 'standalone',
        background_color: '#0b0f14',
        theme_color: '#0b0f14',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        /*
         * Offline minimo de §5.1.3: el horario y las reservas propias se
         * cachean para poder consultarlos sin red — los sotanos de los
         * gimnasios no tienen señal.
         */
        globPatterns: ['**/*.{js,css,html,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /\/api\/v1\/(sessions|bookings)/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'laplace-agenda',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
        ],
      },
    }),
  ],
  server: { port: 5175 },
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

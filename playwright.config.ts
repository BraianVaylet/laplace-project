import { defineConfig, devices } from '@playwright/test';

/** E2E de los 3 caminos criticos de la spec §6 (Testing). */
export default defineConfig({
  testDir: './e2e',
  /*
   * 🔴 En serie, no en paralelo. Los tres caminos comparten **una sola base
   * efímera** y una sola API: correrlos a la vez no prueba nada más y agrega
   * fallos que dependen de quién llegó primero. Un E2E que a veces pasa es peor
   * que uno que tarda un minuto más.
   */
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5175',
    /*
     * Cuando algo falla, el trace y la captura son lo unico que queda: el
     * criterio de F1-31 pide poder ver la pantalla donde el saldo quedo mal,
     * no leer un stack.
     */
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: process.env.CI ? 'retain-on-failure' : 'off',
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  /*
   * 🔴 La API corre contra un Mongo **efimero** (§Testing.7): nunca staging ni
   * produccion. Los tres caminos escriben — dan de alta centros, venden packs,
   * cobran y toman asistencia —, y un E2E contra datos reales es un E2E que un
   * dia borra los de alguien.
   */
  webServer: [
    {
      command: 'pnpm exec tsx e2e/support/api-server.ts',
      url: 'http://localhost:3000/health',
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'pnpm --filter @laplace/wafm dev',
      url: 'http://localhost:5175',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @laplace/dfsm dev',
      url: 'http://localhost:5174',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});

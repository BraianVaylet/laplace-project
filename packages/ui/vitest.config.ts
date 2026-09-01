import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.stories.tsx', 'src/main.tsx', 'src/index.css'],
      // 50% para UI generica y landing (§6). El resto del rigor va en los
      // tests de accesibilidad y en los E2E, no en el porcentaje.
      thresholds: { lines: 50, statements: 50, branches: 50, functions: 50 },
    },
  },
});

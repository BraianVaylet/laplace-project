import { defineConfig } from 'vitest/config';

/**
 * `@laplace/schemas` es la fuente unica de validaciones (ADR-003): lo que se
 * escribe aca decide que entra al sistema. Por eso el umbral es alto y no el
 * 50% de "UI generica" de la tabla de §6.
 */
export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      thresholds: { lines: 90, statements: 90, branches: 85, functions: 85 },
    },
  },
});

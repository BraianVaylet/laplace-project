import { defineConfig } from 'vitest/config';

/** Estados y roles del glosario §14. Son datos: se cubren enteros o no sirven. */
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

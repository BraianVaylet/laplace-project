import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      /*
       * El cliente de API y los helpers de fecha son infraestructura de la que
       * cuelga todo el front: si el requestId no viaja, soporte queda ciego; si
       * una fecha se calcula mal, un pack vence el dia equivocado.
       */
      thresholds: { lines: 90, statements: 90, branches: 85, functions: 85 },
    },
  },
});

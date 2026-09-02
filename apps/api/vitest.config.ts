import { defineConfig } from 'vitest/config';

/**
 * Cobertura **por criticidad**, no un numero global (spec §6).
 *
 * Perseguir 90% en todo el codigo lleva a escribir tests triviales de getters
 * para levantar el numero mientras la logica de reserva concurrente queda sin
 * cubrir. Asi que las zonas donde se juega plata, cupos y permisos exigen 95%,
 * y el resto sostiene el piso global.
 *
 * Los umbrales de rama van 10 puntos por debajo de los de linea a proposito:
 * exigir 95% de ramas obliga a testear cada `??` defensivo, que es ruido, no
 * cobertura. Lo que importa es que la linea se ejecute y que el caso de error
 * este probado.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // mongodb-memory-server descarga el binario de mongod la primera vez.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      thresholds: {
        // Piso global (§6).
        lines: 80,
        statements: 80,
        branches: 75,
        functions: 80,

        // 🔴 Zonas de 95%: permisos, plata y cupos.
        'src/auth/**': { lines: 95, statements: 93, branches: 85, functions: 90 },
        'src/entitlements/**': { lines: 95, statements: 95, branches: 88, functions: 90 },
        'src/tenancy/**': { lines: 90, statements: 88, branches: 85, functions: 90 },

        // Modulos de negocio. La regla es la criticidad, no el directorio.
        'src/modules/**': { lines: 85, statements: 85, branches: 80, functions: 85 },

        // 🔴 Contracts y Billing manejan plata y cupos: suben al 95% de §6,
        // igual que auth y entitlements.
        'src/modules/billing/**': { lines: 95, statements: 90, branches: 85, functions: 90 },
        // Las ramas van 10 puntos por debajo de las lineas, como el resto del
        // archivo: exigir 95% de ramas obliga a testear cada `??` defensivo.
        'src/modules/contracts/**': { lines: 95, statements: 90, branches: 85, functions: 90 },
        // 🔴 Booking reparte los cupos: una sobreventa es una persona parada
        // en la puerta de una clase llena.
        'src/modules/booking/**': { lines: 95, statements: 90, branches: 85, functions: 90 },

        // Infraestructura de soporte.
        'src/jobs/**': { lines: 85, statements: 85, branches: 70, functions: 75 },
        'src/events/**': { lines: 90, statements: 90, branches: 85, functions: 90 },
        'src/http/**': { lines: 85, statements: 85, branches: 85, functions: 75 },
        'src/openapi/**': { lines: 90, statements: 90, branches: 85, functions: 90 },
      },
    },
  },
});

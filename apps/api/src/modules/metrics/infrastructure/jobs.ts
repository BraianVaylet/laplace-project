import type { JobDefinition } from '../../../jobs/runner.js';
import type { MetricsService } from '../application/metrics-service.js';

/**
 * El precálculo diario (§10, §2.1.12).
 *
 * A las 03:00 porque a esa hora no hay nadie entrenando y el día anterior ya
 * cerró en cualquier zona horaria razonable del país. Es el trabajo pesado que
 * el panel no hace: lo hace una vez acá, y después se lee.
 *
 * Es idempotente: cada día se guarda con un upsert sobre el único
 * `{ tenantId, venueId, date }`, así que correrlo dos veces sobreescribe en vez
 * de duplicar.
 */
export function metricsJobs(service: MetricsService): JobDefinition[] {
  return [
    {
      name: 'computeMetricsDaily',
      cron: '0 3 * * *',
      /*
       * Diez minutos: recorre todas las sedes de todos los centros, y con
       * volumen eso tarda. Más corto que el intervalo entre corridas por
       * definición — hay 24 horas hasta la siguiente.
       */
      lockTtlSeconds: 600,
      handler: async () => {
        await service.computeYesterday();
      },
    },
  ];
}

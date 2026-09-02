import type { JobDefinition } from '../../../jobs/runner.js';
import type { ScheduleService } from '../application/schedule-service.js';

/**
 * La materializacion de la grilla (§2.1.5.a).
 *
 * Es **idempotente por doble via**: el servicio consulta los inicios ya
 * materializados antes de escribir, y el indice unico
 * `{ tenantId, templateId, startAt }` cierra la ventana entre esa consulta y el
 * insert. El runner garantiza que no corran dos a la vez, no que no corran dos
 * veces.
 */
export function scheduleJobs(service: ScheduleService): JobDefinition[] {
  return [
    {
      name: 'materializeSessions',
      /*
       * 02:00, antes de que nadie mire la grilla del dia. Correrlo mas tarde
       * significa que el socio que abre la app a las 6 puede no ver la clase que
       * entra recien hoy en la ventana de 60 dias.
       */
      cron: '0 2 * * *',
      lockTtlSeconds: 900,
      handler: async () => {
        await service.materializeSessions();
      },
    },
  ];
}

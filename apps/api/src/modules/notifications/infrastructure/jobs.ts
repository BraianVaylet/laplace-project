import type { JobDefinition } from '../../../jobs/runner.js';
import type { NotificationService } from '../application/notification-service.js';

/**
 * La cola de salida (§2.1.14, §10).
 *
 * Corre **cada minuto** porque el primer reintento del backoff es a los 30
 * segundos: con un job cada cinco minutos, "se reintenta a los 30 s" sería
 * mentira y el aviso de una clase que empieza en una hora podría llegar tarde.
 *
 * Es idempotente por construcción: cada aviso se reclama con una escritura
 * atómica (`queued → sending`), así que dos corridas que se pisen no mandan el
 * mismo mail dos veces.
 */
export function notificationJobs(service: NotificationService): JobDefinition[] {
  return [
    {
      name: 'dispatchNotifications',
      cron: '* * * * *',
      /*
       * Corto a propósito: si una corrida se cuelga con el proveedor de mail
       * colgado, la siguiente tiene que poder tomar el lock antes de que el
       * recordatorio pierda sentido.
       */
      lockTtlSeconds: 55,
      handler: async () => {
        await service.dispatchDue();
      },
    },
  ];
}

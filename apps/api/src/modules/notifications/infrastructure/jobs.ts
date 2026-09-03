import type { JobDefinition } from '../../../jobs/runner.js';
import type { NotificationService } from '../application/notification-service.js';
import type { ReminderSender } from '../application/reminders.js';

/**
 * Los dos procesos automáticos del módulo (§2.1.14, §10).
 *
 * Los dos son idempotentes, y por el mismo motivo: la deduplicación y el
 * reclamo atómico están en la base, no en el job. Correrlos dos veces sobre lo
 * mismo no manda nada dos veces.
 */
export function notificationJobs(
  service: NotificationService,
  reminders: ReminderSender,
): JobDefinition[] {
  return [
    {
      /**
       * La cola de salida. Corre **cada minuto** porque el primer reintento del
       * backoff es a los 30 segundos: con un job cada cinco, "se reintenta a
       * los 30 s" sería mentira y el aviso de una clase que empieza en una hora
       * podría llegar tarde.
       */
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
    {
      /**
       * Los recordatorios de clase. Cada cinco minutos: es la precisión que
       * necesita el de "en 1 hora" — con un job cada quince, "en una hora"
       * podría salir cuando faltan cuarenta y cinco minutos.
       */
      name: 'classReminders',
      cron: '*/5 * * * *',
      lockTtlSeconds: 280,
      handler: async () => {
        await reminders.send();
      },
    },
  ];
}

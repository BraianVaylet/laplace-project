import type { JobDefinition } from '../../../jobs/runner.js';
import type { BookingService } from '../application/booking-service.js';

/**
 * La ventana de confirmacion de la lista de espera (§2.1.5.b).
 *
 * Corre **cada minuto** porque la ventana se mide en minutos: con un job cada
 * cinco, el que confirmo a horario podria encontrarse con que ya se lo pasaron
 * al siguiente, y el que no confirmo se quedaria con el lugar mas tiempo del
 * que le corresponde.
 *
 * Es idempotente: busca los holds ya vencidos, y volver a correrlo sobre los
 * mismos no encuentra nada porque ya no estan en `waitlisted`.
 */
export function bookingJobs(service: BookingService): JobDefinition[] {
  return [
    {
      name: 'expireWaitlistHolds',
      cron: '* * * * *',
      /*
       * Corto a proposito: si una corrida se cuelga, la siguiente tiene que
       * poder tomar el lock antes de que la ventana de confirmacion pierda
       * sentido.
       */
      lockTtlSeconds: 50,
      handler: async () => {
        await service.expireWaitlistHolds();
      },
    },
  ];
}

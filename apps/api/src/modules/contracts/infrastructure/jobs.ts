import type { JobDefinition } from '../../../jobs/runner.js';
import type { ContractService } from '../application/contract-service.js';

/**
 * Los dos procesos diarios de Contracts (§10).
 *
 * Los dos son **idempotentes**, que es lo que el runner exige: `expireContracts`
 * solo toca los que siguen vivos, y `notifyExpiring` guarda el hito ya avisado.
 * El runner garantiza que no corran dos a la vez, no que no corran dos veces.
 */
export function contractJobs(service: ContractService): JobDefinition[] {
  return [
    {
      name: 'expireContracts',
      // 03:00: despues de que cerro el ultimo turno y antes del primero.
      cron: '0 3 * * *',
      handler: async () => {
        await service.expireDueContracts();
      },
    },
    {
      /*
       * Los avisos de vencimiento son ingreso directo: es el momento en que el
       * socio renueva. Van a las 10:00 y no a las 03:00 porque un mail que llega
       * de madrugada se lee entre veinte mas.
       */
      name: 'notifyExpiringContracts',
      cron: '0 10 * * *',
      handler: async () => {
        await service.notifyExpiringContracts();
      },
    },
  ];
}

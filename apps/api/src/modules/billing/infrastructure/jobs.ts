import type { JobDefinition } from '../../../jobs/runner.js';
import type { BillingService } from '../application/billing-service.js';

/**
 * El proceso diario de mora (§2.1.12).
 *
 * La morosidad es el KPI numero 1 del mercado argentino, y el pasaje a mora
 * tiene que ser **automatico**: si hay que calcularlo a mano, no se calcula.
 */
export function billingJobs(service: BillingService): JobDefinition[] {
  return [
    {
      name: 'dunning',
      /*
       * 06:00, antes del primer turno: el socio que llega a entrenar y esta en
       * mora tiene que verlo en la puerta, no a media mañana.
       */
      cron: '0 6 * * *',
      handler: async () => {
        await service.runDunning();
      },
    },
  ];
}

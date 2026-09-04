import type { Temporal } from '@js-temporal/polyfill';
import type { ContactRequestInput, ContactRequestResult } from '@laplace/schemas';
import { toBsonDate } from '../../../persistence/bson-date.js';
import { looksAutomated, looksLikeSpam } from '../domain/spam.js';
import { ContactRequestModel } from '../infrastructure/contact-request.model.js';

export interface CrmServiceDeps {
  now: () => Temporal.Instant;
}

/**
 * El formulario de contacto de la landing (§5.1.4).
 *
 * 🔴 **Al bot se le responde que sí.** Descartar en silencio y contestar 200 es
 * deliberado: un rechazo le dice al robot qué cambiar para pasar, y a la
 * persona que escribió de verdad no la afecta porque su pedido sí se guardó.
 */
export class CrmService {
  constructor(private readonly deps: CrmServiceDeps) {}

  async receive(input: ContactRequestInput): Promise<ContactRequestResult> {
    if (looksAutomated(input.website) || looksLikeSpam(input.message)) {
      return { received: true };
    }

    await ContactRequestModel.create({
      name: input.name,
      email: input.email,
      phone: input.phone ?? null,
      centerName: input.centerName ?? null,
      message: input.message,
      source: input.source,
      receivedAt: toBsonDate(this.deps.now()),
    });

    return { received: true };
  }
}

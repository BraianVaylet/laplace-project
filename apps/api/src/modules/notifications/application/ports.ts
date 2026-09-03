import type { Temporal } from '@js-temporal/polyfill';

/**
 * Puertos de salida de Notifications. Se inyectan: **ningún test manda un
 * mail**, y el proveedor real se cambia sin tocar el motor (§2.1.14).
 */

export interface OutgoingEmail {
  to: string;
  subject: string;
  body: string;
}

/**
 * El proveedor de mail. Que `send` falle es parte del contrato, no una
 * excepción rara: es exactamente lo que el backoff existe para atender.
 */
export interface NotificationMailer {
  send(email: OutgoingEmail): Promise<void>;
}

/**
 * A quién le mandamos y en qué zona horaria vive (la ventana de silencio es la
 * del centro, no la del servidor).
 *
 * Es un puerto y no una consulta a Members porque Notifications no importa el
 * modelo de otro módulo (ADR-003): quien arma el módulo le pasa cómo resolverlo.
 */
export interface NotificationRecipient {
  userId: string;
  name: string;
  email: string | null;
}

export interface RecipientLookup {
  /** `null` cuando el socio no tiene cuenta: no hay a quién avisarle todavía. */
  byMemberId(memberId: string): Promise<NotificationRecipient | null>;
}

/** La sede, como la necesita un aviso: su nombre y su zona horaria. */
export interface VenueLookup {
  find(venueId: string): Promise<{ name: string; timeZone: string } | null>;
}

/** La clase, como la necesita un aviso. La contesta Schedule (ADR-003). */
export interface SessionLookup {
  find(
    sessionId: string,
  ): Promise<{ name: string; venueId: string; startAt: Temporal.Instant } | null>;
}

/**
 * Quiénes están anotados. Va con el estado porque no todos los avisos son para
 * todos: al de la lista de espera le importa que se cancele la clase, pero no
 * que cambie el coach de un lugar que todavía no tiene.
 */
export interface RosterLookup {
  of(sessionId: string): Promise<Array<{ memberId: string; status: string }>>;
}

export interface ContractLookup {
  find(contractId: string): Promise<{
    productName: string;
    venueId: string;
    /** `null` en una membresía sin vencimiento. */
    endsAt: Temporal.Instant | null;
  } | null>;
}

export interface ChargeLookup {
  find(chargeId: string): Promise<{ venueId: string; dueAt: Temporal.Instant } | null>;
}

export interface PaymentLookup {
  find(paymentId: string): Promise<{ venueId: string; receivedAt: Temporal.Instant } | null>;
}

/**
 * Las clases que arrancan en una ventana, de **todos** los centros: es lo que
 * recorre el job de recordatorios antes de entrar al contexto de cada tenant.
 */
export interface UpcomingSessionLookup {
  startingBetween(
    from: Temporal.Instant,
    to: Temporal.Instant,
  ): Promise<Array<{ tenantId: string; sessionId: string; startAt: Temporal.Instant }>>;
}

/**
 * Implementación de desarrollo: deja el aviso en el log en vez de mandarlo.
 * En staging y prod se reemplaza por el proveedor real (§6: Resend).
 */
export function createLoggingMailer(log: (msg: string, meta: object) => void): NotificationMailer {
  return {
    send(email) {
      log('Aviso por mail (modo dev, no se envió)', {
        module: 'notifications',
        action: 'sendEmail',
        meta: { to: email.to, subject: email.subject },
      });

      return Promise.resolve();
    },
  };
}

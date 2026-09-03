import { Temporal } from '@js-temporal/polyfill';
import type { DomainEventBus } from '../../../events/bus.js';
import { fechaLarga, horaDe, montoDe } from '../domain/format.js';
import type { NotificationService } from './notification-service.js';
import type {
  ChargeLookup,
  ContractLookup,
  PaymentLookup,
  RecipientLookup,
  RosterLookup,
  SessionLookup,
  VenueLookup,
} from './ports.js';

/**
 * Los avisos automáticos de §2.1.14, todos enganchados en un solo lugar.
 *
 * 🔴 **Nadie llama a Notifications.** Cada aviso cuelga de un evento de dominio
 * que otro módulo ya emitía por su cuenta (ADR-003): Booking no sabe que existe
 * este archivo, y por eso un proveedor de mail caído no puede romper una
 * reserva que ya está hecha.
 *
 * Un handler que falla tampoco rompe al emisor ni a los otros handlers: eso lo
 * garantiza el bus (`allSettled`), no cada uno de estos.
 */
export interface SubscriptionLookups {
  recipients: RecipientLookup;
  sessions: SessionLookup;
  venues: VenueLookup;
  roster: RosterLookup;
  contracts: ContractLookup;
  charges: ChargeLookup;
  payments: PaymentLookup;
}

/** Sin sede conocida, el aviso se arma en hora argentina y no en UTC. */
export const DEFAULT_TIME_ZONE = 'America/Argentina/Buenos_Aires';

export function subscribeNotifications(
  service: NotificationService,
  events: DomainEventBus,
  lookups: SubscriptionLookups,
): void {
  /** Todo lo que necesita un aviso de clase: quién, qué clase, dónde y cuándo. */
  const contextoDeClase = async (sessionId: string, memberId: string) => {
    const destinatario = await lookups.recipients.byMemberId(memberId);
    // Un walk-in cargado en el mostrador no tiene cuenta ni dónde recibir nada.
    if (!destinatario) return null;

    const clase = await lookups.sessions.find(sessionId);
    if (!clase) return null;

    const sede = await lookups.venues.find(clase.venueId);
    const timeZone = sede?.timeZone ?? DEFAULT_TIME_ZONE;

    return {
      destinatario,
      clase,
      sede,
      timeZone,
      local: clase.startAt.toZonedDateTimeISO(timeZone),
    };
  };

  // ── Reservas ──────────────────────────────────────────────────────────────

  events.on('booking.created', async ({ bookingId, sessionId, memberId }) => {
    const contexto = await contextoDeClase(sessionId, memberId);
    if (!contexto) return;

    await service.queue({
      eventType: 'booking.created',
      userId: contexto.destinatario.userId,
      email: contexto.destinatario.email,
      subjectId: bookingId,
      timeZone: contexto.timeZone,
      values: {
        nombre: contexto.destinatario.name,
        clase: contexto.clase.name,
        fecha: fechaLarga(contexto.local),
        hora: horaDe(contexto.local),
        sede: contexto.sede?.name ?? 'el centro',
      },
    });
  });

  events.on('booking.cancelled', async ({ bookingId, sessionId, memberId }) => {
    const contexto = await contextoDeClase(sessionId, memberId);
    if (!contexto) return;

    await service.queue({
      eventType: 'booking.cancelled',
      userId: contexto.destinatario.userId,
      email: contexto.destinatario.email,
      subjectId: bookingId,
      timeZone: contexto.timeZone,
      values: {
        nombre: contexto.destinatario.name,
        clase: contexto.clase.name,
        fecha: fechaLarga(contexto.local),
        hora: horaDe(contexto.local),
      },
    });
  });

  /**
   * Se liberó un lugar (§2.1.5.b). Es el aviso más urgente del producto: el
   * socio tiene una ventana corta para confirmar, así que el plazo va en el
   * texto — no alcanza con decirle que entró.
   */
  events.on(
    'booking.waitlist_promoted',
    async ({ bookingId, sessionId, memberId, confirmBefore }) => {
      const contexto = await contextoDeClase(sessionId, memberId);
      if (!contexto) return;

      const plazo = instanteDe(confirmBefore)?.toZonedDateTimeISO(contexto.timeZone);

      await service.queue({
        eventType: 'booking.waitlist_promoted',
        userId: contexto.destinatario.userId,
        email: contexto.destinatario.email,
        subjectId: bookingId,
        timeZone: contexto.timeZone,
        values: {
          nombre: contexto.destinatario.name,
          clase: contexto.clase.name,
          fecha: fechaLarga(contexto.local),
          hora: horaDe(contexto.local),
          plazo: plazo ? `las ${horaDe(plazo)}` : 'que se venza el plazo',
        },
      });
    },
  );

  // ── Clases ────────────────────────────────────────────────────────────────

  /**
   * Clase cancelada por el centro. Les llega a **todos** los que tenían lugar,
   * incluidos los de la lista de espera: el que esperaba un lugar también
   * organizó su tarde alrededor de esa clase.
   *
   * Los destinatarios salen del payload y no de la lista de inscriptos: para
   * cuando esto corre, las reservas ya se cancelaron y la clase no tiene a
   * nadie. Es información que solo tiene el que canceló.
   */
  events.on('session.cancelled', async ({ sessionId, reason, releasedMemberIds }) => {
    for (const memberId of releasedMemberIds) {
      const contexto = await contextoDeClase(sessionId, memberId);
      if (!contexto) continue;

      await service.queue({
        eventType: 'session.cancelled',
        userId: contexto.destinatario.userId,
        email: contexto.destinatario.email,
        subjectId: sessionId,
        timeZone: contexto.timeZone,
        values: {
          nombre: contexto.destinatario.name,
          clase: contexto.clase.name,
          fecha: fechaLarga(contexto.local),
          hora: horaDe(contexto.local),
          motivo: reason,
        },
      });
    }
  });

  /**
   * Cambió el coach. Solo a los que tienen lugar: al de la lista de espera
   * todavía no le cambió nada.
   */
  events.on('session.coach_changed', async ({ sessionId }) => {
    for (const inscripto of await lookups.roster.of(sessionId)) {
      if (inscripto.status === 'waitlisted') continue;

      const contexto = await contextoDeClase(sessionId, inscripto.memberId);
      if (!contexto) continue;

      await service.queue({
        eventType: 'session.coach_changed',
        userId: contexto.destinatario.userId,
        email: contexto.destinatario.email,
        subjectId: sessionId,
        timeZone: contexto.timeZone,
        values: {
          nombre: contexto.destinatario.name,
          clase: contexto.clase.name,
          fecha: fechaLarga(contexto.local),
          hora: horaDe(contexto.local),
        },
      });
    }
  });

  // ── Packs ─────────────────────────────────────────────────────────────────

  /**
   * El pack está por vencer (§2.1.2). Contracts ya decidió el hito (7, 3 o 1
   * día) y ya se guardó cuál avisó, así que acá no hay que volver a decidirlo:
   * el hito entra en la clave de dedupe para que los tres avisos sean tres
   * avisos distintos y no uno repetido.
   */
  events.on('contract.expiring', async ({ contractId, memberId, daysLeft }) => {
    const contrato = await lookups.contracts.find(contractId);
    const destinatario = await lookups.recipients.byMemberId(memberId);
    if (!contrato || !destinatario) return;

    const sede = await lookups.venues.find(contrato.venueId);
    const timeZone = sede?.timeZone ?? DEFAULT_TIME_ZONE;

    await service.queue({
      eventType: 'contract.expiring',
      userId: destinatario.userId,
      email: destinatario.email,
      subjectId: `${contractId}:${daysLeft}`,
      timeZone,
      values: {
        nombre: destinatario.name,
        pack: contrato.productName,
        dias: String(daysLeft),
        vence: contrato.endsAt
          ? fechaLarga(contrato.endsAt.toZonedDateTimeISO(timeZone))
          : 'pronto',
      },
    });
  });

  events.on('contract.expired', async ({ contractId, memberId }) => {
    const contrato = await lookups.contracts.find(contractId);
    const destinatario = await lookups.recipients.byMemberId(memberId);
    if (!contrato || !destinatario) return;

    const sede = await lookups.venues.find(contrato.venueId);

    await service.queue({
      eventType: 'contract.expired',
      userId: destinatario.userId,
      email: destinatario.email,
      subjectId: contractId,
      timeZone: sede?.timeZone ?? DEFAULT_TIME_ZONE,
      values: { nombre: destinatario.name, pack: contrato.productName },
    });
  });

  // ── Plata ─────────────────────────────────────────────────────────────────

  /**
   * Deuda vencida (§2.1.12). Es de los dos avisos que salen aunque el socio
   * haya apagado el canal: el motor lo resuelve solo, acá solo se encola.
   *
   * El monto es **todo lo que debe**, no el cargo que disparó el aviso: al
   * socio le importa cuánto tiene que llevar, no cuál de sus cuotas venció.
   */
  events.on('charge.overdue', async ({ chargeId, memberId, overdueCents }) => {
    const cargo = await lookups.charges.find(chargeId);
    const destinatario = await lookups.recipients.byMemberId(memberId);
    if (!cargo || !destinatario) return;

    const sede = await lookups.venues.find(cargo.venueId);
    const timeZone = sede?.timeZone ?? DEFAULT_TIME_ZONE;

    await service.queue({
      eventType: 'charge.overdue',
      userId: destinatario.userId,
      email: destinatario.email,
      subjectId: chargeId,
      timeZone,
      values: {
        nombre: destinatario.name,
        monto: montoDe(overdueCents),
        vencimiento: fechaLarga(cargo.dueAt.toZonedDateTimeISO(timeZone)),
      },
    });
  });

  /** Pago recibido. Es el comprobante del socio: si no llega, vuelve a preguntar. */
  events.on('payment.received', async ({ paymentId, memberId, amountCents }) => {
    const pago = await lookups.payments.find(paymentId);
    const destinatario = await lookups.recipients.byMemberId(memberId);
    if (!pago || !destinatario) return;

    const sede = await lookups.venues.find(pago.venueId);
    const timeZone = sede?.timeZone ?? DEFAULT_TIME_ZONE;

    await service.queue({
      eventType: 'payment.received',
      userId: destinatario.userId,
      email: destinatario.email,
      subjectId: paymentId,
      timeZone,
      values: {
        nombre: destinatario.name,
        monto: montoDe(amountCents),
        fecha: fechaLarga(pago.receivedAt.toZonedDateTimeISO(timeZone)),
      },
    });
  });
}

/** `confirmBefore` viaja como texto en el evento. Un valor roto no rompe el aviso. */
function instanteDe(iso: string): Temporal.Instant | null {
  try {
    return Temporal.Instant.from(iso);
  } catch {
    return null;
  }
}

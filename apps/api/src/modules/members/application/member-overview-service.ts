import { Temporal } from '@js-temporal/polyfill';
import type { MemberOverview } from '@laplace/schemas';
import type {
  MemberBookingsPort,
  MemberContractsPort,
  MemberWaiversPort,
} from './overview-ports.js';

export interface MemberOverviewServiceDeps {
  contracts: MemberContractsPort;
  bookings: MemberBookingsPort;
  waivers: MemberWaiversPort;
  now: () => Temporal.Instant;
}

/** La ventana de asistencia que le sirve al mostrador (§2.1.7). */
const ATTENDANCE_WINDOW_DAYS = 90;

/** Cuántas reservas futuras se muestran. Más abajo es la agenda, no la ficha. */
const UPCOMING_LIMIT = 5;

/**
 * La ficha 360 del socio (§2.1.7).
 *
 * Es la pantalla más usada del DFSM. Todo lo que junta viene en **una sola
 * respuesta** a propósito: quien la abre está con alguien enfrente esperando,
 * y encadenar cuatro pedidos para armarla es hacerlo esperar cuatro veces.
 *
 * 🔴 **No trae plata.** El estado de cuenta y la deuda tienen su propio
 * endpoint con `billing:read`. Si vinieran acá, el coach —que abre esta
 * pantalla todos los días— recibiría la deuda del socio y la pantalla la
 * escondería, que es lo mismo que mandarla (§2.1.12).
 */
export class MemberOverviewService {
  constructor(private readonly deps: MemberOverviewServiceDeps) {}

  async of(memberId: string): Promise<MemberOverview> {
    const ahora = this.deps.now();
    const desde = ahora.subtract({ hours: 24 * ATTENDANCE_WINDOW_DAYS });

    const [contratos, reservas, firmas] = await Promise.all([
      this.deps.contracts.ofMember(memberId),
      this.deps.bookings.ofMember(memberId),
      this.deps.waivers.signedOf(memberId),
    ]);

    const enVentana = reservas.filter(
      (reserva) => Temporal.Instant.compare(reserva.startAt, desde) >= 0,
    );
    const asistidas = enVentana.filter((reserva) => reserva.status === 'checked_in');
    const ultima = asistidas
      .map((reserva) => reserva.startAt)
      .sort(Temporal.Instant.compare)
      .at(-1);

    return {
      memberId,
      contracts: contratos.map((contrato) => {
        // Una membresía no lleva créditos: se topea por período, no por clases.
        const cuenta = contrato.creditsTotal > 0;

        return {
          contractId: contrato.contractId,
          productName: contrato.productName,
          productType: contrato.productType,
          status: contrato.status,
          creditsLeft: cuenta ? contrato.creditsTotal - contrato.creditsUsed : null,
          creditsTotal: cuenta ? contrato.creditsTotal : null,
          endsAt: contrato.endsAt ? contrato.endsAt.toString() : null,
          daysLeft: contrato.endsAt ? diasEntre(ahora, contrato.endsAt) : null,
        };
      }),
      upcomingBookings: reservas
        .filter(
          (reserva) =>
            Temporal.Instant.compare(reserva.startAt, ahora) >= 0 &&
            ['booked', 'waitlisted'].includes(reserva.status),
        )
        .sort((a, b) => Temporal.Instant.compare(a.startAt, b.startAt))
        .slice(0, UPCOMING_LIMIT)
        .map((reserva) => ({
          bookingId: reserva.bookingId,
          sessionId: reserva.sessionId,
          className: reserva.className,
          startAt: reserva.startAt.toString(),
          status: reserva.status,
        })),
      attendance: {
        windowDays: ATTENDANCE_WINDOW_DAYS,
        attended: asistidas.length,
        noShows: enVentana.filter((reserva) => reserva.status === 'no_show').length,
        lastAttendanceAt: ultima ? ultima.toString() : null,
        /*
         * `null` si nunca vino en la ventana. No es lo mismo que cero: cero
         * días diría "vino hoy", que es exactamente la lectura contraria.
         */
        daysSinceLastVisit: ultima ? diasEntre(ultima, ahora) : null,
      },
      waivers: firmas,
    };
  }
}

/** Días de calendario enteros entre dos instantes. */
function diasEntre(desde: Temporal.Instant, hasta: Temporal.Instant): number {
  return Math.trunc(desde.until(hasta).total({ unit: 'hour' }) / 24);
}

import type { Temporal } from '@js-temporal/polyfill';
import type { Alert, AlertItem, Dashboard, DashboardSession } from '@laplace/schemas';
import {
  ALERT_PREVIEW_SIZE,
  dayWindow,
  expiringUntil,
  inactiveSince,
  isLowOccupancy,
  occupancyOf,
  todayIn,
  weekWindow,
} from '../domain/alerts.js';
import type {
  AlertMemberLookup,
  BillingTotals,
  ContractAlertLookup,
  DashboardSessionLookup,
  SessionOccupancy,
  VenueDirectory,
  WaiverAlertLookup,
} from './ports.js';

export interface DashboardServiceDeps {
  venues: VenueDirectory;
  sessions: DashboardSessionLookup;
  occupancy: SessionOccupancy;
  members: AlertMemberLookup;
  contracts: ContractAlertLookup;
  waivers: WaiverAlertLookup;
  billing: BillingTotals;
  now: () => Temporal.Instant;
}

/** Lo que ve quien pregunta. El coach no ve plata (§2.1.12). */
export interface DashboardScope {
  /** `true` solo para quien tiene `billing.read`. */
  seesMoney: boolean;
}

/**
 * El tablero operativo del día (§5.1.2).
 *
 * 🔴 **El panel de alertas vale más que cualquier gráfico** (§2.1.12), y el
 * motivo es concreto: un gráfico se mira, una alerta se toca. Por eso cada
 * alerta trae los ítems con los que se resuelve — el socio al que llamar, el
 * pack a renovar — y no solo un número.
 *
 * Lo que el coach no puede ver **no viene en la respuesta**, no viene en cero:
 * un cero se lee como "no entró plata hoy", y lo que pasa es otra cosa.
 */
export class DashboardService {
  constructor(private readonly deps: DashboardServiceDeps) {}

  async of(venueId: string, scope: DashboardScope): Promise<Dashboard> {
    const timeZone = await this.deps.venues.timeZoneOf(venueId);
    const ahora = this.deps.now();
    const hoy = dayWindow(ahora, timeZone);

    const sessions = await this.sessionsOfToday(venueId, hoy, timeZone);
    const alerts = await this.alertsOf(venueId, timeZone, ahora, scope);

    return {
      venueId,
      date: todayIn(ahora, timeZone),
      sessions,
      checkedIn: sessions.reduce((total, clase) => total + clase.checkedIn, 0),
      booked: sessions.reduce((total, clase) => total + clase.booked, 0),
      ...(scope.seesMoney ? { money: await this.moneyOf(venueId, ahora, timeZone) } : {}),
      alerts,
    };
  }

  private async sessionsOfToday(
    venueId: string,
    window: { from: Temporal.Instant; to: Temporal.Instant },
    timeZone: string,
  ): Promise<DashboardSession[]> {
    const clases = await this.deps.sessions.ofWindow(venueId, window.from, window.to);
    const ocupacion = await this.deps.occupancy.bySession(clases.map((clase) => clase.sessionId));

    return clases.map((clase) => {
      const propia = ocupacion[clase.sessionId] ?? { booked: 0, checkedIn: 0 };

      return {
        sessionId: clase.sessionId,
        name: clase.name,
        startAt: clase.startAt.toString(),
        startsAtLocal: clase.startAt
          .toZonedDateTimeISO(timeZone)
          .toPlainTime()
          .toString({ smallestUnit: 'minute' }),
        capacity: clase.capacity,
        booked: propia.booked,
        checkedIn: propia.checkedIn,
        occupancy: occupancyOf(propia.booked, clase.capacity),
        status: clase.status,
      };
    });
  }

  private async moneyOf(venueId: string, now: Temporal.Instant, timeZone: string) {
    const totales = await this.deps.billing.ofDay(venueId, todayIn(now, timeZone), timeZone);
    const deudores = await this.deps.members.debtors(venueId);

    return {
      incomeCents: totales.incomeCents,
      overdueCents: totales.overdueCents,
      debtors: deudores.length,
    };
  }

  /** Las cinco alertas de §2.1.12, en el orden en que hay que atenderlas. */
  private async alertsOf(
    venueId: string,
    timeZone: string,
    now: Temporal.Instant,
    scope: DashboardScope,
  ): Promise<Alert[]> {
    const alertas: Alert[] = [];

    const inactivos = await this.deps.members.inactiveSince(venueId, inactiveSince(now, timeZone));
    alertas.push(
      alertOf(
        'inactive_members',
        inactivos.map((socio) => ({
          id: socio.memberId,
          label: socio.fullName,
          detail: socio.lastAttendanceAt
            ? `Última vez el ${socio.lastAttendanceAt.toZonedDateTimeISO(timeZone).toPlainDate().toString()}`
            : 'Nunca asistió',
        })),
      ),
    );

    const porVencer = await this.deps.contracts.expiringIn(venueId, expiringUntil(now, timeZone));
    alertas.push(
      alertOf(
        'expiring_contracts',
        porVencer.map((contrato) => ({
          id: contrato.memberId,
          label: contrato.memberName,
          detail: `${contrato.productName} vence el ${contrato.endsAt.toZonedDateTimeISO(timeZone).toPlainDate().toString()}`,
        })),
      ),
    );

    /*
     * La deuda es plata: al coach no le aparece. No es una alerta vacía — la
     * alerta directamente no está, igual que el bloque de cobros.
     */
    if (scope.seesMoney) {
      const deudores = await this.deps.members.debtors(venueId);
      alertas.push(
        alertOf(
          'debtors',
          deudores.map((socio) => ({
            id: socio.memberId,
            label: socio.fullName,
            detail: `Debe ${montoDe(-socio.balanceCents)}`,
          })),
        ),
      );
    }

    const semana = weekWindow(now, timeZone);
    const proximas = await this.deps.sessions.ofWindow(venueId, semana.from, semana.to);
    const ocupacion = await this.deps.occupancy.bySession(proximas.map((clase) => clase.sessionId));
    alertas.push(
      alertOf(
        'low_occupancy',
        proximas
          .filter((clase) =>
            isLowOccupancy(ocupacion[clase.sessionId]?.booked ?? 0, clase.capacity),
          )
          .map((clase) => ({
            id: clase.sessionId,
            label: clase.name,
            detail: `${ocupacion[clase.sessionId]?.booked ?? 0} de ${clase.capacity} el ${clase.startAt
              .toZonedDateTimeISO(timeZone)
              .toPlainDate()
              .toString()}`,
          })),
      ),
    );

    const activos = await this.deps.members.activeIn(venueId);
    const sinFirmar = new Set(
      await this.deps.waivers.missingAmong(activos.map((socio) => socio.memberId)),
    );
    alertas.push(
      alertOf(
        'missing_waivers',
        activos
          .filter((socio) => sinFirmar.has(socio.memberId))
          .map((socio) => ({
            id: socio.memberId,
            label: socio.fullName,
            detail: 'Le falta firmar un documento obligatorio',
          })),
      ),
    );

    return alertas;
  }
}

/** El total va completo; la lista, recortada. El resto vive en su pantalla. */
function alertOf(type: Alert['type'], items: AlertItem[]): Alert {
  return { type, count: items.length, items: items.slice(0, ALERT_PREVIEW_SIZE) };
}

/** "$18.000". Los montos viven en centavos enteros (§5.2.2). */
function montoDe(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('es-AR')}`;
}

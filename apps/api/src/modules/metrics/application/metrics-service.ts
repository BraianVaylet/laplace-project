import { Temporal } from '@js-temporal/polyfill';
import {
  DEFAULT_METRICS_DAYS,
  MAX_METRICS_DAYS,
  type MetricsDaily,
  type MetricsRange,
  type RecomputeMetricsInput,
} from '@laplace/schemas';
import { AppError } from '../../../http/errors.js';
import { runWithTenant } from '../../../tenancy/context.js';
import {
  EMPTY_COUNTS,
  dayKpisOf,
  summarize,
  type DayCounts,
  type DayKpis,
} from '../domain/kpis.js';
import type { MetricsDailyRepository } from '../infrastructure/metrics-daily.repository.js';
import type { MetricsDailyDoc } from '../infrastructure/metrics-daily.model.js';
import type {
  BillingTotals,
  BookingCounts,
  MemberCounts,
  SessionCounts,
  VenueDirectory,
} from './ports.js';

export interface MetricsServiceDeps {
  metrics: MetricsDailyRepository;
  venues: VenueDirectory;
  sessions: SessionCounts;
  bookings: BookingCounts;
  members: MemberCounts;
  billing: BillingTotals;
  now: () => Temporal.Instant;
}

/**
 * Los KPIs precalculados de §2.1.12.
 *
 * 🔴 **El panel lee, no agrega.** Calcular KPIs con agregaciones en vivo sobre
 * colecciones que crecen es la causa número uno de dashboards lentos, y el
 * dashboard lento es el que nadie abre. El trabajo pesado lo hace un job a las
 * 03:00 y el panel se limita a leer filas ya calculadas.
 */
export class MetricsService {
  constructor(private readonly deps: MetricsServiceDeps) {}

  // ── El job ────────────────────────────────────────────────────────────────

  /**
   * Recalcula el día de ayer para todas las sedes de todos los centros.
   *
   * **Ayer y no hoy**: el día de hoy todavía no terminó, y un KPI de un día a
   * medias invita a compararlo con días completos. El job corre a las 03:00,
   * cuando la madrugada de cada centro ya cerró.
   */
  async computeYesterday(): Promise<number> {
    let calculados = 0;

    for (const sede of await this.deps.venues.allAcrossTenants()) {
      const ayer = this.deps
        .now()
        .toZonedDateTimeISO(sede.timeZone)
        .subtract({ days: 1 })
        .toPlainDate()
        .toString();

      calculados += await runWithTenant(
        {
          tenantId: sede.tenantId,
          userId: 'system:computeMetricsDaily',
          requestId: `job-metrics-${sede.venueId}-${ayer}`,
        },
        () => this.computeDay(sede.venueId, ayer, sede.timeZone),
      );
    }

    return calculados;
  }

  /**
   * Calcula un día y lo guarda. Devuelve 1 siempre: el día sin actividad
   * también se guarda, en cero. Un hueco en la serie no se distingue de un día
   * que todavía no se calculó, y el gráfico dibujaría una línea que miente.
   */
  async computeDay(venueId: string, date: string, timeZone: string): Promise<number> {
    const kpis = dayKpisOf(await this.countDay(venueId, date, timeZone));
    await this.deps.metrics.upsertDay(venueId, date, kpis);

    return 1;
  }

  /** Los conteos crudos del día, en el calendario del centro. */
  private async countDay(venueId: string, date: string, timeZone: string): Promise<DayCounts> {
    const desde = Temporal.PlainDate.from(date).toZonedDateTime({ timeZone });
    const hasta = desde.add({ days: 1 });

    const clases = await this.deps.sessions.ofWindow(venueId, desde.toInstant(), hasta.toInstant());
    const porEstado = await this.deps.bookings.byStatusOf(clases.map((clase) => clase.sessionId));
    const plata = await this.deps.billing.ofDay(venueId, date, timeZone);

    const attendances = porEstado['checked_in'] ?? 0;
    const noShows = porEstado['no_show'] ?? 0;

    return {
      ...EMPTY_COUNTS,
      activeMembers: await this.deps.members.activeIn(venueId),
      attendances,
      noShows,
      lateCancels: porEstado['late_cancelled'] ?? 0,
      /*
       * Las que llegaron vivas a la clase. `booked` entra porque una reserva
       * que quedó sin check-in y sin marcar como falta igual ocupó el lugar:
       * dejarla afuera inflaría la utilización.
       */
      bookings: attendances + noShows + (porEstado['booked'] ?? 0),
      capacity: clases.reduce((total, clase) => total + clase.capacity, 0),
      sessions: clases.length,
      ...plata,
    };
  }

  /**
   * Reprocesa un rango a mano (§2.1.12). Existe porque los datos de un día
   * cambian después: un pago que se carga tarde, una asistencia que el coach
   * corrige al día siguiente.
   */
  async recompute(input: RecomputeMetricsInput): Promise<number> {
    const timeZone = await this.deps.venues.timeZoneOf(input.venueId);
    const dias = daysBetween(input.from, input.to ?? input.from);
    let calculados = 0;

    for (const dia of dias) calculados += await this.computeDay(input.venueId, dia, timeZone);

    return calculados;
  }

  // ── El panel ──────────────────────────────────────────────────────────────

  /**
   * Lo que muestra el panel. **Solo lectura de `metricsDaily`**: si esto
   * empezara a agregar en vivo, el precálculo dejaría de tener sentido.
   */
  async panel(
    venueId: string,
    range: { from?: string | undefined; to?: string | undefined } = {},
  ): Promise<MetricsRange> {
    const timeZone = await this.deps.venues.timeZoneOf(venueId);
    const { from, to } = resolveRange(range, this.deps.now(), timeZone);

    const filas = await this.deps.metrics.between(venueId, from, to);
    const dias = filas.map(toDaily);
    const total = summarize(dias);

    return { venueId, from, to, ...total, daily: dias };
  }
}

function toDaily(doc: MetricsDailyDoc): MetricsDaily {
  return {
    venueId: doc.venueId,
    date: doc.date,
    activeMembers: doc.activeMembers,
    attendances: doc.attendances,
    noShows: doc.noShows,
    lateCancels: doc.lateCancels,
    bookings: doc.bookings,
    capacity: doc.capacity,
    sessions: doc.sessions,
    incomeCents: doc.incomeCents,
    chargedCents: doc.chargedCents,
    overdueCents: doc.overdueCents,
    utilization: doc.utilization,
    noShowRate: doc.noShowRate,
  };
}

/** Sin fechas, los últimos 30 días **del centro**, terminando ayer. */
function resolveRange(
  range: { from?: string | undefined; to?: string | undefined },
  now: Temporal.Instant,
  timeZone: string,
): { from: string; to: string } {
  const ayer = now.toZonedDateTimeISO(timeZone).subtract({ days: 1 }).toPlainDate();
  const to = range.to ?? ayer.toString();
  const from =
    range.from ??
    Temporal.PlainDate.from(to)
      .subtract({ days: DEFAULT_METRICS_DAYS - 1 })
      .toString();

  if (Temporal.PlainDate.compare(from, to) > 0) {
    throw new AppError({
      code: 'LP-SYS-422-006',
      status: 422,
      message: 'El desde no puede ser posterior al hasta.',
      meta: { from, to },
    });
  }

  return { from, to };
}

/**
 * Los días del rango, inclusive. Con tope: un reproceso de diez años sería un
 * job disfrazado de pedido HTTP.
 */
export function daysBetween(from: string, to: string): string[] {
  const desde = Temporal.PlainDate.from(from);
  const hasta = Temporal.PlainDate.from(to);

  if (Temporal.PlainDate.compare(desde, hasta) > 0) {
    throw new AppError({
      code: 'LP-SYS-422-006',
      status: 422,
      message: 'El desde no puede ser posterior al hasta.',
      meta: { from, to },
    });
  }

  const total = desde.until(hasta).days + 1;
  if (total > MAX_METRICS_DAYS) {
    throw new AppError({
      code: 'LP-SYS-422-006',
      status: 422,
      message: `No se pueden recalcular más de ${MAX_METRICS_DAYS} días de una.`,
      action: 'Partilo en tramos más cortos.',
      meta: { from, to, days: total },
    });
  }

  return Array.from({ length: total }, (_, indice) => desde.add({ days: indice }).toString());
}

export type { DayKpis };

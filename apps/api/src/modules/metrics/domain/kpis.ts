/**
 * Los KPIs de §2.1.12, como fórmulas puras.
 *
 * Están acá y no en una agregación de Mongo porque son **decisiones de
 * negocio**, no consultas: qué cuenta como asistencia, contra qué se mide el
 * no-show y qué significa la morosidad son cosas que alguien va a discutir, y
 * discutirlas mirando una fórmula de tres líneas es mucho mejor que mirar un
 * `$group` de cuarenta.
 */

/** Lo que se cuenta un día, en una sede. Todo entero: no hay medias personas. */
export interface DayCounts {
  /** Socios activos al cierre del día. Es una foto, no un flujo. */
  activeMembers: number;
  attendances: number;
  noShows: number;
  lateCancels: number;
  /**
   * Reservas que llegaron vivas a la hora de la clase: las que asistieron más
   * las que faltaron. Es el denominador del no-show — medirlo contra las
   * reservas totales del día castigaría al centro por las cancelaciones en
   * plazo, que son exactamente lo que la política quiere fomentar.
   */
  bookings: number;
  /** Suma de los cupos de las clases del día. */
  capacity: number;
  sessions: number;
  /** Lo que entró neto en la caja del día (§2.1.16). */
  incomeCents: number;
  /** Lo que se facturó el día: cargos generados. */
  chargedCents: number;
  /** Deuda vencida al cierre del día. Es un stock, no un flujo. */
  overdueCents: number;
}

export interface DayKpis extends DayCounts {
  /** Inscriptos sobre cupo, 0 a 1. Detecta horarios muertos y saturados. */
  utilization: number;
  /** Faltas sobre reservas que llegaron a la clase, 0 a 1. */
  noShowRate: number;
}

/** Todos los conteos en cero: el día sin actividad existe y vale cero, no null. */
export const EMPTY_COUNTS: DayCounts = {
  activeMembers: 0,
  attendances: 0,
  noShows: 0,
  lateCancels: 0,
  bookings: 0,
  capacity: 0,
  sessions: 0,
  incomeCents: 0,
  chargedCents: 0,
  overdueCents: 0,
};

/**
 * Una división que no explota. Sin denominador el KPI es cero, no infinito ni
 * `NaN`: un día sin clases tiene 0% de utilización, no un error en el panel.
 */
export function ratio(part: number, whole: number): number {
  if (whole <= 0) return 0;

  // Cuatro decimales: alcanza para mostrar 12,34% sin arrastrar ruido binario.
  return Math.round((part / whole) * 10_000) / 10_000;
}

export function dayKpisOf(counts: DayCounts): DayKpis {
  return {
    ...counts,
    utilization: ratio(counts.bookings, counts.capacity),
    noShowRate: ratio(counts.noShows, counts.bookings),
  };
}

export interface RangeKpis extends DayKpis {
  days: number;
  /** Asistencias por socio activo. §2.1.12: menos de 2 por semana es alerta. */
  attendancesPerMember: number;
  /** Deuda vencida sobre lo facturado en el período. El KPI #1 del mercado. */
  delinquency: number;
}

/**
 * 🔴 Junta varios días en un solo número.
 *
 * Las tasas se **recalculan sobre las sumas**, nunca se promedian: el promedio
 * de dos tasas con denominadores distintos no es la tasa del conjunto. Un día
 * con 1 reserva y 1 falta (100%) y otro con 99 reservas y 0 faltas (0%) dan un
 * promedio de 50% y una tasa real del 1%.
 *
 * `activeMembers` y `overdueCents` son **fotos, no flujos**: se toma la del
 * último día del período. Sumarlas contaría diez veces al mismo socio y a la
 * misma deuda.
 */
export function summarize(days: readonly DayKpis[]): RangeKpis {
  const suma = (pick: (day: DayKpis) => number) =>
    days.reduce((total, day) => total + pick(day), 0);

  const ultimo = days.at(-1);
  const bookings = suma((day) => day.bookings);
  const capacity = suma((day) => day.capacity);
  const noShows = suma((day) => day.noShows);
  const attendances = suma((day) => day.attendances);
  const chargedCents = suma((day) => day.chargedCents);
  const activeMembers = ultimo?.activeMembers ?? 0;
  const overdueCents = ultimo?.overdueCents ?? 0;

  return {
    days: days.length,
    activeMembers,
    attendances,
    noShows,
    lateCancels: suma((day) => day.lateCancels),
    bookings,
    capacity,
    sessions: suma((day) => day.sessions),
    incomeCents: suma((day) => day.incomeCents),
    chargedCents,
    overdueCents,
    utilization: ratio(bookings, capacity),
    noShowRate: ratio(noShows, bookings),
    attendancesPerMember: ratio(attendances, activeMembers),
    delinquency: ratio(overdueCents, chargedCents),
  };
}

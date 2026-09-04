import { z } from 'zod';

/**
 * Fuente única de validación de Metrics, compartida front/back (ADR-003).
 *
 * Los números de acá los mira alguien que decide con ellos: si sube el precio,
 * si abre otro horario, si sale a buscar socios. Por eso el panel devuelve los
 * conteos crudos **además** de las tasas: quien no confía en un porcentaje
 * tiene que poder rehacerlo con una calculadora (§2.1.12).
 */

/** `YYYY-MM-DD` en la zona del centro, nunca en UTC. */
export const metricsDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha va en formato YYYY-MM-DD.');

const kpiCountsShape = {
  /** Foto al cierre del día, no un flujo: no se suma entre días. */
  activeMembers: z.number().int(),
  attendances: z.number().int(),
  noShows: z.number().int(),
  lateCancels: z.number().int(),
  /** Reservas que llegaron vivas a la clase: asistencias más faltas. */
  bookings: z.number().int(),
  capacity: z.number().int(),
  sessions: z.number().int(),
  incomeCents: z.number().int(),
  chargedCents: z.number().int(),
  /** Deuda vencida al cierre. También una foto. */
  overdueCents: z.number().int(),
  /** Inscriptos sobre cupo, 0 a 1. */
  utilization: z.number(),
  /** Faltas sobre reservas que llegaron a la clase, 0 a 1. */
  noShowRate: z.number(),
};

export const metricsDailySchema = z.object({
  venueId: z.string(),
  date: metricsDateSchema,
  ...kpiCountsShape,
});

export type MetricsDaily = z.infer<typeof metricsDailySchema>;

/** El resumen del período: sumas para los flujos, foto para los stocks. */
export const metricsRangeSchema = z.object({
  venueId: z.string(),
  from: metricsDateSchema,
  to: metricsDateSchema,
  days: z.number().int(),
  ...kpiCountsShape,
  /** Asistencias por socio activo. §2.1.12: menos de 2 por semana es alerta. */
  attendancesPerMember: z.number(),
  /** Deuda vencida sobre lo facturado en el período. */
  delinquency: z.number(),
  /** Día por día, para el gráfico. */
  daily: z.array(metricsDailySchema),
});

export type MetricsRange = z.infer<typeof metricsRangeSchema>;

/**
 * El rango que pide el panel. Sin fechas, los últimos 30 días: es la ventana
 * con la que se mira un negocio mensual.
 */
export const DEFAULT_METRICS_DAYS = 30;
export const MAX_METRICS_DAYS = 366;

export const metricsQuerySchema = z.object({
  venueId: z.string().min(1, 'Elegí la sede.'),
  from: metricsDateSchema.optional(),
  to: metricsDateSchema.optional(),
});

export type MetricsQuery = z.infer<typeof metricsQuerySchema>;

/**
 * Reprocesar un día pasado (§2.1.12). Existe porque los datos de un día pueden
 * cambiar después: un pago que se carga tarde, una asistencia que el coach
 * corrige al día siguiente.
 */
export const recomputeMetricsSchema = z.object({
  venueId: z.string().min(1, 'Elegí la sede.'),
  from: metricsDateSchema,
  /** Sin valor, se recalcula un solo día. */
  to: metricsDateSchema.optional(),
});

export type RecomputeMetricsInput = z.infer<typeof recomputeMetricsSchema>;

export const recomputeResultSchema = z.object({
  venueId: z.string(),
  recomputed: z.number().int(),
});

export type RecomputeResult = z.infer<typeof recomputeResultSchema>;

// ── El tablero del día (§5.1.2, §2.1.12) ────────────────────────────────────

/**
 * El home del DFSM es un tablero, no un menú. Lo que se ve al abrirlo tiene que
 * ser lo que hay que hacer hoy, no una lista de secciones para navegar.
 */
export const dashboardSessionSchema = z.object({
  sessionId: z.string(),
  name: z.string(),
  startAt: z.string(),
  /** Hora local del centro, `HH:mm`: es la que el staff lee de un vistazo. */
  startsAtLocal: z.string(),
  capacity: z.number().int(),
  booked: z.number().int(),
  checkedIn: z.number().int(),
  occupancy: z.number(),
  status: z.string(),
});

export type DashboardSession = z.infer<typeof dashboardSessionSchema>;

/**
 * Los cinco tipos de alerta de §2.1.12. Cada una lleva su acción: una alerta
 * que no se puede tocar es un dato, y los datos ya están en las métricas.
 */
export const ALERT_TYPES = [
  'inactive_members',
  'expiring_contracts',
  'debtors',
  'low_occupancy',
  'missing_waivers',
] as const;

export const alertTypeSchema = z.enum(ALERT_TYPES);
export type AlertType = z.infer<typeof alertTypeSchema>;

export const alertItemSchema = z.object({
  /** A qué lleva el toque: la ficha del socio o la clase. */
  id: z.string(),
  label: z.string(),
  /** El dato que explica por qué está en la lista. */
  detail: z.string(),
});

export type AlertItem = z.infer<typeof alertItemSchema>;

export const alertSchema = z.object({
  type: alertTypeSchema,
  count: z.number().int(),
  /** Los primeros, para mostrar sin abrir. El resto está en su pantalla. */
  items: z.array(alertItemSchema),
});

export type Alert = z.infer<typeof alertSchema>;

/** La plata del día. Ausente para quien no ve facturación (§2.1.12). */
export const dashboardMoneySchema = z.object({
  incomeCents: z.number().int(),
  overdueCents: z.number().int(),
  debtors: z.number().int(),
});

export type DashboardMoney = z.infer<typeof dashboardMoneySchema>;

export const dashboardSchema = z.object({
  venueId: z.string(),
  /** El día del centro, `YYYY-MM-DD`. */
  date: z.string(),
  sessions: z.array(dashboardSessionSchema),
  /** Cuántos entraron hoy, en toda la sede. */
  checkedIn: z.number().int(),
  booked: z.number().int(),
  /**
   * Presente solo si quien pregunta ve facturación. No es un `0` cuando no
   * corresponde: un cero se lee como "no entró plata", y lo que pasa es que
   * esa persona no tiene por qué saberlo.
   */
  money: dashboardMoneySchema.optional(),
  alerts: z.array(alertSchema),
});

export type Dashboard = z.infer<typeof dashboardSchema>;

export const dashboardQuerySchema = z.object({
  venueId: z.string().min(1, 'Elegí la sede.'),
});

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

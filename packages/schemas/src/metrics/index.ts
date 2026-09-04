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

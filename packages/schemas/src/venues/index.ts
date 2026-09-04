import { z } from 'zod';

/**
 * Fuente única de validación de Venues, compartida front/back (ADR-003).
 *
 * El Venue es la unidad de negocio (§2.1.6): dirección, marca, zona horaria,
 * moneda, caja y métricas propias. El límite del plan cuenta **Venues activos**,
 * no Rooms.
 */

/** IANA. Se valida contra el runtime, no contra una lista hardcodeada. */
export const timeZoneSchema = z.string().refine(
  (value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  },
  {
    message:
      'Zona horaria inválida. Usá un identificador IANA, como America/Argentina/Buenos_Aires.',
  },
);

/** ISO 4217. Solo ARS en V1 (§3.1), pero el campo existe desde el día 1. */
export const currencySchema = z.enum(['ARS']);

export const VENUE_STATES = ['active', 'archived'] as const;
export const venueStatusSchema = z.enum(VENUE_STATES);
export type VenueStatus = z.infer<typeof venueStatusSchema>;

/** `HH:mm` en la zona del Venue. */
export const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Usá el formato HH:mm, por ejemplo 07:00.');

/** 1 = lunes … 7 = domingo, como `Temporal.PlainDate.dayOfWeek`. */
export const weekdaySchema = z.number().int().min(1).max(7);

export const businessHoursSchema = z
  .object({
    weekday: weekdaySchema,
    opensAt: timeOfDaySchema,
    closesAt: timeOfDaySchema,
  })
  .refine((hours) => hours.opensAt < hours.closesAt, {
    message: 'El horario de cierre tiene que ser posterior al de apertura.',
    path: ['closesAt'],
  });

export type BusinessHours = z.infer<typeof businessHoursSchema>;

/**
 * Las cinco ventanas de §2.1.5.c, en minutos, más el flag de deuda de ADR-004.
 *
 * Se guardan en minutos y no como duraciones porque son configuración que el
 * SMU edita en un formulario: "2 horas antes" es `120`, y eso se suma y se
 * compara sin ambigüedad.
 */
export const bookingPolicyBaseSchema = z.object({
  /** Cuánto antes se abre la reserva. Default de §2.1.5.c: 7 días. */
  bookingOpensMinutesBefore: z
    .number()
    .int()
    .min(0)
    .max(90 * 24 * 60)
    .default(7 * 24 * 60),
  /** Cuánto antes se cierra. Default: 15 minutos. */
  bookingClosesMinutesBefore: z
    .number()
    .int()
    .min(0)
    .max(7 * 24 * 60)
    .default(15),
  /** Hasta cuándo se cancela sin perder el crédito. Default: 2 horas. */
  cancelCutoffMinutes: z
    .number()
    .int()
    .min(0)
    .max(7 * 24 * 60)
    .default(120),
  /** Desde cuándo ya no se promueve la lista de espera. Default: 30 minutos. */
  waitlistPromotionCutoffMinutes: z
    .number()
    .int()
    .min(0)
    .max(24 * 60)
    .default(30),
  /** Cuántos minutos antes abre el check-in. Default: 30. */
  checkInOpensMinutesBefore: z
    .number()
    .int()
    .min(0)
    .max(24 * 60)
    .default(30),
  /** Cuántos minutos después del inicio sigue abierto. Default: 30. */
  checkInClosesMinutesAfter: z
    .number()
    .int()
    .min(0)
    .max(24 * 60)
    .default(30),
  /**
   * ¿Puede reservar quien debe? ADR-004 decisión 2: configurable por Venue,
   * **default `false`**.
   */
  allowDebt: z.boolean().default(false),
  /**
   * ¿El check-in exige tener firmados los waivers obligatorios? Configurable
   * por Venue (§2.1.20). **Default `false`**: activarlo es una decisión del
   * centro, que en ese momento asume que sus socios van a tener cuenta en la
   * WAFM y sus documentos publicados — prenderlo de entrada bloquearía a
   * cualquier centro que todavía no migró a este flujo.
   */
  enforceWaivers: z.boolean().default(false),
  /** Cuántos no-shows habilitan el bloqueo temporal. `0` desactiva la política. */
  noShowThreshold: z.number().int().min(0).max(20).default(3),
  /**
   * En cuántos días se cuentan esas faltas. Contarlas desde siempre haría que
   * tres ausencias en tres años pesaran igual que tres en un mes.
   */
  noShowWindowDays: z.number().int().min(1).max(365).default(30),
  /** Cuánto dura ese bloqueo. Default: 48 horas (§2.1.5.d). */
  noShowBlockMinutes: z
    .number()
    .int()
    .min(0)
    .max(30 * 24 * 60)
    .default(48 * 60),
  /** Tamaño máximo de la lista de espera. */
  waitlistMaxSize: z.number().int().min(0).max(200).default(20),
  /**
   * Tope anual de días de congelamiento por contrato (§2.1.9). Default: 30.
   * `0` desactiva la función para el centro.
   */
  maxFreezeDaysPerYear: z.number().int().min(0).max(365).default(30),
  /** Cuánto tiene para confirmar quien es promovido. Default: 15 minutos. */
  waitlistHoldMinutes: z
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .default(15),
  /**
   * Qué pasa con el crédito de quien cancela tarde (§2.1.5.d). El default es el
   * de la tabla de §2.1.9: **no se devuelve**, porque el lugar ya no se puede
   * revender. `refund_and_notify` devuelve igual pero deja constancia.
   */
  lateCancelPolicy: z.enum(['no_refund', 'refund', 'refund_and_notify']).default('no_refund'),
});

/**
 * Lo que una categoría puede pisarle al centro (§2.1.5.c: "todas configurables
 * por Venue **y por categoría**").
 *
 * Solo las ventanas y la política de late cancel: la deuda, el tope de freeze y
 * el bloqueo por no-shows son del centro entero, y dejarlos por categoría haría
 * que la misma persona debiera plata para spinning y no para funcional.
 */
export const categoryBookingPolicySchema = bookingPolicyBaseSchema
  .pick({
    bookingOpensMinutesBefore: true,
    bookingClosesMinutesBefore: true,
    cancelCutoffMinutes: true,
    waitlistPromotionCutoffMinutes: true,
    checkInOpensMinutesBefore: true,
    checkInClosesMinutesAfter: true,
    lateCancelPolicy: true,
  })
  .partial();

export type CategoryBookingPolicy = z.infer<typeof categoryBookingPolicySchema>;

export const bookingPolicySchema = bookingPolicyBaseSchema
  .extend({
    /** Excepciones por categoría, indexadas por `categoryId`. */
    categoryPolicies: z.record(z.string(), categoryBookingPolicySchema).default({}),
  })
  .refine((policy) => policy.bookingOpensMinutesBefore > policy.bookingClosesMinutesBefore, {
    // Si el cierre fuera antes que la apertura, la clase nunca sería reservable.
    message: 'El cierre de reservas no puede ser antes de la apertura.',
    path: ['bookingClosesMinutesBefore'],
  });

export type BookingPolicy = z.infer<typeof bookingPolicySchema>;

/** Los defaults de §2.1.5.c, ya resueltos. */
export const DEFAULT_BOOKING_POLICY: BookingPolicy = bookingPolicySchema.parse({});

/**
 * La política que rige para una categoría: la del centro con su excepción
 * encima (§2.1.5.c).
 *
 * Vive acá y no en un módulo del backend porque la consultan tres lugares —la
 * reserva, el check-in y la pantalla que le muestra al socio hasta cuándo puede
 * cancelar—, y tres copias de la regla de mezcla son tres formas de que a
 * alguien le aparezca un horario distinto del que le van a aplicar.
 */
export function effectiveBookingPolicy(
  venue: BookingPolicy,
  categoryId?: string | undefined,
): BookingPolicy {
  const excepcion = categoryId === undefined ? undefined : venue.categoryPolicies[categoryId];
  if (!excepcion) return venue;

  // `undefined` no pisa: una categoría que solo cambia el corte de cancelación
  // no puede borrarle el resto de la configuración al centro.
  const definidas = Object.fromEntries(
    Object.entries(excepcion).filter(([, valor]) => valor !== undefined),
  );

  return { ...venue, ...definidas };
}

export const venueBrandingSchema = z.object({
  logoUrl: z.string().url().optional(),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Usá un color en formato #RRGGBB.')
    .optional(),
});

export const createVenueSchema = z.object({
  name: z.string().trim().min(2, 'El nombre tiene que tener al menos 2 caracteres.').max(80),
  address: z.string().trim().min(5, 'Cargá la dirección completa.').max(200),
  phone: z.string().trim().min(6).max(30).optional(),
  timeZone: timeZoneSchema,
  currency: currencySchema.default('ARS'),
  businessHours: z.array(businessHoursSchema).max(7).default([]),
  bookingPolicy: bookingPolicySchema.optional(),
  branding: venueBrandingSchema.optional(),
  geo: z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .optional(),
});

export type CreateVenueInput = z.infer<typeof createVenueSchema>;

/** Todo opcional: un PATCH cambia lo que le mandan y nada más. */
export const updateVenueSchema = createVenueSchema.partial();
export type UpdateVenueInput = z.infer<typeof updateVenueSchema>;

export const venueSchema = z.object({
  publicId: z.string(),
  name: z.string(),
  address: z.string(),
  phone: z.string().optional(),
  timeZone: z.string(),
  currency: currencySchema,
  businessHours: z.array(businessHoursSchema),
  bookingPolicy: bookingPolicySchema,
  branding: venueBrandingSchema.optional(),
  geo: z.object({ lat: z.number(), lng: z.number() }).optional(),
  status: venueStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Venue = z.infer<typeof venueSchema>;

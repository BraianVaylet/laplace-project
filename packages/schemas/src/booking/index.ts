import { z } from 'zod';

/**
 * Fuente única de validación de Booking, compartida front/back (ADR-003).
 *
 * El corazón del producto y su condición de carrera clásica: dos personas
 * tomando el último lugar a las 6:00 de la mañana.
 */

/** §14. */
export const BOOKING_STATES = [
  'booked',
  'waitlisted',
  'checked_in',
  'cancelled',
  'late_cancelled',
  'no_show',
] as const;

export const bookingStatusSchema = z.enum(BOOKING_STATES);
export type BookingStatus = z.infer<typeof bookingStatusSchema>;

/**
 * Transiciones válidas.
 *
 * `cancelled`, `late_cancelled` y `no_show` son terminales: si el socio quiere
 * volver a esa clase, reserva de nuevo — y ahí se vuelve a evaluar el cupo, que
 * en el medio puede haberse llenado.
 */
export const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  booked: ['checked_in', 'cancelled', 'late_cancelled', 'no_show'],
  // De la lista de espera se pasa a reservado cuando se libera un lugar (F1-16).
  waitlisted: ['booked', 'cancelled'],
  checked_in: [],
  cancelled: [],
  late_cancelled: [],
  no_show: [],
};

export const createBookingSchema = z.object({
  sessionId: z.string().min(1, 'Elegí la clase.'),
  /**
   * Para quién. El socio que reserva para sí mismo no lo manda; el mostrador
   * que reserva para otro, sí — y necesita el permiso `booking.createForOther`.
   */
  memberId: z.string().optional(),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export const bookingSchema = z.object({
  publicId: z.string(),
  sessionId: z.string(),
  memberId: z.string(),
  venueId: z.string(),
  /** De qué contrato salió el crédito. Ausente si entró sin consumir (membresía). */
  contractId: z.string().optional(),
  status: bookingStatusSchema,
  /** El lugar en la fila cuando quedó en lista de espera. */
  waitlistPosition: z.number().int().nullable(),
  bookedAt: z.string(),
  createdAt: z.string(),
});

export type Booking = z.infer<typeof bookingSchema>;

/** Lo que ve el socio al reservar: si entró o quedó en la fila, y de dónde salió el crédito. */
export const bookingResultSchema = z.object({
  booking: bookingSchema,
  /** Por qué se eligió ese contrato (§2.1.9). Ausente si no consumió crédito. */
  consumption: z
    .object({
      contractId: z.string(),
      productName: z.string(),
      creditsLeft: z.number().int().nullable(),
      reason: z.string(),
    })
    .optional(),
});

export type BookingResult = z.infer<typeof bookingResultSchema>;

/**
 * Cancelar fuera de plazo pierde el crédito (§2.1.9), así que el pedido lleva
 * la confirmación explícita: la primera vez el backend responde
 * `LP-BOOK-422-004` explicando qué se pierde, y recién con el `true` cancela.
 *
 * No es una fricción de más: la regla ya existe igual, y enterarse después de
 * cancelar es lo que hace que el centro parezca arbitrario (§2.1.5.d).
 */
export const cancelBookingSchema = z.object({
  acceptsLateCancel: z.boolean().default(false),
});

export type CancelBookingInput = z.infer<typeof cancelBookingSchema>;

/** Lo que la app le muestra al socio **antes** de confirmar la reserva. */
export const bookingPolicyViewSchema = z.object({
  sessionId: z.string(),
  /** Desde cuándo y hasta cuándo se puede reservar esta clase. */
  opensAt: z.string(),
  closesAt: z.string(),
  /** Hasta cuándo se cancela sin perder el crédito. */
  cancelCutoffAt: z.string(),
  lateCancelPolicy: z.enum(['no_refund', 'refund', 'refund_and_notify']),
  /** El texto en es-AR, ya resuelto en la hora del centro. */
  text: z.string(),
  canBookNow: z.boolean(),
});

export type BookingPolicyView = z.infer<typeof bookingPolicyViewSchema>;

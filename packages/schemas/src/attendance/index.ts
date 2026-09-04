import { z } from 'zod';

/**
 * Fuente única de validación de Attendance, compartida front/back (ADR-003).
 *
 * La lista de clase es la pantalla que el coach usa **de pie, con una mano**, en
 * el piso del box (§5.1.2). Todo lo que devuelve está pensado para eso: pocos
 * datos, ya resueltos, sin que la app tenga que cruzar nada.
 */
export const CHECK_IN_METHODS = ['self', 'staff', 'kiosk'] as const;

export const checkInMethodSchema = z.enum(CHECK_IN_METHODS);
export type CheckInMethod = z.infer<typeof checkInMethodSchema>;

export const checkInSchema = z.object({
  /** Quién lo registró. Del mostrador o del coach es `staff`; el QR es `self`. */
  method: checkInMethodSchema.default('staff'),
});

export type CheckInInput = z.infer<typeof checkInSchema>;

/**
 * Las alertas que el coach ve al lado del nombre (§2.1.18).
 *
 * Son códigos y no textos: el mismo dato lo muestran la lista del coach y la
 * ficha del socio, y traducirlo en el backend obligaría a cambiar la API para
 * cambiar una palabra.
 */
export const ROSTER_ALERTS = ['debt', 'waiver_missing', 'first_class', 'health_note'] as const;

export const rosterAlertSchema = z.enum(ROSTER_ALERTS);
export type RosterAlert = z.infer<typeof rosterAlertSchema>;

export const rosterEntrySchema = z.object({
  bookingId: z.string(),
  memberId: z.string(),
  fullName: z.string(),
  status: z.enum(['booked', 'checked_in', 'waitlisted']),
  waitlistPosition: z.number().int().nullable(),
  checkedInAt: z.string().nullable(),
  checkInMethod: checkInMethodSchema.nullable(),
  alerts: z.array(rosterAlertSchema),
});

export type RosterEntry = z.infer<typeof rosterEntrySchema>;

export const classRosterSchema = z.object({
  sessionId: z.string(),
  name: z.string(),
  startAt: z.string(),
  endAt: z.string(),
  /** La zona del centro: la app muestra la hora del box, no la del teléfono. */
  timeZone: z.string(),
  capacity: z.number().int(),
  /** Cuántos anotados, cuántos ya entraron y cuántos esperan. */
  bookedCount: z.number().int(),
  presentCount: z.number().int(),
  waitlistCount: z.number().int(),
  /** Si el check-in está abierto ahora, y desde/hasta cuándo. */
  checkInOpen: z.boolean(),
  checkInOpensAt: z.string(),
  checkInClosesAt: z.string(),
  entries: z.array(rosterEntrySchema),
});

export type ClassRoster = z.infer<typeof classRosterSchema>;

/** Lo que devuelve un check-in: el ingreso ya registrado. */
export const checkInResultSchema = z.object({
  bookingId: z.string(),
  sessionId: z.string(),
  memberId: z.string(),
  status: z.string(),
  checkedInAt: z.string().nullable(),
  checkInMethod: checkInMethodSchema.nullable(),
});

export type CheckInResult = z.infer<typeof checkInResultSchema>;

/**
 * El QR del socio (§2.1.18).
 *
 * Vale **30 segundos y un solo uso**: la captura de pantalla que se comparte por
 * WhatsApp no tiene que servir para entrar. La app lo renueva sola mientras la
 * pantalla está abierta.
 */
export const qrTokenSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
  expiresInSeconds: z.number().int(),
});

export type QrToken = z.infer<typeof qrTokenSchema>;

export const redeemQrSchema = z.object({
  token: z.string().min(16, 'Ese código no parece un QR de Laplace.'),
  /**
   * La clase, si la tablet la sabe. Sin esto la resuelve el backend: pedirle a
   * la puerta que sepa qué clase corre ahora sería reconfigurarla cada vez que
   * cambia el horario.
   */
  sessionId: z.string().optional(),
});

export type RedeemQrInput = z.infer<typeof redeemQrSchema>;

/** El walk-in: entra sin reserva y el crédito se descuenta acá (§2.1.9). */
export const walkInSchema = z.object({
  memberId: z.string().min(1, 'Elegí a quién estás registrando.'),
});

export type WalkInInput = z.infer<typeof walkInSchema>;

/**
 * El resultado de marcar a todos presentes de un toque.
 *
 * Los que no entraron vienen con su motivo: si el coach toca "todos" y dos
 * quedan afuera en silencio, se entera cuando el socio reclama.
 */
export const bulkCheckInResultSchema = z.object({
  checkedIn: z.number().int(),
  skipped: z.array(z.object({ bookingId: z.string(), memberId: z.string(), code: z.string() })),
});

export type BulkCheckInResult = z.infer<typeof bulkCheckInResultSchema>;

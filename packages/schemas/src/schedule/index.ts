import { z } from 'zod';
import { timeOfDaySchema, weekdaySchema } from '../venues/index.js';

/**
 * Fuente única de validación de Schedule, compartida front/back (ADR-003).
 *
 * La agenda del centro (§2.1.5.a): plantillas recurrentes y las sesiones
 * concretas que un job materializa a partir de ellas.
 */

/**
 * La regla de recurrencia.
 *
 * Es el subconjunto `FREQ=WEEKLY;BYDAY;BYHOUR` de RFC 5545, que es la forma que
 * de verdad tiene una grilla de clases: "lunes a viernes a las 7:00". Modelarla
 * nativa en vez de guardar un string RRULE hace que el expansor no tenga que
 * parsear nada y que el formulario del SMU sea seis campos, no una gramática.
 *
 * Ensancharla más adelante (mensual, por día del mes) es aditivo: se suma un
 * `freq` y el expansor crece con un caso.
 */
export const RECURRENCE_FREQUENCIES = ['weekly'] as const;
export const recurrenceFrequencySchema = z.enum(RECURRENCE_FREQUENCIES);

export const recurrenceSchema = z
  .object({
    freq: recurrenceFrequencySchema.default('weekly'),
    /** 1 = lunes … 7 = domingo, como `Temporal.PlainDate.dayOfWeek`. */
    byWeekday: z
      .array(weekdaySchema)
      .min(1, 'Elegí al menos un día de la semana.')
      .max(7)
      .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
    /** Hora local del centro. La clase de las 7:00 es a las 7:00 todo el año. */
    timeOfDay: timeOfDaySchema,
    /** Cada cuántas semanas se repite. 1 = todas. */
    interval: z.number().int().min(1).max(12).default(1),
    /** Desde cuándo vale. `YYYY-MM-DD` en la zona del Venue. */
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usá el formato AAAA-MM-DD.'),
    /** Hasta cuándo. Sin valor, no termina. */
    until: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Usá el formato AAAA-MM-DD.')
      .optional(),
  })
  .refine((rule) => rule.until === undefined || rule.until >= rule.from, {
    message: 'La vigencia no puede terminar antes de empezar.',
    path: ['until'],
  });

export type Recurrence = z.infer<typeof recurrenceSchema>;

export const createClassTemplateSchema = z.object({
  venueId: z.string().min(1, 'Elegí la sede.'),
  roomId: z.string().min(1, 'Elegí la sala.'),
  name: z.string().trim().min(2, 'Cargá el nombre de la clase.').max(80),
  /** La disciplina. Es lo que después habilita o bloquea un pack (§2.1.9). */
  categoryId: z.string().trim().min(1, 'Elegí la categoría.').max(40),
  durationMin: z
    .number()
    .int('La duración se mide en minutos enteros.')
    .min(5, 'Una clase de menos de 5 minutos no es una clase.')
    .max(480),
  /** Cupo por default. Sin valor, hereda el de la sala (§2.1.5.b). */
  capacity: z.number().int().min(1).max(500).optional(),
  coachId: z.string().optional(),
  recurrence: recurrenceSchema,
});

export type CreateClassTemplateInput = z.infer<typeof createClassTemplateSchema>;

/** El horario y la sala no se editan en la plantilla: eso es F1-13. */
export const updateClassTemplateSchema = createClassTemplateSchema
  .omit({ venueId: true, roomId: true })
  .partial();

export type UpdateClassTemplateInput = z.infer<typeof updateClassTemplateSchema>;

export const classTemplateSchema = z.object({
  publicId: z.string(),
  venueId: z.string(),
  roomId: z.string(),
  name: z.string(),
  categoryId: z.string(),
  durationMin: z.number().int(),
  capacity: z.number().int().optional(),
  coachId: z.string().optional(),
  recurrence: recurrenceSchema,
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ClassTemplate = z.infer<typeof classTemplateSchema>;

/** §14. */
export const SESSION_STATES = [
  'draft',
  'scheduled',
  'in_progress',
  'completed',
  'cancelled',
] as const;
export const sessionStatusSchema = z.enum(SESSION_STATES);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const SESSION_TRANSITIONS: Record<SessionStatus, readonly SessionStatus[]> = {
  draft: ['scheduled', 'cancelled'],
  scheduled: ['in_progress', 'completed', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  // Una clase que ya pasó no vuelve: si hubo un error, se corrige el registro.
  completed: [],
  cancelled: [],
};

/** Alta manual de una clase suelta, fuera de toda plantilla. */
export const createSessionSchema = z.object({
  venueId: z.string().min(1, 'Elegí la sede.'),
  roomId: z.string().min(1, 'Elegí la sala.'),
  name: z.string().trim().min(2).max(80),
  categoryId: z.string().trim().min(1).max(40),
  startAt: z.string().datetime({ offset: true }),
  durationMin: z.number().int().min(5).max(480),
  capacity: z.number().int().min(1).max(500).optional(),
  coachId: z.string().optional(),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;

export const classSessionSchema = z.object({
  publicId: z.string(),
  venueId: z.string(),
  roomId: z.string(),
  templateId: z.string().optional(),
  name: z.string(),
  categoryId: z.string(),
  startAt: z.string(),
  endAt: z.string(),
  capacity: z.number().int(),
  bookedCount: z.number().int(),
  waitlistCount: z.number().int(),
  coachId: z.string().optional(),
  status: sessionStatusSchema,
  createdAt: z.string(),
});

export type ClassSession = z.infer<typeof classSessionSchema>;

/** Cuántos días hacia adelante materializa el job (§2.1.5.a). */
export const MATERIALIZATION_WINDOW_DAYS = 60;

/**
 * Edición de una sesión concreta. **Afecta solo a esa sesión** (§2.1.5.a): es la
 * mitad "solo esta" del comportamiento tipo Google Calendar.
 *
 * La sala no está: mover una clase de sala puede chocar con otra, y ese cambio
 * pasa por el alta, que valida la colisión.
 */
export const updateSessionSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  categoryId: z.string().trim().min(1).max(40).optional(),
  capacity: z.number().int().min(1).max(500).optional(),
  coachId: z.string().optional(),
});

export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;

/**
 * El alcance de una edición de plantilla (§2.1.5.a).
 *
 * `template_only` cambia la plantilla y deja la grilla ya publicada como está;
 * `this_and_future` la propaga a las clases que todavía no empezaron. **Las
 * pasadas nunca se tocan**: son el histórico de lo que de verdad ocurrió.
 */
export const EDIT_SCOPES = ['template_only', 'this_and_future'] as const;
export const editScopeSchema = z.enum(EDIT_SCOPES);
export type EditScope = z.infer<typeof editScopeSchema>;

export const cancelSessionSchema = z.object({
  reason: z.string().trim().min(5, 'Escribí el motivo de la cancelación.').max(300),
});

export type CancelSessionInput = z.infer<typeof cancelSessionSchema>;

/**
 * Un feriado o un cierre del centro (§2.1.5.a). Cancela en bloque todas las
 * clases del rango.
 */
export const createClosureSchema = z
  .object({
    venueId: z.string().min(1, 'Elegí la sede.'),
    /** `YYYY-MM-DD` en la zona del Venue, inclusive. */
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usá el formato AAAA-MM-DD.'),
    /** Inclusive: un feriado de un día tiene `from` y `to` iguales. */
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usá el formato AAAA-MM-DD.'),
    reason: z.string().trim().min(3, 'Escribí el motivo del cierre.').max(200),
  })
  .refine((closure) => closure.to >= closure.from, {
    message: 'El cierre no puede terminar antes de empezar.',
    path: ['to'],
  });

export type CreateClosureInput = z.infer<typeof createClosureSchema>;

export const venueClosureSchema = z.object({
  publicId: z.string(),
  venueId: z.string(),
  from: z.string(),
  to: z.string(),
  reason: z.string(),
  /** Cuántas clases canceló al declararse. */
  cancelledSessions: z.number().int(),
  createdAt: z.string(),
});

export type VenueClosure = z.infer<typeof venueClosureSchema>;

/**
 * Copiar la grilla de una semana a otra (§2.1.5.a). Es lo que usa el centro que
 * arma el horario a mano en vez de con plantillas.
 */
export const duplicateWeekSchema = z.object({
  venueId: z.string().min(1, 'Elegí la sede.'),
  /** Lunes de la semana que se copia, `YYYY-MM-DD`. */
  fromWeek: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usá el formato AAAA-MM-DD.'),
  /** Lunes de la semana destino. */
  toWeek: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usá el formato AAAA-MM-DD.'),
});

export type DuplicateWeekInput = z.infer<typeof duplicateWeekSchema>;

export const duplicateWeekResultSchema = z.object({
  created: z.number().int(),
  /** Las que no se copiaron y por qué: feriado, colisión o ya existían. */
  skipped: z.array(z.object({ startAt: z.string(), reason: z.string() })),
});

export type DuplicateWeekResult = z.infer<typeof duplicateWeekResultSchema>;

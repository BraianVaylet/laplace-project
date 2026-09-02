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

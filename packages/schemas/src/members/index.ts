import { z } from 'zod';

/**
 * Fuente única de validación de Members, compartida front/back (ADR-003).
 *
 * El socio es la entidad sobre la que gira el resto del producto: contratos,
 * reservas, asistencia y cobranza cuelgan de acá.
 */

/** §14. El orden es el del embudo, de la primera consulta al archivo. */
export const MEMBER_STATES = [
  'lead',
  'trial',
  'active',
  'at_risk',
  'inactive',
  'archived',
] as const;
export const memberStatusSchema = z.enum(MEMBER_STATES);
export type MemberStatus = z.infer<typeof memberStatusSchema>;

/**
 * Transiciones válidas. §14: los estados cambian **solo** por transición
 * explícita y validada, nunca con un `update` libre del campo.
 *
 * No se vuelve a `lead` ni a `trial`: la prueba es una vez por persona (§2.1.17),
 * y permitir el regreso a `trial` sería la forma más fácil de regalar clases.
 * Sí se vuelve a `active` desde cualquier lado, porque en un centro la gente se
 * va y vuelve todo el tiempo.
 */
export const MEMBER_TRANSITIONS: Record<MemberStatus, readonly MemberStatus[]> = {
  lead: ['trial', 'active', 'inactive', 'archived'],
  trial: ['active', 'inactive', 'archived'],
  active: ['at_risk', 'inactive', 'archived'],
  at_risk: ['active', 'inactive', 'archived'],
  inactive: ['active', 'archived'],
  archived: ['active'],
};

/**
 * Con los que puede nacer una ficha. A `at_risk` y a `archived` se llega, no se
 * arranca: dar de alta a alguien "en riesgo" no significa nada.
 */
export const MEMBER_INITIAL_STATES = ['lead', 'trial', 'active'] as const;
export const memberInitialStatusSchema = z.enum(MEMBER_INITIAL_STATES);

/** `YYYY-MM-DD`. Fecha de calendario, no instante: un cumpleaños no tiene hora ni zona. */
export const plainDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Usá el formato AAAA-MM-DD.')
  .refine(isRealDate, 'Esa fecha no existe.');

/**
 * ¿Existe ese día en el calendario? Se cuenta a mano en vez de con `Date`
 * porque el paquete de schemas no depende de nada más que Zod, y `Date` está
 * prohibido en el proyecto (§6): interpreta la zona horaria y "2026-02-31" se
 * convierte solo en el 3 de marzo, en vez de fallar.
 */
function isRealDate(value: string): boolean {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  if (month < 1 || month > 12 || day < 1) return false;

  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  return day <= (daysInMonth[month - 1] as number);
}

/** Mayoría de edad en Argentina (Código Civil y Comercial, art. 25). */
export const ADULT_AGE = 18;

/** ¿Era menor en esa fecha? Ambas fechas en `YYYY-MM-DD`. */
export function isMinorOn(birthDate: string, on: string): boolean {
  const [by, bm, bd] = birthDate.split('-').map(Number) as [number, number, number];
  const [oy, om, od] = on.split('-').map(Number) as [number, number, number];

  // Se compara la fecha del cumpleaños número 18 con la de referencia: restar
  // años y "corregir" el mes se equivoca justo el día del cumpleaños.
  const adultOn = [by + ADULT_AGE, bm, bd] as const;
  const reference = [oy, om, od] as const;

  for (let i = 0; i < 3; i += 1) {
    if (reference[i] !== adultOn[i]) return (reference[i] as number) < (adultOn[i] as number);
  }

  return false;
}

/**
 * El documento se guarda solo con dígitos y letras: "40.123.456" y "40123456"
 * son la misma persona, y sin normalizar el único por documento no detecta el
 * duplicado. Vacío se convierte en `undefined` para que el índice parcial lo
 * ignore: dos cadenas vacías chocarían entre sí.
 */
export const docIdSchema = z
  .string()
  .transform((value) => value.replace(/[^0-9a-zA-Z]/g, ''))
  .transform((value) => (value.length === 0 ? undefined : value))
  .refine((value) => value === undefined || value.length >= 5, {
    message: 'El documento parece incompleto.',
  })
  .refine((value) => value === undefined || value.length <= 20, {
    message: 'El documento es demasiado largo.',
  });

const phoneSchema = z.string().trim().min(6, 'Cargá un teléfono válido.').max(30);

export const contactSchema = z.object({
  fullName: z.string().trim().min(2).max(80),
  phone: phoneSchema,
  relationship: z.string().trim().min(2).max(40).optional(),
});

/** El tutor de un menor. Sin teléfono no sirve: existe para una urgencia. */
export const guardianSchema = contactSchema;

/** Etiquetas libres del centro. Se normalizan para que "Mañana" y "mañana" sean una. */
const tagsSchema = z
  .array(z.string().trim().min(1).max(30))
  .max(20)
  .default([])
  .transform((tags) => [...new Set(tags.map((tag) => tag.toLocaleLowerCase('es-AR')))]);

export const memberNoteSchema = z.object({
  text: z.string().trim().min(1, 'Escribí la nota.').max(2000),
});

export type MemberNoteInput = z.infer<typeof memberNoteSchema>;

export const createMemberSchema = z.object({
  /** Un socio puede pertenecer a varias sedes del mismo suscriptor (§1.1). */
  venueIds: z.array(z.string()).min(1, 'Elegí al menos una sede.').max(20),
  firstName: z.string().trim().min(2, 'Cargá el nombre.').max(60),
  lastName: z.string().trim().min(2, 'Cargá el apellido.').max(60),
  docId: docIdSchema.optional(),
  phone: phoneSchema.optional(),
  email: z.string().trim().toLowerCase().email('Revisá el email.').optional(),
  birthDate: plainDateSchema.optional(),
  emergencyContact: contactSchema.optional(),
  /** Obligatorio si es menor de edad (§2.1.7). Lo valida el servicio, que sabe qué día es hoy. */
  guardian: guardianSchema.optional(),
  status: memberInitialStatusSchema.default('lead'),
  tags: tagsSchema,
});

export type CreateMemberInput = z.infer<typeof createMemberSchema>;

/**
 * El estado **no** se edita acá: se cambia por transición (§14). Los flags
 * `debtor` y `suspended` tampoco: los pone el sistema (mora, sanción), no el
 * formulario.
 */
export const updateMemberSchema = createMemberSchema.omit({ status: true }).partial();
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

export const memberFlagsSchema = z.object({
  /** Debe plata. Lo pone Billing (F1-11), no el staff a mano. */
  debtor: z.boolean(),
  /** Sancionado: no puede reservar aunque tenga créditos. */
  suspended: z.boolean(),
});

export type MemberFlags = z.infer<typeof memberFlagsSchema>;

/**
 * Lo que sale por la API. Es una **lista blanca**: un campo sensible que se
 * agregue mañana al documento no se filtra por olvido.
 *
 * Sin `notes`: las notas internas del staff nunca son visibles para el miembro
 * (§2.1.7) y viajan por su propio endpoint, con su propio permiso.
 */
export const memberResponseSchema = z.object({
  publicId: z.string(),
  venueIds: z.array(z.string()),
  firstName: z.string(),
  lastName: z.string(),
  docId: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  birthDate: z.string().optional(),
  emergencyContact: contactSchema.optional(),
  guardian: guardianSchema.optional(),
  status: memberStatusSchema,
  flags: memberFlagsSchema,
  tags: z.array(z.string()),
  /**
   * Saldo en centavos. Negativo = debe. Lo maneja Billing (F1-10).
   *
   * 🔴 `null` cuando quien pregunta no puede ver plata (§2.1.12). El coach abre
   * la ficha todos los días para saber si el socio puede entrenar; cuánto debe
   * no es asunto suyo, y mandarlo igual para que el front lo esconda es
   * mandarlo.
   */
  balanceCents: z.number().int().nullable(),
  joinedAt: z.string(),
  lastAttendanceAt: z.string().nullable(),
  /** Faltas acumuladas y bloqueo por ausencias (§2.1.5.d). Lo maneja Booking. */
  noShowCount: z.number().int(),
  bookingBlockedUntil: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type MemberResponse = z.infer<typeof memberResponseSchema>;

/** Una nota como la ve el staff. Nunca sale por la WAFM. */
export const memberNoteResponseSchema = z.object({
  publicId: z.string(),
  text: z.string(),
  authorId: z.string(),
  createdAt: z.string(),
});

export type MemberNoteResponse = z.infer<typeof memberNoteResponseSchema>;

/**
 * El buscador global del DFSM (§5.1.2). Devuelve lo justo para la lista de
 * resultados: quién es y cómo reconocerlo. La ficha entera se abre después.
 */
export const memberSearchQuerySchema = z.object({
  q: z.string().trim().min(2, 'Escribí al menos dos letras.').max(80),
});

export type MemberSearchQuery = z.infer<typeof memberSearchQuerySchema>;

export const memberSearchHitSchema = z.object({
  memberId: z.string(),
  fullName: z.string(),
  /** Documento, teléfono o mail: lo que sirva para distinguir dos homónimos. */
  hint: z.string(),
});

export type MemberSearchHit = z.infer<typeof memberSearchHitSchema>;

/**
 * La ficha 360 del socio (§2.1.7). Es la pantalla más usada del DFSM: si
 * obliga a navegar a otras cinco, el producto se siente lento aunque la API
 * conteste rápido.
 *
 * 🔴 **Acá no viene plata.** El estado de cuenta y la deuda tienen su propio
 * endpoint con su propio permiso (`billing:read`), así que el coach —que abre
 * esta pantalla todos los días— recibe un 403 al pedirlo, en vez de recibir la
 * deuda y confiar en que el front la esconda.
 */
export const memberContractViewSchema = z.object({
  contractId: z.string(),
  productName: z.string(),
  productType: z.string(),
  status: z.string(),
  creditsLeft: z.number().int().nullable(),
  creditsTotal: z.number().int().nullable(),
  endsAt: z.string().nullable(),
  daysLeft: z.number().int().nullable(),
});

export type MemberContractView = z.infer<typeof memberContractViewSchema>;

export const memberBookingViewSchema = z.object({
  bookingId: z.string(),
  sessionId: z.string(),
  className: z.string(),
  startAt: z.string(),
  status: z.string(),
});

export type MemberBookingView = z.infer<typeof memberBookingViewSchema>;

/** Los últimos 90 días, que es la ventana que le sirve al mostrador (§2.1.7). */
export const memberAttendanceViewSchema = z.object({
  windowDays: z.number().int(),
  attended: z.number().int(),
  noShows: z.number().int(),
  lastAttendanceAt: z.string().nullable(),
  /** Días sin venir. `null` si nunca vino: no es lo mismo que "vino hoy". */
  daysSinceLastVisit: z.number().int().nullable(),
});

export type MemberAttendanceView = z.infer<typeof memberAttendanceViewSchema>;

export const memberWaiverViewSchema = z.object({
  documentId: z.string(),
  title: z.string(),
  version: z.number().int(),
  acceptedAt: z.string(),
  /** Si el centro publicó una versión nueva, lo firmado ya no alcanza. */
  outdated: z.boolean(),
});

export type MemberWaiverView = z.infer<typeof memberWaiverViewSchema>;

export const memberOverviewSchema = z.object({
  memberId: z.string(),
  contracts: z.array(memberContractViewSchema),
  upcomingBookings: z.array(memberBookingViewSchema),
  attendance: memberAttendanceViewSchema,
  waivers: z.array(memberWaiverViewSchema),
});

export type MemberOverview = z.infer<typeof memberOverviewSchema>;

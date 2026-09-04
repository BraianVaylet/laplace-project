import { z } from 'zod';

/**
 * Fuente única de validación de Suscriptors y Suscriptions (§2.1.3, §2.1.4),
 * compartida front/back (ADR-003).
 *
 * Es el módulo del que depende que el producto cobre. La regla que más importa
 * de acá no es una validación sino una promesa: **nunca se borra por falta de
 * pago** (§2.1.3). Un suscriptor suspendido conserva sus socios y su agenda.
 */

/** §14. `blocked` es decisión del SAU; `suspended` es consecuencia del impago. */
export const SUBSCRIBER_STATUSES = [
  'trial',
  'active',
  'past_due',
  'suspended',
  'cancelled',
  'blocked',
] as const;

export const subscriberStatusSchema = z.enum(SUBSCRIBER_STATUSES);
export type SubscriberStatus = z.infer<typeof subscriberStatusSchema>;

/**
 * Las transiciones válidas. Se cambia solo por acá (§14).
 *
 * `suspended → active` existe porque el que paga vuelve; `cancelled` y
 * `blocked` no vuelven solos — de ahí se sale por decisión explícita del SAU,
 * que es otra operación y otro permiso.
 */
export const SUBSCRIBER_TRANSITIONS: Record<SubscriberStatus, SubscriberStatus[]> = {
  trial: ['active', 'suspended', 'cancelled', 'blocked'],
  active: ['past_due', 'cancelled', 'blocked'],
  past_due: ['active', 'suspended', 'cancelled', 'blocked'],
  suspended: ['active', 'cancelled', 'blocked'],
  cancelled: ['active'],
  blocked: ['active'],
};

/** §2.1.4: ARS desde el día uno, con el campo listo para cuando haya otra. */
export const CURRENCIES = ['ARS'] as const;
export const subscriptionCurrencySchema = z.enum(CURRENCIES);

/** ADR-004: catorce días, sin tarjeta. */
export const TRIAL_DAYS = 14;

// ── Planes ──────────────────────────────────────────────────────────────────

export const planIdSchema = z.enum(['basic', 'pro', 'max']);
export type SubscriptionPlanId = z.infer<typeof planIdSchema>;

/** El orden que decide si un cambio de plan es upgrade o downgrade. */
export const PLAN_RANK: Record<SubscriptionPlanId, number> = { basic: 1, pro: 2, max: 3 };

export const planSchema = z.object({
  planId: planIdSchema,
  name: z.string(),
  /** Precio vigente, en centavos enteros. El que ya está suscripto no lo mira. */
  priceCents: z.number().int().min(0),
  currency: subscriptionCurrencySchema,
  description: z.string(),
  /** Lo que la landing muestra como incluido. */
  highlights: z.array(z.string()),
});

export type Plan = z.infer<typeof planSchema>;

export const updatePlanPriceSchema = z.object({
  priceCents: z.number().int().min(0, 'El precio no puede ser negativo.'),
  /**
   * §2.1.4: subir un precio exige avisar 30 días antes. La fecha desde la que
   * rige se guarda para poder probar que el aviso salió a tiempo.
   */
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha va en formato YYYY-MM-DD'),
});

export type UpdatePlanPriceInput = z.infer<typeof updatePlanPriceSchema>;

// ── Alta self-service ───────────────────────────────────────────────────────

/**
 * Lo que pide la landing para arrancar (§2.1.3). **No pide tarjeta**
 * (ADR-004): pedirla en el alta es la forma más rápida de perder al que quería
 * probar el producto.
 */
export const signUpSubscriberSchema = z.object({
  centerName: z.string().trim().min(2, 'Poné el nombre de tu centro.').max(80),
  /** El slug de la organización. Se deriva del nombre si no viene. */
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/, 'Solo letras, números y guiones.')
    .min(2)
    .max(60)
    .optional(),
  planId: planIdSchema.default('pro'),
  /** La zona del centro: el trial vence en su calendario, no en el del servidor. */
  timeZone: z.string().min(1).default('America/Argentina/Buenos_Aires'),
});

export type SignUpSubscriberInput = z.infer<typeof signUpSubscriberSchema>;

// ── Datos fiscales ──────────────────────────────────────────────────────────

/** Las cinco condiciones de IVA que existen para un centro en Argentina. */
export const IVA_CONDITIONS = [
  'responsable_inscripto',
  'monotributo',
  'exento',
  'consumidor_final',
  'no_alcanzado',
] as const;

export const ivaConditionSchema = z.enum(IVA_CONDITIONS);
export type IvaCondition = z.infer<typeof ivaConditionSchema>;

export const fiscalDataSchema = z.object({
  /** CUIT sin guiones, 11 dígitos. El dígito verificador lo valida el servicio. */
  cuit: z
    .string()
    .trim()
    .regex(/^\d{11}$/, 'El CUIT son 11 dígitos, sin guiones.'),
  businessName: z.string().trim().min(2, 'Poné la razón social.').max(120),
  ivaCondition: ivaConditionSchema,
});

export type FiscalData = z.infer<typeof fiscalDataSchema>;

// ── La suscripción ──────────────────────────────────────────────────────────

export const subscriptionSchema = z.object({
  organizationId: z.string(),
  centerName: z.string(),
  status: subscriberStatusSchema,
  planId: planIdSchema,
  /**
   * 🔴 Lo que este suscriptor paga, congelado al contratar (§2.1.4). Cambiar el
   * precio del plan **no** cambia este número: el que ya estaba, sigue como
   * estaba.
   */
  priceSnapshotCents: z.number().int(),
  currency: subscriptionCurrencySchema,
  timeZone: z.string(),
  /** `null` cuando ya pasó del trial. */
  trialEndsAt: z.string().nullable(),
  /** Cuándo arranca el próximo ciclo. Es la fecha en la que cae un downgrade. */
  currentPeriodEndsAt: z.string().nullable(),
  /** El plan al que baja al terminar el ciclo, si pidió bajar. */
  pendingPlanId: planIdSchema.nullable(),
  fiscal: fiscalDataSchema.nullable(),
});

export type Subscription = z.infer<typeof subscriptionSchema>;

export const changePlanSchema = z.object({ planId: planIdSchema });
export type ChangePlanInput = z.infer<typeof changePlanSchema>;

export const changeSubscriberStatusSchema = z.object({
  to: subscriberStatusSchema,
  reason: z.string().trim().max(300).optional(),
});

export type ChangeSubscriberStatusInput = z.infer<typeof changeSubscriberStatusSchema>;

/** Qué pasó al cambiar de plan: el SMU tiene que entender qué le van a cobrar. */
export const planChangeResultSchema = z.object({
  subscription: subscriptionSchema,
  /** `upgrade` se aplica ya; `downgrade` queda para el fin del ciclo. */
  kind: z.enum(['upgrade', 'downgrade', 'same']),
  /** Lo que se cobra ahora por el resto del ciclo. Cero en un downgrade. */
  proratedCents: z.number().int(),
  effectiveAt: z.string(),
});

export type PlanChangeResult = z.infer<typeof planChangeResultSchema>;

// ── Impersonación (§2.1.3) ──────────────────────────────────────────────────

/**
 * El SAU entra a la cuenta de un suscriptor para dar soporte. Exige motivo,
 * dura poco, queda en el `AuditLog` y **se le avisa al SMU** (ADR-004): un
 * acceso de soporte que el dueño de la cuenta no puede ver es indistinguible
 * de una fuga.
 */
export const IMPERSONATION_MINUTES = 30;

export const impersonateSchema = z.object({
  organizationId: z.string().min(1),
  reason: z.string().trim().min(10, 'Escribí el motivo del acceso, con detalle.').max(300),
});

export type ImpersonateInput = z.infer<typeof impersonateSchema>;

export const impersonationSchema = z.object({
  organizationId: z.string(),
  reason: z.string(),
  startedAt: z.string(),
  expiresAt: z.string(),
});

export type Impersonation = z.infer<typeof impersonationSchema>;

// ── Lo que la landing muestra de cada plan ──────────────────────────────────

/**
 * El catálogo tal como arranca, para poder **prerenderizarlo**.
 *
 * §5.1.4 pide que la landing rankee, y para eso los precios tienen que estar
 * en el HTML servido, no aparecer después de un `fetch`. El precio vigente —
 * el que el SAU puede cambiar — vive en la colección `plans`; esto es la copia
 * que se hornea en el build.
 *
 * 🔴 Las dos tienen que decir lo mismo, y como una es TypeScript y la otra una
 * migración `.cjs` no pueden compartir código: hay un test que compara las dos
 * y falla si alguien cambia una sola.
 */
export interface LandingPlan {
  planId: SubscriptionPlanId;
  name: string;
  priceCents: number;
  description: string;
  highlights: readonly string[];
  /** El que la landing destaca: el piso real del producto (§2.2.1). */
  featured?: boolean;
}

export const LANDING_PLANS: readonly LandingPlan[] = [
  {
    planId: 'basic',
    name: 'Basic',
    priceCents: 2_500_000,
    description: 'Para el centro que arranca: una sede, hasta 60 socios.',
    highlights: ['1 sede', 'Hasta 60 socios', '3 usuarios de staff', 'Cobranza manual'],
  },
  {
    planId: 'pro',
    name: 'Pro',
    priceCents: 4_500_000,
    description: 'El plan del box que ya funciona: QR, planificación y cobro online.',
    highlights: [
      'Hasta 3 sedes',
      'Hasta 180 socios',
      'Check-in con QR',
      'Planificación y resultados',
      'Cobro online',
    ],
    featured: true,
  },
  {
    planId: 'max',
    name: 'Max',
    priceCents: 7_500_000,
    description: 'Sin límites, con Health, CRM y marca propia en la app del socio.',
    highlights: ['Sedes y socios sin límite', 'Health', 'CRM', 'Marca propia en la WAFM'],
  },
];

/** "$45.000". Los precios viven en centavos enteros (§5.2.2). */
export function formatArs(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('es-AR')}`;
}

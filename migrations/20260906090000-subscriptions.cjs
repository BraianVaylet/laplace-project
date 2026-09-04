/**
 * Índices de Suscriptors y Suscriptions (F1-25).
 *
 * 🔴 Estas dos colecciones **no llevan `tenantId`**, y no es un olvido: no son
 * datos de un centro, son datos sobre los centros. La suscripción es la
 * relación entre Laplace y el suscriptor, y el panel del SAU la consulta
 * cruzando todos ellos. Son colecciones de plataforma, como `jobLock`.
 *
 * `{ organizationId }` único es lo que impide que una organización termine con
 * dos suscripciones — dos planes, dos precios y ninguna forma de saber cuál
 * vale. `{ status, trialEndsAt }` es por donde el job de vencimiento busca los
 * trials que ya terminaron.
 */
const COLLECTIONS = {
  subscription: 'subscriptions',
  plan: 'plans',
  /**
   * Lo que deja alguien en el formulario de la landing (F1-26). Tampoco lleva
   * `tenantId`: quien escribe todavía no tiene centro. El `Lead` de §5.2.2 —
   * el prospecto **de un centro** — es otra cosa y llega con el CRM de Fase 4.
   */
  contactRequest: 'contactRequests',
  /**
   * El registro que consulta el panel de soporte (§11.3). Guarda el **código**
   * del error, nunca su contenido: el SAU no ve datos de miembros (ADR-004,
   * decisión 7).
   */
  errorEvent: 'errorEvents',
};

/** Treinta días. Un error de hace un mes ya no lo consulta nadie. */
const ERROR_RETENTION_SECONDS = 30 * 24 * 60 * 60;

const INDEXES = [
  [COLLECTIONS.subscription, { organizationId: 1 }, { unique: true, name: 'organization_unique' }],
  [COLLECTIONS.subscription, { status: 1, trialEndsAt: 1 }, { name: 'status_trial_end' }],
  [COLLECTIONS.plan, { planId: 1 }, { unique: true, name: 'plan_unique' }],
  // Por fecha: la bandeja se lee de lo más nuevo a lo más viejo.
  [COLLECTIONS.contactRequest, { receivedAt: -1 }, { name: 'received_at' }],

  // Las dos consultas del panel de soporte: por pedido y por código (§11.3).
  [COLLECTIONS.errorEvent, { requestId: 1 }, { name: 'request_id' }],
  [COLLECTIONS.errorEvent, { code: 1, at: -1 }, { name: 'code_at' }],
  /*
   * TTL: se borra solo. Sin esto la colección crece para siempre, y lo que
   * guarda no vale una purga manual.
   */
  [
    COLLECTIONS.errorEvent,
    { at: 1 },
    { expireAfterSeconds: ERROR_RETENTION_SECONDS, name: 'at_ttl' },
  ],
];

/**
 * El catálogo con el que arranca el producto (§2.2.1). Los precios son
 * **valores iniciales**: el SAU los cambia desde su panel, y cambiarlos no
 * toca lo que paga quien ya está suscripto — eso vive en su
 * `priceSnapshotCents` (§2.1.4).
 *
 * El contenido de cada plan — módulos, features y límites — no está acá: vive
 * en el catálogo de entitlements (`src/entitlements/catalog.ts`), que es el
 * que lo hace cumplir. Duplicarlo serían dos verdades sobre qué incluye Pro.
 */
const PLANS = [
  {
    planId: 'basic',
    name: 'Basic',
    priceCents: 2_500_000,
    currency: 'ARS',
    description: 'Para el centro que arranca: una sede, hasta 60 socios.',
    highlights: ['1 sede', 'Hasta 60 socios', '3 usuarios de staff', 'Cobranza manual'],
    effectiveFrom: '2026-01-01',
  },
  {
    planId: 'pro',
    name: 'Pro',
    priceCents: 4_500_000,
    currency: 'ARS',
    description: 'El plan del box que ya funciona: QR, planificación y cobro online.',
    highlights: [
      'Hasta 3 sedes',
      'Hasta 180 socios',
      'Check-in con QR',
      'Planificación y resultados',
      'Cobro online',
    ],
    effectiveFrom: '2026-01-01',
  },
  {
    planId: 'max',
    name: 'Max',
    priceCents: 7_500_000,
    currency: 'ARS',
    description: 'Sin límites, con Health, CRM y marca propia en la app del socio.',
    highlights: ['Sedes y socios sin límite', 'Health', 'CRM', 'Marca propia en la WAFM'],
    effectiveFrom: '2026-01-01',
  },
];

module.exports = {
  COLLECTIONS,
  INDEXES,
  PLANS,

  async up(db) {
    for (const [collection, keys, options] of INDEXES) {
      await db.collection(collection).createIndex(keys, options);
    }

    // Upsert y no insert: la migración tiene que poder correr dos veces, y un
    // precio ya editado por el SAU no se pisa con el inicial.
    for (const plan of PLANS) {
      await db
        .collection(COLLECTIONS.plan)
        .updateOne({ planId: plan.planId }, { $setOnInsert: plan }, { upsert: true });
    }
  },

  async down(db) {
    for (const [collection, , options] of INDEXES) {
      // `dropIndex` falla si no existe: la baja tiene que poder correr dos veces.
      await db
        .collection(collection)
        .dropIndex(options.name)
        .catch(() => undefined);
    }
  },
};

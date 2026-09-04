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
};

const INDEXES = [
  [COLLECTIONS.subscription, { organizationId: 1 }, { unique: true, name: 'organization_unique' }],
  [COLLECTIONS.subscription, { status: 1, trialEndsAt: 1 }, { name: 'status_trial_end' }],
  [COLLECTIONS.plan, { planId: 1 }, { unique: true, name: 'plan_unique' }],
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

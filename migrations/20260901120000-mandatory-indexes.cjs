/**
 * Indices obligatorios de la spec §5.2.3, mas los de la infraestructura de
 * Fase 0.
 *
 * Dos reglas que estan detras de casi todas las lineas de este archivo:
 *
 * 1. **`tenantId` va PRIMERO en todo indice compuesto** (ADR-000 regla 4). Si va
 *    segundo, Mongo no puede usar el indice para acotar por tenant y termina
 *    escaneando documentos de otros centros para despues descartarlos.
 * 2. **Los indices unicos son la ultima linea de defensa.** El update atomico
 *    evita la sobreventa en el caso normal; el unico de `bookings` es lo que
 *    queda si ese camino alguna vez falla.
 */

/** Espejo de `apps/api/src/persistence/collections.ts`. El test verifica que coincidan. */
const C = {
  venue: 'venues',
  room: 'rooms',
  member: 'members',
  inviteCode: 'inviteCodes',
  product: 'products',
  contract: 'contracts',
  charge: 'charges',
  payment: 'payments',
  refund: 'refunds',
  classTemplate: 'classTemplates',
  classSession: 'classSessions',
  booking: 'bookings',
  exercise: 'exercises',
  planning: 'plannings',
  result: 'results',
  rmRecord: 'rmRecords',
  legalDocument: 'legalDocuments',
  consent: 'consents',
  notification: 'notifications',
  lead: 'leads',
  auditLog: 'auditLogs',
  metricsDaily: 'metricsDaily',
  loginAttempt: 'loginAttempt',
  jobLock: 'jobLock',
  jobRun: 'jobRun',
};

const DAY = 24 * 60 * 60;

/** Retencion del audit log y de las corridas de job. */
const AUDIT_LOG_RETENTION_SECONDS = 365 * DAY;
const JOB_RUN_RETENTION_SECONDS = 30 * DAY;

/**
 * `[coleccion, llaves, opciones]`. Se declara como datos para poder recorrerlo
 * en el test y verificar que cada uno exista de verdad.
 */
const INDEXES = [
  // ── Identificador publico: se busca por el en todas las rutas ────────────
  ...[
    C.venue,
    C.room,
    C.member,
    C.product,
    C.contract,
    C.charge,
    C.payment,
    C.classTemplate,
    C.classSession,
    C.booking,
    C.planning,
    C.result,
    C.lead,
  ].map((collection) => [
    collection,
    { publicId: 1 },
    // `sparse`: unico ENTRE LOS QUE LO TIENEN. Sin esto, dos documentos sin
    // publicId — una migracion sobre datos viejos, un insert por el driver
    // crudo — chocarian entre si por tener ambos `null`.
    { unique: true, sparse: true, name: 'publicId_unique' },
  ]),

  // ── Aislamiento y listados (§5.2.3) ──────────────────────────────────────
  [C.venue, { tenantId: 1, status: 1 }, { name: 'tenant_status' }],
  [C.room, { tenantId: 1, venueId: 1 }, { name: 'tenant_venue' }],

  [C.member, { tenantId: 1, status: 1, lastAttendanceAt: -1 }, { name: 'tenant_status_lastAtt' }],
  [
    C.member,
    { tenantId: 1, docId: 1 },
    /*
     * Indice PARCIAL, no sparse. En un indice compuesto, `sparse` solo omite el
     * documento si faltan TODOS los campos indexados: como `tenantId` siempre
     * esta, un socio sin DNI igual se indexa con `docId: null` y el segundo sin
     * DNI choca contra el primero. Con `partialFilterExpression` el indice solo
     * mira a los que efectivamente cargaron documento, que es la intencion.
     */
    {
      unique: true,
      partialFilterExpression: { docId: { $type: 'string' } },
      name: 'tenant_doc_unique',
    },
  ],
  [C.inviteCode, { tenantId: 1, code: 1 }, { unique: true, name: 'tenant_code_unique' }],

  [C.product, { tenantId: 1, active: 1, type: 1 }, { name: 'tenant_active_type' }],
  [
    C.contract,
    { tenantId: 1, memberId: 1, status: 1, endsAt: 1 },
    { name: 'tenant_member_status_ends' },
  ],
  // El job que expira contratos barre por esto todos los dias.
  [C.contract, { tenantId: 1, status: 1, endsAt: 1 }, { name: 'tenant_status_ends' }],

  [C.charge, { tenantId: 1, memberId: 1, status: 1, dueAt: 1 }, { name: 'tenant_member_due' }],
  [C.charge, { tenantId: 1, status: 1, dueAt: 1 }, { name: 'tenant_status_due' }],
  [
    C.payment,
    { tenantId: 1, idempotencyKey: 1 },
    // Lo que hace idempotentes a los webhooks (§5.2.3). Parcial por el mismo
    // motivo que el de `members`: un pago registrado a mano no trae clave, y
    // dos de esos no pueden chocar entre si.
    {
      unique: true,
      partialFilterExpression: { idempotencyKey: { $type: 'string' } },
      name: 'tenant_idempotency_unique',
    },
  ],
  [C.payment, { tenantId: 1, venueId: 1, receivedAt: -1 }, { name: 'tenant_venue_received' }],

  [C.classTemplate, { tenantId: 1, venueId: 1, active: 1 }, { name: 'tenant_venue_active' }],
  [C.classSession, { tenantId: 1, venueId: 1, startAt: 1 }, { name: 'tenant_venue_start' }],

  [
    C.booking,
    { tenantId: 1, sessionId: 1, memberId: 1 },
    // 🔴 UNICO: es lo que impide la doble reserva aunque el update atomico falle.
    { unique: true, name: 'tenant_session_member_unique' },
  ],
  [C.booking, { tenantId: 1, memberId: 1, bookedAt: -1 }, { name: 'tenant_member_booked' }],
  // El job de no-shows barre por sesion y estado.
  [C.booking, { tenantId: 1, sessionId: 1, status: 1 }, { name: 'tenant_session_status' }],

  [C.exercise, { scope: 1, tenantId: 1, name: 1 }, { name: 'scope_tenant_name' }],
  [C.planning, { tenantId: 1, venueId: 1, publishAt: -1 }, { name: 'tenant_venue_publish' }],
  [C.result, { tenantId: 1, sessionId: 1 }, { name: 'tenant_session' }],

  // El RM es del atleta, no del centro: por eso arranca en userId (ADR-000 regla 7).
  [C.rmRecord, { userId: 1, exerciseId: 1, measuredAt: -1 }, { name: 'user_exercise_measured' }],

  [C.consent, { userId: 1, tenantId: 1, documentId: 1 }, { name: 'user_tenant_document' }],
  [C.notification, { tenantId: 1, status: 1, createdAt: -1 }, { name: 'tenant_status_created' }],
  [C.lead, { tenantId: 1, stage: 1, nextFollowUpAt: 1 }, { name: 'tenant_stage_followup' }],

  [C.auditLog, { tenantId: 1, at: -1 }, { name: 'tenant_at' }],
  [C.auditLog, { at: 1 }, { expireAfterSeconds: AUDIT_LOG_RETENTION_SECONDS, name: 'at_ttl' }],

  [
    C.metricsDaily,
    { tenantId: 1, venueId: 1, date: -1 },
    // Unico: es lo que hace idempotente al job de metricas — corre dos veces y
    // sobreescribe en vez de duplicar.
    { unique: true, name: 'tenant_venue_date_unique' },
  ],

  // ── Infraestructura de Fase 0 ────────────────────────────────────────────
  [C.loginAttempt, { expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expiresAt_ttl' }],
  [C.jobLock, { expiresAt: 1 }, { name: 'expiresAt' }],
  [C.jobRun, { name: 1, startedAt: -1 }, { name: 'name_started' }],
  [
    C.jobRun,
    { startedAt: 1 },
    { expireAfterSeconds: JOB_RUN_RETENTION_SECONDS, name: 'startedAt_ttl' },
  ],
];

module.exports = {
  INDEXES,
  COLLECTIONS: C,

  async up(db) {
    for (const [collection, keys, options] of INDEXES) {
      await db.collection(collection).createIndex(keys, options);
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

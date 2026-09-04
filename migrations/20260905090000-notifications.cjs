/**
 * Índices de Notifications (F1-21).
 *
 * Los tres que sostienen el motor:
 *
 * 1. **`dedupeKey` único por tenant.** Es lo que hace que dos corridas del job
 *    que se pisen no manden el mismo recordatorio dos veces (§2.1.14). La
 *    deduplicación no se resuelve con un `findOne` antes del `insert`: entre la
 *    lectura y la escritura entra la otra corrida. Se resuelve con este único.
 * 2. **`{ tenantId, status, nextAttemptAt }`** es por donde el job reclama lo
 *    que toca mandar. La migración base ya traía `{ tenantId, status,
 *    createdAt }`, que sirve para listar pero no para el reclamo: el orden que
 *    importa es cuándo vuelve a intentarse, no cuándo se creó.
 * 3. **`{ tenantId, userId, createdAt: -1 }`** es la campana del usuario, la
 *    consulta más frecuente del módulo.
 *
 * Plantillas y preferencias llevan su único para que no existan dos filas
 * distintas diciendo cosas distintas sobre lo mismo.
 */

/** Colecciones que trae esta migración (el test de F0-10 las cruza con el código). */
const COLLECTIONS = {
  notificationTemplate: 'notificationTemplates',
  notificationPreference: 'notificationPreferences',
};

const INDEXES = [
  ['notifications', { tenantId: 1, dedupeKey: 1 }, { unique: true, name: 'tenant_dedupe_unique' }],
  ['notifications', { tenantId: 1, status: 1, nextAttemptAt: 1 }, { name: 'tenant_status_next' }],
  ['notifications', { tenantId: 1, userId: 1, createdAt: -1 }, { name: 'tenant_user_created' }],
  [
    COLLECTIONS.notificationTemplate,
    { tenantId: 1, eventType: 1, channel: 1 },
    { unique: true, name: 'tenant_event_channel_unique' },
  ],
  [
    COLLECTIONS.notificationPreference,
    { tenantId: 1, userId: 1, eventType: 1, channel: 1 },
    { unique: true, name: 'tenant_user_event_channel_unique' },
  ],
];

module.exports = {
  COLLECTIONS,
  INDEXES,

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

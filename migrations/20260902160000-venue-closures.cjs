/**
 * Índice de los cierres del centro (F1-13).
 *
 * Se consulta al materializar la grilla y al duplicar una semana, siempre por
 * sede y por rango de fechas, así que el índice va en ese orden — con `tenantId`
 * primero, como todos (ADR-000 regla 4).
 */

/** Las colecciones que trae esta migracion. El test verifica que ninguna quede sin migrar. */
const COLLECTIONS = { venueClosure: 'venueClosures' };

const INDEXES = [
  [COLLECTIONS.venueClosure, { tenantId: 1, venueId: 1, from: 1 }, { name: 'tenant_venue_from' }],
];

module.exports = {
  INDEXES,
  COLLECTIONS,

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

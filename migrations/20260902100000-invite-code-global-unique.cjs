/**
 * Índice único **global** sobre `inviteCodes.code`.
 *
 * Es la única excepción a la regla de que todo índice arranca con `tenantId`
 * (ADR-000 regla 4), y tiene un motivo concreto: el canje ocurre **antes** de
 * que la persona pertenezca a ningún centro. El atleta se registra en la WAFM,
 * escribe el código y recién ahí el sistema sabe a qué tenant asociarlo — así
 * que la búsqueda del código no puede estar acotada por tenant.
 *
 * Con el `{ tenantId, code }` de §5.2.3 solo, dos centros podrían generar el
 * mismo `code` y el canje no sabría a cuál de los dos asociar a la persona.
 * Este índice hace que eso sea imposible, en vez de improbable.
 *
 * El `{ tenantId, code }` de la migración anterior se conserva: es el que sirve
 * para listar los códigos de un centro.
 */

const INDEXES = [['inviteCodes', { code: 1 }, { unique: true, name: 'code_global_unique' }]];

module.exports = {
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

/**
 * Índice único que hace **idempotente** al job de materialización de sesiones
 * (F1-12).
 *
 * Sin él, la idempotencia dependería de que el job consulte antes de escribir, y
 * entre esa consulta y el `insert` hay una ventana: dos instancias del runner
 * arrancando a la vez crearían la misma clase dos veces, y el socio vería la
 * grilla duplicada.
 *
 * Es PARCIAL sobre `templateId`: una clase suelta cargada a mano no tiene
 * plantilla, y con un índice `sparse` compuesto todas ellas colisionarían entre
 * sí en `null` — la misma trampa que documenta la migración anterior.
 */

const INDEXES = [
  [
    'classSessions',
    { tenantId: 1, templateId: 1, startAt: 1 },
    {
      unique: true,
      name: 'tenant_template_start_unique',
      partialFilterExpression: { templateId: { $type: 'string' } },
    },
  ],
];

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

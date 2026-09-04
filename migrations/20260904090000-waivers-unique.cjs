/**
 * Índices de Waivers (F1-20).
 *
 * 🔴 **Corrige el índice de `consent` de la migración base.** La base
 * (`20260901120000`) ya declaraba `{ userId, tenantId, documentId }`, pero sin
 * `unique` y con `tenantId` en **segundo** lugar — copiado del índice de
 * `RmRecord`, que sí es del atleta y no del tenant (ADR-000 regla 7). Un
 * consentimiento **no** es portable entre centros: aceptar el deslinde de Box
 * Toro no dice nada sobre el de otro gimnasio, así que le corresponde el orden
 * normal de todo índice compuesto — `tenantId` primero (ADR-000 regla 4) — y
 * se reemplaza por la versión única, que es la que hace que aceptar el mismo
 * documento dos veces (doble click) no duplique el registro.
 *
 * `{ tenantId, type, version }` en `legalDocument` es lo que impide publicar
 * dos veces el mismo número de versión del mismo tipo, y sirve también para
 * "traeme la última versión vigente de este tipo" con
 * `.sort({ version: -1 }).limit(1)`.
 */

/** El índice de la migración base que este archivo reemplaza. */
const REPLACED = ['consents', 'user_tenant_document'];

const INDEXES = [
  [
    'consents',
    { tenantId: 1, userId: 1, documentId: 1 },
    { unique: true, name: 'tenant_user_document_unique' },
  ],
  [
    'legalDocuments',
    { tenantId: 1, type: 1, version: 1 },
    { unique: true, name: 'tenant_type_version_unique' },
  ],
];

module.exports = {
  INDEXES,

  async up(db) {
    // Primero se baja el de la base: dos índices sobre las mismas claves
    // conviven, y el viejo (no único) no protege nada.
    await db
      .collection(REPLACED[0])
      .dropIndex(REPLACED[1])
      .catch(() => undefined);

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

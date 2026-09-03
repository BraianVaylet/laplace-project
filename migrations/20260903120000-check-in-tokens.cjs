/**
 * La colección de tokens del QR (F1-19).
 *
 * Dos índices, cada uno por un motivo distinto:
 *
 * - **TTL sobre `expiresAt`.** El documento vive 30 segundos y se emite uno cada
 *   vez que alguien abre su QR: sin el TTL, la colección crece para siempre y
 *   nadie la limpia. `expireAfterSeconds: 0` borra el documento cuando su propia
 *   `expiresAt` pasa, que es exactamente lo que se quiere.
 * - **Único `{ tenantId, tokenHash }`.** Es el que hace que el canje sea de un
 *   solo uso incluso con dos escaneos simultáneos: el `findOneAndUpdate` que
 *   marca `usedAt` pierde la carrera contra sí mismo, el índice no.
 *
 * 🔴 El TTL de Mongo corre cada 60 segundos, así que un token puede sobrevivir
 * hasta un minuto a su vencimiento. No es un problema de seguridad: quien lo
 * canjea igual pasa por `assertTokenUsable`, que compara contra el reloj. El
 * índice es higiene de la colección, no la regla.
 */

const COLLECTIONS = { checkInToken: 'checkInTokens' };

const INDEXES = [
  ['checkInTokens', { expiresAt: 1 }, { name: 'checkin_token_ttl', expireAfterSeconds: 0 }],
  [
    'checkInTokens',
    { tenantId: 1, tokenHash: 1 },
    { unique: true, name: 'tenant_token_hash_unique' },
  ],
  // El socio pide un token nuevo cada vez que abre el QR: buscar los suyos
  // vigentes tiene que ser barato.
  ['checkInTokens', { tenantId: 1, memberId: 1, expiresAt: -1 }, { name: 'tenant_member_recent' }],
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

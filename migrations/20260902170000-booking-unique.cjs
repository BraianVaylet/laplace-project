/**
 * Índices únicos de Booking (F1-14).
 *
 * 🔴 **Corrige el índice de F0-10.** `{ tenantId, sessionId, memberId }` está en
 * §5.2.3 y es el último cinturón contra la doble reserva: el chequeo previo
 * puede perder la carrera entre dos pedidos simultáneos, el índice no. Pero la
 * versión de F0-10 no llevaba `partialFilterExpression`, y así **un socio que
 * canceló no podía volver a reservar la misma clase nunca más** — que es
 * exactamente lo que hace alguien que se equivocó de horario. Se reemplaza por
 * la versión parcial sobre los estados vivos.
 *
 * `{ tenantId, idempotencyKey }` es lo que hace que el reintento de una reserva
 * que falló por timeout no cree una segunda (§5.0). Parcial por el mismo motivo
 * que en `payments`: la mayoría de las filas no lo tienen y en un índice
 * compuesto `sparse` no las omitiría.
 */

/** El índice de F0-10 que esta migración reemplaza. */
const REPLACED = ['bookings', 'tenant_session_member_unique'];

const INDEXES = [
  [
    'bookings',
    { tenantId: 1, sessionId: 1, memberId: 1 },
    {
      unique: true,
      name: 'tenant_session_member_unique',
      partialFilterExpression: { status: { $in: ['booked', 'waitlisted', 'checked_in'] } },
    },
  ],
  [
    'bookings',
    { tenantId: 1, idempotencyKey: 1 },
    {
      unique: true,
      name: 'tenant_booking_idempotency_unique',
      partialFilterExpression: { idempotencyKey: { $type: 'string' } },
    },
  ],
];

module.exports = {
  INDEXES,

  async up(db) {
    // Primero se baja el de F0-10: dos unicos sobre las mismas claves conviven,
    // y el viejo seguiria bloqueando la re-reserva.
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

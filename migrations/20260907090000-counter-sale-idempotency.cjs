/**
 * F1-37 — La venta de mostrador es idempotente por su cargo.
 *
 * 🔴 Vender crea un contrato, un cargo y —si cobra— un pago, todo junto. El
 * reintento de una venta que falló por timeout no puede dejar al socio con dos
 * contratos y dos cargos.
 *
 * La clave se guarda en el **cargo**, que es la única de las tres piezas que
 * siempre existe: el pago puede no haber ocurrido —se vende hoy y se cobra el
 * viernes— y el contrato no lleva clave propia.
 *
 * El índice es **parcial**: un cargo emitido a mano no trae clave, y dos de
 * esos no pueden chocar entre sí.
 */
const COLECCION = 'charges';

module.exports = {
  async up(db) {
    await db.collection(COLECCION).createIndex(
      { tenantId: 1, idempotencyKey: 1 },
      {
        unique: true,
        partialFilterExpression: { idempotencyKey: { $type: 'string' } },
        name: 'tenant_idempotency_unique',
      },
    );
  },

  async down(db) {
    await db.collection(COLECCION).dropIndex('tenant_idempotency_unique');
  },
};

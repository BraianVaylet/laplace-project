import { describe, expect, it } from 'vitest';
import { CHARGE_STATES, type ChargeStatus } from '@laplace/schemas';
import type { AppError } from '../../../http/errors.js';
import {
  allocatePayment,
  assertRefundable,
  balanceOf,
  canTransition,
  isSettled,
  outstandingOf,
  overdueOf,
  refundableOf,
  type PayableCharge,
} from './billing.js';

const cargo = (overrides: Partial<PayableCharge> = {}): PayableCharge => ({
  publicId: 'chg_1',
  amountCents: 6_000_000,
  paidCents: 0,
  dueAt: '2026-03-01T12:00:00Z',
  status: 'pending',
  ...overrides,
});

describe('estados del cargo (§14)', () => {
  const VALIDAS: ReadonlyArray<[ChargeStatus, ChargeStatus]> = [
    ['pending', 'paid'],
    ['pending', 'overdue'],
    ['pending', 'void'],
    ['overdue', 'paid'],
    ['overdue', 'void'],
  ];

  it.each(VALIDAS)('%s → %s es válida', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it('toda combinación que no esté en la lista es inválida', () => {
    const validas = new Set(VALIDAS.map(([from, to]) => `${from}->${to}`));
    const sobran: string[] = [];

    for (const from of CHARGE_STATES) {
      for (const to of CHARGE_STATES) {
        if (validas.has(`${from}->${to}`)) continue;
        if (canTransition(from, to)) sobran.push(`${from}->${to}`);
      }
    }

    expect(sobran).toEqual([]);
  });

  it('un cargo pagado no vuelve a pendiente', () => {
    // Se revierte con un reembolso, no cambiando el estado hacia atrás: así el
    // arqueo del día anterior sigue coincidiendo.
    expect(canTransition('paid', 'pending')).toBe(false);
  });
});

describe('cuánto falta pagar', () => {
  it('lo que no se pagó', () => {
    expect(outstandingOf(cargo({ paidCents: 2_000_000 }))).toBe(4_000_000);
  });

  it('cero cuando está saldado', () => {
    expect(outstandingOf(cargo({ paidCents: 6_000_000 }))).toBe(0);
    expect(isSettled(cargo({ paidCents: 6_000_000 }))).toBe(true);
  });

  it('pagar de más no genera crédito en el cargo', () => {
    // El excedente es saldo a favor del socio, no de este cargo puntual.
    expect(outstandingOf(cargo({ paidCents: 9_000_000 }))).toBe(0);
  });
});

describe('imputación de un pago', () => {
  it('salda un cargo entero', () => {
    const { allocations, leftoverCents } = allocatePayment(6_000_000, [cargo()]);

    expect(allocations).toEqual([{ chargeId: 'chg_1', cents: 6_000_000 }]);
    expect(leftoverCents).toBe(0);
  });

  it('el más viejo primero: es lo que espera el mostrador', () => {
    const viejo = cargo({ publicId: 'chg_viejo', dueAt: '2026-01-01T12:00:00Z' });
    const nuevo = cargo({ publicId: 'chg_nuevo', dueAt: '2026-03-01T12:00:00Z' });

    const { allocations } = allocatePayment(12_000_000, [nuevo, viejo]);

    // Al revés, la deuda vieja queda abierta mientras se saldan las nuevas.
    expect(allocations.map((a) => a.chargeId)).toEqual(['chg_viejo', 'chg_nuevo']);
  });

  it('un pago parcial deja el cargo a medias', () => {
    const { allocations, leftoverCents } = allocatePayment(2_000_000, [cargo()]);

    expect(allocations).toEqual([{ chargeId: 'chg_1', cents: 2_000_000 }]);
    expect(leftoverCents).toBe(0);
  });

  it('un pago que alcanza para dos cargos y medio los reparte en orden', () => {
    const cargos = [
      cargo({ publicId: 'a', amountCents: 1_000_000, dueAt: '2026-01-01T00:00:00Z' }),
      cargo({ publicId: 'b', amountCents: 1_000_000, dueAt: '2026-02-01T00:00:00Z' }),
      cargo({ publicId: 'c', amountCents: 1_000_000, dueAt: '2026-03-01T00:00:00Z' }),
    ];

    const { allocations, leftoverCents } = allocatePayment(2_500_000, cargos);

    expect(allocations).toEqual([
      { chargeId: 'a', cents: 1_000_000 },
      { chargeId: 'b', cents: 1_000_000 },
      { chargeId: 'c', cents: 500_000 },
    ]);
    expect(leftoverCents).toBe(0);
  });

  it('lo que sobra queda como saldo a favor, no se pierde', () => {
    const { allocations, leftoverCents } = allocatePayment(8_000_000, [cargo()]);

    expect(allocations).toHaveLength(1);
    expect(leftoverCents).toBe(2_000_000);
  });

  it('ignora los saldados y los anulados', () => {
    const cargos = [
      cargo({ publicId: 'saldado', paidCents: 6_000_000 }),
      cargo({ publicId: 'anulado', status: 'void' }),
      cargo({ publicId: 'vivo' }),
    ];

    const { allocations } = allocatePayment(6_000_000, cargos);

    expect(allocations.map((a) => a.chargeId)).toEqual(['vivo']);
  });

  it('sin cargos, todo el pago queda a favor', () => {
    const { allocations, leftoverCents } = allocatePayment(6_000_000, []);

    expect(allocations).toEqual([]);
    expect(leftoverCents).toBe(6_000_000);
  });
});

describe('reembolsos', () => {
  const pago = { publicId: 'pay_1', amountCents: 6_000_000, refundedCents: 0, status: 'approved' };

  it('se puede devolver todo lo que no se devolvió', () => {
    expect(refundableOf(pago)).toBe(6_000_000);
    expect(refundableOf({ ...pago, refundedCents: 2_000_000 })).toBe(4_000_000);
  });

  it('rechaza un reembolso mayor con LP-BILL-409-005 y dice cuánto queda', () => {
    try {
      assertRefundable({ ...pago, refundedCents: 4_000_000 }, 3_000_000);
      expect.unreachable();
    } catch (error) {
      expect((error as AppError).code).toBe('LP-BILL-409-005');
      expect((error as AppError).message).toContain('20.000');
    }
  });

  it('devolver exactamente lo que queda se puede', () => {
    expect(() => assertRefundable({ ...pago, refundedCents: 4_000_000 }, 2_000_000)).not.toThrow();
  });

  it('un pago ya devuelto entero no admite más', () => {
    expect(() => assertRefundable({ ...pago, refundedCents: 6_000_000 }, 1)).toThrow();
  });
});

describe('saldo del socio', () => {
  const aprobado = (amountCents: number, refundedCents = 0) => ({
    amountCents,
    refundedCents,
    status: 'approved',
  });

  it('pagado menos cobrado: negativo significa que debe', () => {
    const saldo = balanceOf([{ amountCents: 6_000_000, status: 'pending' }], []);

    expect(saldo).toBe(-6_000_000);
  });

  it('en cero cuando pagó todo', () => {
    const saldo = balanceOf([{ amountCents: 6_000_000, status: 'paid' }], [aprobado(6_000_000)]);

    expect(saldo).toBe(0);
  });

  it('positivo cuando pagó de más: es saldo a favor', () => {
    const saldo = balanceOf([{ amountCents: 6_000_000, status: 'paid' }], [aprobado(8_000_000)]);

    expect(saldo).toBe(2_000_000);
  });

  it('un cargo anulado no cuenta', () => {
    const saldo = balanceOf(
      [
        { amountCents: 6_000_000, status: 'void' },
        { amountCents: 1_000_000, status: 'pending' },
      ],
      [],
    );

    expect(saldo).toBe(-1_000_000);
  });

  it('un reembolso resta de lo pagado: devolverle plata no le baja la deuda', () => {
    const saldo = balanceOf(
      [{ amountCents: 6_000_000, status: 'pending' }],
      [aprobado(6_000_000, 6_000_000)],
    );

    expect(saldo).toBe(-6_000_000);
  });

  it('un pago rechazado no cuenta como pagado', () => {
    const saldo = balanceOf(
      [{ amountCents: 6_000_000, status: 'pending' }],
      [{ amountCents: 6_000_000, refundedCents: 0, status: 'rejected' }],
    );

    expect(saldo).toBe(-6_000_000);
  });
});

describe('deuda vencida', () => {
  const AHORA = '2026-03-15T12:00:00Z';

  it('suma lo vencido e impago', () => {
    const cargos = [
      cargo({ publicId: 'vencido', dueAt: '2026-03-01T00:00:00Z' }),
      cargo({ publicId: 'por vencer', dueAt: '2026-04-01T00:00:00Z' }),
    ];

    expect(overdueOf(cargos, AHORA)).toBe(6_000_000);
  });

  it('lo pagado no está vencido aunque la fecha haya pasado', () => {
    const cargos = [cargo({ dueAt: '2026-03-01T00:00:00Z', status: 'paid' })];

    expect(overdueOf(cargos, AHORA)).toBe(0);
  });

  it('cuenta solo lo que falta de un cargo parcialmente pagado', () => {
    const cargos = [cargo({ dueAt: '2026-03-01T00:00:00Z', paidCents: 2_000_000 })];

    expect(overdueOf(cargos, AHORA)).toBe(4_000_000);
  });

  it('lo anulado no es deuda', () => {
    const cargos = [cargo({ dueAt: '2026-03-01T00:00:00Z', status: 'void' })];

    expect(overdueOf(cargos, AHORA)).toBe(0);
  });
});

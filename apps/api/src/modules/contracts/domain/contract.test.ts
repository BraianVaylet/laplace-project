import { describe, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { CONTRACT_STATES, type ContractStatus } from '@laplace/schemas';
import type { AppError } from '../../../http/errors.js';
import {
  assertUsable,
  canTransition,
  hasCreditsLeft,
  pickContract,
  type ConsumableContract,
} from './contract.js';

const AHORA = Temporal.Instant.from('2026-03-01T12:00:00Z');

const contrato = (overrides: Partial<ConsumableContract> = {}): ConsumableContract => ({
  publicId: 'ctr_1',
  productName: 'Pack 8 clases',
  productType: 'class_pack',
  status: 'active',
  creditsTotal: 8,
  creditsUsed: 0,
  allowedCategories: [],
  allowedTimeRanges: [],
  startsAt: Temporal.Instant.from('2026-02-01T00:00:00Z'),
  endsAt: Temporal.Instant.from('2026-03-15T23:59:59Z'),
  createdAt: Temporal.Instant.from('2026-02-01T00:00:00Z'),
  ...overrides,
});

/** Todas las transiciones válidas, escritas a mano para no repetir la implementación. */
const VALIDAS: ReadonlyArray<[ContractStatus, ContractStatus]> = [
  ['pending_payment', 'active'],
  ['pending_payment', 'cancelled'],
  ['active', 'frozen'],
  ['active', 'expired'],
  ['active', 'exhausted'],
  ['active', 'cancelled'],
  ['frozen', 'active'],
  ['frozen', 'expired'],
  ['frozen', 'cancelled'],
];

describe('máquina de estados (§14)', () => {
  it.each(VALIDAS)('%s → %s es válida', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it('toda combinación que no esté en la lista es inválida', () => {
    const validas = new Set(VALIDAS.map(([from, to]) => `${from}->${to}`));
    const sobran: string[] = [];

    for (const from of CONTRACT_STATES) {
      for (const to of CONTRACT_STATES) {
        if (validas.has(`${from}->${to}`)) continue;
        if (canTransition(from, to)) sobran.push(`${from}->${to}`);
      }
    }

    expect(sobran).toEqual([]);
  });

  it('vencido, agotado y cancelado son terminales', () => {
    // Un contrato que se agotó no revive: la renovación crea uno nuevo, que es
    // lo que mantiene legible el histórico de lo cobrado.
    for (const terminal of ['expired', 'exhausted', 'cancelled'] as const) {
      for (const to of CONTRACT_STATES) {
        expect(canTransition(terminal, to), `${terminal}->${to}`).toBe(false);
      }
    }
  });
});

describe('créditos disponibles', () => {
  it('un pack con créditos sin usar, sí', () => {
    expect(hasCreditsLeft(contrato({ creditsTotal: 8, creditsUsed: 3 }))).toBe(true);
  });

  it('un pack agotado, no', () => {
    expect(hasCreditsLeft(contrato({ creditsTotal: 8, creditsUsed: 8 }))).toBe(false);
  });

  it('una membresía no lleva créditos: siempre alcanza mientras esté vigente', () => {
    const libre = contrato({
      productType: 'membership_unlimited',
      creditsTotal: 0,
      creditsUsed: 0,
    });

    expect(hasCreditsLeft(libre)).toBe(true);
  });
});

describe('se puede usar', () => {
  it('un contrato activo, vigente y con créditos, sí', () => {
    expect(() => assertUsable(contrato(), AHORA)).not.toThrow();
  });

  it('sin créditos responde LP-CTRT-402-001', () => {
    try {
      assertUsable(contrato({ creditsUsed: 8 }), AHORA);
      expect.unreachable();
    } catch (error) {
      expect((error as AppError).code).toBe('LP-CTRT-402-001');
    }
  });

  it('vencido responde LP-CTRT-402-002 con la fecha en el mensaje', () => {
    const vencido = contrato({ endsAt: Temporal.Instant.from('2026-02-15T00:00:00Z') });

    try {
      assertUsable(vencido, AHORA);
      expect.unreachable();
    } catch (error) {
      expect((error as AppError).code).toBe('LP-CTRT-402-002');
      // "Tu pack venció" sin fecha obliga al socio a preguntar cuál.
      expect((error as AppError).message).toContain('2026-02-15');
    }
  });

  it('el que todavía no arrancó tampoco se usa', () => {
    const futuro = contrato({ startsAt: Temporal.Instant.from('2026-04-01T00:00:00Z') });

    expect(() => assertUsable(futuro, AHORA)).toThrow();
  });

  it('congelado no se usa: es el sentido de congelarlo', () => {
    expect(() => assertUsable(contrato({ status: 'frozen' }), AHORA)).toThrow();
  });

  it('una categoría no habilitada responde LP-CTRT-422-003', () => {
    const pilates = contrato({ allowedCategories: ['pilates'] });

    try {
      assertUsable(pilates, AHORA, { category: 'funcional' });
      expect.unreachable();
    } catch (error) {
      expect((error as AppError).code).toBe('LP-CTRT-422-003');
    }
  });

  it('sin categorías habilitadas, sirve para todas', () => {
    expect(() => assertUsable(contrato(), AHORA, { category: 'funcional' })).not.toThrow();
  });

  it('fuera de la franja horaria habilitada tampoco', () => {
    const matutino = contrato({ allowedTimeRanges: [{ from: '06:00', to: '12:00' }] });

    expect(() => assertUsable(matutino, AHORA, { startsAtLocal: '10:00' })).not.toThrow();
    expect(() => assertUsable(matutino, AHORA, { startsAtLocal: '19:00' })).toThrow();
  });

  it('una membresía sin vencimiento no vence', () => {
    const libre = contrato({ productType: 'membership_unlimited', creditsTotal: 0, endsAt: null });

    expect(() => assertUsable(libre, AHORA)).not.toThrow();
  });
});

describe('orden de consumo con varios contratos activos (§2.1.9)', () => {
  it('elige el que vence primero', () => {
    // El caso del ejemplo de la spec: un pack de 8 que vence el 15/03 y uno de
    // 4 que vence el 30/03. Se descuenta del que vence el 15/03.
    const cerca = contrato({
      publicId: 'ctr_15',
      endsAt: Temporal.Instant.from('2026-03-15T00:00:00Z'),
    });
    const lejos = contrato({
      publicId: 'ctr_30',
      endsAt: Temporal.Instant.from('2026-03-30T00:00:00Z'),
    });

    const elegido = pickContract([lejos, cerca], AHORA);

    expect(elegido[0]?.publicId).toBe('ctr_15');
  });

  it('devuelve TODOS los candidatos, en orden', () => {
    // No alcanza con devolver el primero: si pierde la carrera por el último
    // crédito, hay que poder intentar con el siguiente sin volver a consultar.
    const cerca = contrato({
      publicId: 'ctr_15',
      endsAt: Temporal.Instant.from('2026-03-15T00:00:00Z'),
    });
    const lejos = contrato({
      publicId: 'ctr_30',
      endsAt: Temporal.Instant.from('2026-03-30T00:00:00Z'),
    });

    expect(pickContract([lejos, cerca], AHORA).map((c) => c.publicId)).toEqual([
      'ctr_15',
      'ctr_30',
    ]);
  });

  it('con el mismo vencimiento, gana el de categoría más específica', () => {
    const mismaFecha = Temporal.Instant.from('2026-03-15T00:00:00Z');
    const general = contrato({ publicId: 'ctr_todo', endsAt: mismaFecha, allowedCategories: [] });
    const especifico = contrato({
      publicId: 'ctr_funcional',
      endsAt: mismaFecha,
      allowedCategories: ['funcional'],
    });

    const elegido = pickContract([general, especifico], AHORA, { category: 'funcional' });

    // Gastar primero el que solo sirve para funcional deja el general disponible
    // para cualquier otra clase. Al revés, el específico puede vencer sin uso.
    expect(elegido[0]?.publicId).toBe('ctr_funcional');
  });

  it('con todo igual, el más viejo primero: el orden tiene que ser determinista', () => {
    const mismaFecha = Temporal.Instant.from('2026-03-15T00:00:00Z');
    const viejo = contrato({
      publicId: 'ctr_viejo',
      endsAt: mismaFecha,
      createdAt: Temporal.Instant.from('2026-01-01T00:00:00Z'),
    });
    const nuevo = contrato({
      publicId: 'ctr_nuevo',
      endsAt: mismaFecha,
      createdAt: Temporal.Instant.from('2026-02-01T00:00:00Z'),
    });

    expect(pickContract([nuevo, viejo], AHORA)[0]?.publicId).toBe('ctr_viejo');
  });

  it('el que no vence va último: se usa cuando no queda nada por vencer', () => {
    const libre = contrato({
      publicId: 'ctr_libre',
      productType: 'membership_unlimited',
      creditsTotal: 0,
      endsAt: null,
    });
    const pack = contrato({ publicId: 'ctr_pack' });

    expect(pickContract([libre, pack], AHORA).map((c) => c.publicId)).toEqual([
      'ctr_pack',
      'ctr_libre',
    ]);
  });

  it('descarta los que no sirven: vencidos, agotados, congelados y de otra categoría', () => {
    const candidatos = [
      contrato({ publicId: 'ok' }),
      contrato({ publicId: 'vencido', endsAt: Temporal.Instant.from('2026-01-01T00:00:00Z') }),
      contrato({ publicId: 'agotado', creditsUsed: 8 }),
      contrato({ publicId: 'congelado', status: 'frozen' }),
      contrato({ publicId: 'otra-cat', allowedCategories: ['pilates'] }),
    ];

    const elegidos = pickContract(candidatos, AHORA, { category: 'funcional' });

    expect(elegidos.map((c) => c.publicId)).toEqual(['ok']);
  });

  it('sin candidatos devuelve la lista vacía, no una excepción', () => {
    // Quien llama decide qué error dar: no es lo mismo "no tenés pack" que
    // "tu pack no incluye esta actividad".
    expect(pickContract([contrato({ creditsUsed: 8 })], AHORA)).toEqual([]);
  });
});

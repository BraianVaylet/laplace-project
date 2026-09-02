import { describe, expect, it } from 'vitest';
import type { AppError } from '../../../http/errors.js';
import { assertSellable, assertTrialAvailable, creditsGranted } from './product.js';

const PACK = {
  publicId: 'prd_1',
  name: 'Pack 8 clases',
  type: 'class_pack' as const,
  priceCents: 6_000_000,
  soldCount: 0,
  active: true,
};

describe('se puede vender', () => {
  it('un producto activo y con cupo, si', () => {
    expect(() => assertSellable(PACK)).not.toThrow();
  });

  it('uno archivado, no, y el mensaje lo dice', () => {
    try {
      assertSellable({ ...PACK, active: false });
      expect.unreachable();
    } catch (error) {
      expect((error as AppError).code).toBe('LP-PROD-422-001');
      expect((error as AppError).message).toContain('archivado');
    }
  });

  it('uno que agoto su cupo, tampoco, y dice cuantas eran', () => {
    try {
      assertSellable({ ...PACK, maxSales: 20, soldCount: 20 });
      expect.unreachable();
    } catch (error) {
      // Un "no se puede" sin motivo obliga al mostrador a adivinar delante del socio.
      expect((error as AppError).message).toContain('20');
    }
  });

  it('con cupo y una venta menos, todavia se vende', () => {
    expect(() => assertSellable({ ...PACK, maxSales: 20, soldCount: 19 })).not.toThrow();
  });

  it('sin cupo declarado no hay tope', () => {
    expect(() => assertSellable({ ...PACK, soldCount: 9999 })).not.toThrow();
  });
});

describe('clase de prueba, una sola vez por persona (§2.1.17)', () => {
  it('la primera se puede', () => {
    expect(() => assertTrialAvailable('trial', false)).not.toThrow();
  });

  it('la segunda no', () => {
    try {
      assertTrialAvailable('trial', true);
      expect.unreachable();
    } catch (error) {
      expect((error as AppError).code).toBe('LP-PROD-409-002');
    }
  });

  it('la regla no aplica a los demas tipos: un pack se compra las veces que quiera', () => {
    expect(() => assertTrialAvailable('class_pack', true)).not.toThrow();
    expect(() => assertTrialAvailable('drop_in', true)).not.toThrow();
  });
});

describe('creditos que entrega una compra', () => {
  it('los tipos por credito entregan los suyos', () => {
    expect(creditsGranted('class_pack', 8)).toBe(8);
    expect(creditsGranted('drop_in', 1)).toBe(1);
    expect(creditsGranted('personal_training', 4)).toBe(4);
  });

  it('las membresias y los eventos entregan cero: su validez es la vigencia', () => {
    expect(creditsGranted('membership_unlimited', undefined)).toBe(0);
    expect(creditsGranted('membership_limited', undefined)).toBe(0);
    expect(creditsGranted('event', undefined)).toBe(0);
  });
});

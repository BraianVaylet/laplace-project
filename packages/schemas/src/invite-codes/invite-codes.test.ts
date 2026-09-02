import { describe, expect, it } from 'vitest';
import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  createInviteCodeSchema,
  inviteCodeStatusSchema,
  normalizeInviteCode,
  redeemInviteCodeSchema,
} from './index.js';

const VALIDO = { venueId: 'ven_abc123', maxUses: 50, expiresAt: '2026-12-31T23:59:59Z' };

describe('generacion de codigo', () => {
  it('pide sede, limite de usos y vencimiento', () => {
    const parsed = createInviteCodeSchema.parse(VALIDO);

    expect(parsed.venueId).toBe('ven_abc123');
    expect(parsed.maxUses).toBe(50);
  });

  it('el limite de usos es un entero de al menos 1', () => {
    for (const invalido of [0, -1, 2.5]) {
      expect(() => createInviteCodeSchema.parse({ ...VALIDO, maxUses: invalido })).toThrow();
    }
  });

  it('el vencimiento es un instante ISO', () => {
    expect(() => createInviteCodeSchema.parse({ ...VALIDO, expiresAt: '2026-12-31' })).toThrow();
    expect(() => createInviteCodeSchema.parse({ ...VALIDO, expiresAt: 'mañana' })).toThrow();
  });

  it('el codigo NO se elige: lo genera el sistema', () => {
    // Si el centro pudiera escribirlo, dos centros elegirian "VERANO2026" y el
    // canje dejaria de saber a cual de los dos asociar a la persona.
    expect('code' in createInviteCodeSchema.shape).toBe(false);
  });
});

describe('forma del codigo', () => {
  it('no usa caracteres que se confunden al dictarlos por telefono', () => {
    for (const ambiguo of ['O', '0', 'I', '1', 'L']) {
      expect(INVITE_CODE_ALPHABET, ambiguo).not.toContain(ambiguo);
    }
  });

  it('tiene entropia de sobra para que adivinarlo no sea una opcion', () => {
    // 31^8 ≈ 8.5e11 combinaciones. Con el rate limit de F0-03 delante, probar
    // codigos al azar no es un camino viable.
    expect(INVITE_CODE_LENGTH).toBeGreaterThanOrEqual(8);
    expect(INVITE_CODE_ALPHABET.length ** INVITE_CODE_LENGTH).toBeGreaterThan(1e11);
  });
});

describe('canje', () => {
  const QUIEN = { firstName: 'Juan', lastName: 'Pérez' };

  it('acepta el codigo como lo dicta el usuario', () => {
    expect(redeemInviteCodeSchema.parse({ ...QUIEN, code: 'abcd-2345' }).code).toBe('ABCD2345');
    expect(redeemInviteCodeSchema.parse({ ...QUIEN, code: ' ABCD 2345 ' }).code).toBe('ABCD2345');
  });

  it('pide nombre y apellido: no se parten del nombre de la cuenta', () => {
    expect(() => redeemInviteCodeSchema.parse({ code: 'ABCD2345' })).toThrow();
  });

  it('normaliza guiones, espacios y mayusculas', () => {
    // El usuario lo copia de un WhatsApp o lo escucha por telefono. Rechazarlo
    // por un guion de mas es hacerle perder el alta a un socio que ya quiso.
    expect(normalizeInviteCode('ab-cd 23 45')).toBe('ABCD2345');
  });

  it('un codigo vacio no es un codigo', () => {
    expect(() => redeemInviteCodeSchema.parse({ ...QUIEN, code: '' })).toThrow();
    expect(() => redeemInviteCodeSchema.parse({ ...QUIEN, code: '---' })).toThrow();
  });
});

describe('estados del codigo', () => {
  it('son los cuatro que el staff necesita distinguir', () => {
    for (const estado of ['active', 'expired', 'exhausted', 'revoked'] as const) {
      expect(() => inviteCodeStatusSchema.parse(estado), estado).not.toThrow();
    }
  });
});

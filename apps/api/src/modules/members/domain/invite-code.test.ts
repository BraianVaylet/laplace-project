import { describe, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { INVITE_CODE_ALPHABET, INVITE_CODE_LENGTH } from '@laplace/schemas';
import { generateInviteCode, resolveInviteCodeStatus } from './invite-code.js';

const AHORA = Temporal.Instant.from('2026-09-01T12:00:00Z');
const VIGENTE = {
  revokedAt: null,
  expiresAt: Temporal.Instant.from('2026-12-31T23:59:59Z'),
  usedCount: 0,
  maxUses: 50,
};

describe('estado del codigo', () => {
  it('vigente mientras no venza, no se agote y no lo revoquen', () => {
    expect(resolveInviteCodeStatus(VIGENTE, AHORA)).toBe('active');
  });

  it('vencido cuando paso su fecha', () => {
    const vencido = { ...VIGENTE, expiresAt: Temporal.Instant.from('2026-08-31T23:59:59Z') };

    expect(resolveInviteCodeStatus(vencido, AHORA)).toBe('expired');
  });

  it('agotado cuando llego a su limite de usos', () => {
    expect(resolveInviteCodeStatus({ ...VIGENTE, usedCount: 50 }, AHORA)).toBe('exhausted');
  });

  it('revocado gana sobre todo lo demas', () => {
    // Si el codigo se filtro, lo que importa es que esta cortado, no que ademas
    // le quedaban usos.
    const revocado = { ...VIGENTE, revokedAt: Temporal.Instant.from('2026-08-15T10:00:00Z') };

    expect(resolveInviteCodeStatus(revocado, AHORA)).toBe('revoked');
    expect(resolveInviteCodeStatus({ ...revocado, usedCount: 50 }, AHORA)).toBe('revoked');
  });

  it('justo en el instante del vencimiento ya no sirve', () => {
    const justo = { ...VIGENTE, expiresAt: AHORA };

    expect(resolveInviteCodeStatus(justo, AHORA)).toBe('expired');
  });

  it('el ultimo uso disponible todavia lo deja vigente', () => {
    expect(resolveInviteCodeStatus({ ...VIGENTE, usedCount: 49 }, AHORA)).toBe('active');
  });
});

describe('generacion del codigo', () => {
  it('usa el alfabeto y el largo declarados', () => {
    const code = generateInviteCode();

    expect(code).toHaveLength(INVITE_CODE_LENGTH);
    for (const char of code) expect(INVITE_CODE_ALPHABET, code).toContain(char);
  });

  it('no repite: mil codigos son mil codigos distintos', () => {
    const codes = new Set(Array.from({ length: 1000 }, () => generateInviteCode()));

    expect(codes.size).toBe(1000);
  });

  it('no se sesga hacia el principio del alfabeto', () => {
    // Un `% alfabeto.length` sobre bytes de 0..255 hace que las primeras letras
    // salgan mas seguido. Con 31 letras el sesgo es chico pero real, y en un
    // codigo de invitacion adivinable el sesgo es exactamente lo que no se
    // quiere: se descartan los bytes que caen fuera del rango parejo.
    const cuenta = new Map<string, number>();
    for (let i = 0; i < 20_000; i += 1) {
      for (const char of generateInviteCode()) {
        cuenta.set(char, (cuenta.get(char) ?? 0) + 1);
      }
    }

    const esperado = (20_000 * INVITE_CODE_LENGTH) / INVITE_CODE_ALPHABET.length;
    for (const [char, veces] of cuenta) {
      // Margen amplio: lo que se caza es un sesgo sistematico, no el ruido.
      expect(veces / esperado, char).toBeGreaterThan(0.85);
      expect(veces / esperado, char).toBeLessThan(1.15);
    }
  });
});

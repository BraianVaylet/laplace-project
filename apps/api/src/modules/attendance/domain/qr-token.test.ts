import { describe, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { QR_TOKEN_TTL_SECONDS, assertTokenUsable, hashToken, newCheckInToken } from './qr-token.js';
import type { AppError } from '../../../http/errors.js';

/**
 * El QR de la WAFM (§2.1.18). El token es de **vida corta y un solo uso** por un
 * motivo concreto: la captura de pantalla que el socio le manda a su amiga por
 * WhatsApp no tiene que servir para entrar.
 *
 * Y lo que se guarda es el **hash**: una base de datos con los tokens en claro
 * es una base de datos de llaves de la puerta.
 */
const AHORA = Temporal.Instant.from('2026-03-03T09:45:00Z');

describe('el token del QR', () => {
  it('dura 30 segundos', () => {
    const token = newCheckInToken(AHORA);

    expect(QR_TOKEN_TTL_SECONDS).toBe(30);
    expect(token.expiresAt.toString()).toBe('2026-03-03T09:45:30Z');
  });

  it('nunca sale dos veces el mismo', () => {
    const emitidos = new Set(Array.from({ length: 200 }, () => newCheckInToken(AHORA).token));

    expect(emitidos.size).toBe(200);
  });

  it('se guarda hasheado, no en claro', () => {
    const token = newCheckInToken(AHORA);

    expect(token.tokenHash).not.toBe(token.token);
    expect(token.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    // El mismo token hashea siempre igual: es lo que permite buscarlo.
    expect(hashToken(token.token)).toBe(token.tokenHash);
  });

  it('el token en claro es apto para un QR: sin caracteres raros', () => {
    expect(newCheckInToken(AHORA).token).toMatch(/^[0-9A-Za-z_-]{32,}$/);
  });
});

describe('cuándo un token deja de valer', () => {
  const vigente = { expiresAt: Temporal.Instant.from('2026-03-03T09:45:30Z'), usedAt: null };

  it('dentro de su ventana, vale', () => {
    expect(() => assertTokenUsable(vigente, AHORA)).not.toThrow();
  });

  it('vencido, no', () => {
    const tarde = Temporal.Instant.from('2026-03-03T09:46:00Z');

    try {
      assertTokenUsable(vigente, tarde);
      throw new Error('tenía que rechazar');
    } catch (error) {
      expect((error as AppError).code).toBe('LP-ATTD-422-004');
    }
  });

  it('ya usado, tampoco: es de un solo uso', () => {
    const usado = { ...vigente, usedAt: Temporal.Instant.from('2026-03-03T09:45:10Z') };

    try {
      assertTokenUsable(usado, AHORA);
      throw new Error('tenía que rechazar');
    } catch (error) {
      // Dos personas con la misma captura entrarían las dos.
      expect((error as AppError).code).toBe('LP-ATTD-422-004');
    }
  });
});

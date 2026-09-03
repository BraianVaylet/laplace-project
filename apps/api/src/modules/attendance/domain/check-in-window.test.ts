import { describe, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { DEFAULT_BOOKING_POLICY, type BookingPolicy } from '@laplace/schemas';
import { assertWithinCheckInWindow, checkInWindowOf } from './check-in-window.js';
import type { AppError } from '../../../http/errors.js';

/**
 * La ventana de check-in de §2.1.5.c: abre 30 minutos antes y cierra 30 después
 * del inicio.
 *
 * Los dos bordes existen por motivos distintos. El de adelante evita que el
 * socio marque presente el martes la clase del jueves; el de atrás es el que
 * hace que el no-show signifique algo: sin cierre, el que faltó podría marcarse
 * presente al día siguiente.
 */
const CLASE = Temporal.Instant.from('2026-03-10T13:00:00Z');

const politica = (overrides: Partial<BookingPolicy> = {}): BookingPolicy => ({
  ...DEFAULT_BOOKING_POLICY,
  ...overrides,
});

describe('la ventana de check-in', () => {
  it('abre 30 minutos antes y cierra 30 después, que son los defaults', () => {
    const ventana = checkInWindowOf(politica(), CLASE);

    expect(ventana.opensAt.toString()).toBe('2026-03-10T12:30:00Z');
    expect(ventana.closesAt.toString()).toBe('2026-03-10T13:30:00Z');
  });

  it('antes de que abra, no se puede marcar presente', () => {
    try {
      assertWithinCheckInWindow(politica(), CLASE, Temporal.Instant.from('2026-03-10T11:00:00Z'));
      throw new Error('tenía que rechazar');
    } catch (error) {
      expect((error as AppError).code).toBe('LP-ATTD-422-002');
      // El mensaje dice desde cuándo, en la hora del centro.
      expect((error as AppError).message).toContain('09:30');
    }
  });

  it('pasada la ventana, tampoco: si no, el no-show no significaría nada', () => {
    try {
      assertWithinCheckInWindow(politica(), CLASE, Temporal.Instant.from('2026-03-10T14:00:00Z'));
      throw new Error('tenía que rechazar');
    } catch (error) {
      expect((error as AppError).code).toBe('LP-ATTD-422-002');
    }
  });

  it('durante la clase, sí', () => {
    expect(() =>
      assertWithinCheckInWindow(politica(), CLASE, Temporal.Instant.from('2026-03-10T13:05:00Z')),
    ).not.toThrow();
  });

  it('el centro puede abrirla antes para las clases con vestuario', () => {
    const amplia = politica({ checkInOpensMinutesBefore: 90 });

    expect(() =>
      assertWithinCheckInWindow(amplia, CLASE, Temporal.Instant.from('2026-03-10T11:45:00Z')),
    ).not.toThrow();
  });
});

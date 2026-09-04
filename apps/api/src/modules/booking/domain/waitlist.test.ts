import { describe, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { DEFAULT_BOOKING_POLICY, type BookingPolicy } from '@laplace/schemas';
import {
  assertWaitlistHasRoom,
  canPromote,
  holdExpiresAt,
  nextPosition,
  repositionAfter,
} from './waitlist.js';
import type { AppError } from '../../../http/errors.js';

/**
 * La lista de espera de §2.1.5.b: FIFO estricto, con ventana de confirmación y
 * promoción **automática**.
 *
 * La regla que se está protegiendo es simple de decir y fácil de romper: quien
 * llegó primero entra primero, y nadie pierde su lugar por un error de cálculo
 * de posiciones cuando alguien del medio se borra.
 */
const CLASE = Temporal.Instant.from('2026-03-10T13:00:00Z');

const politica = (overrides: Partial<BookingPolicy> = {}): BookingPolicy => ({
  ...DEFAULT_BOOKING_POLICY,
  ...overrides,
});

describe('el orden de la fila', () => {
  it('el primero en llegar es el 1, no el 0', () => {
    // La posición se le muestra al socio: "sos el 0 de la lista" no existe.
    expect(nextPosition(0)).toBe(1);
    expect(nextPosition(3)).toBe(4);
  });

  it('cuando se va alguien del medio, los de atrás suben uno', () => {
    const fila = [
      { publicId: 'bkg_1', waitlistPosition: 1 },
      { publicId: 'bkg_2', waitlistPosition: 2 },
      { publicId: 'bkg_3', waitlistPosition: 3 },
    ];

    expect(repositionAfter(fila, 'bkg_2')).toEqual([{ publicId: 'bkg_3', waitlistPosition: 2 }]);
  });

  it('cuando se va el último, nadie se mueve', () => {
    const fila = [
      { publicId: 'bkg_1', waitlistPosition: 1 },
      { publicId: 'bkg_2', waitlistPosition: 2 },
    ];

    expect(repositionAfter(fila, 'bkg_2')).toEqual([]);
  });
});

describe('el tamaño máximo de la lista', () => {
  it('deja entrar mientras haya lugar', () => {
    expect(() => assertWaitlistHasRoom(politica(), 19, 'ses_1')).not.toThrow();
  });

  it('llena, responde LP-BOOK-422-008', () => {
    try {
      assertWaitlistHasRoom(politica(), 20, 'ses_1');
      throw new Error('tenía que rechazar');
    } catch (error) {
      expect((error as AppError).code).toBe('LP-BOOK-422-008');
    }
  });

  it('con `waitlistMaxSize: 0` el centro no tiene lista de espera', () => {
    try {
      assertWaitlistHasRoom(politica({ waitlistMaxSize: 0 }), 0, 'ses_1');
      throw new Error('tenía que rechazar');
    } catch (error) {
      expect((error as AppError).code).toBe('LP-BOOK-422-008');
    }
  });
});

describe('hasta cuándo se promueve', () => {
  it('con una hora por delante, se promueve', () => {
    expect(canPromote(politica(), CLASE, Temporal.Instant.from('2026-03-10T12:00:00Z'))).toBe(true);
  });

  it('dentro del cutoff de 30 minutos, ya no', () => {
    // Avisarle a alguien 20 minutos antes es mandarlo a llegar tarde.
    expect(canPromote(politica(), CLASE, Temporal.Instant.from('2026-03-10T12:40:00Z'))).toBe(
      false,
    );
  });

  it('empezada la clase, tampoco', () => {
    expect(canPromote(politica(), CLASE, Temporal.Instant.from('2026-03-10T13:30:00Z'))).toBe(
      false,
    );
  });

  it('el centro puede correr el corte', () => {
    const sinCorte = politica({ waitlistPromotionCutoffMinutes: 0 });

    expect(canPromote(sinCorte, CLASE, Temporal.Instant.from('2026-03-10T12:59:00Z'))).toBe(true);
  });
});

describe('la ventana para confirmar', () => {
  it('son 15 minutos desde el aviso, por default', () => {
    const ahora = Temporal.Instant.from('2026-03-10T12:00:00Z');

    expect(holdExpiresAt(politica(), CLASE, ahora).toString()).toBe('2026-03-10T12:15:00Z');
  });

  it('nunca se estira más allá del inicio de la clase', () => {
    // A 5 minutos del inicio, una ventana de 15 dejaría el lugar bloqueado
    // hasta después de que la clase empezó, y nadie más podría tomarlo.
    const ahora = Temporal.Instant.from('2026-03-10T12:55:00Z');

    expect(holdExpiresAt(politica(), CLASE, ahora).toString()).toBe('2026-03-10T13:00:00Z');
  });
});

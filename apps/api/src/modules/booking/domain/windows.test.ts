import { describe, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import {
  DEFAULT_BOOKING_POLICY,
  effectiveBookingPolicy as policyFor,
  type BookingPolicy,
} from '@laplace/schemas';
import { AppError } from '../../../http/errors.js';
import {
  assertWithinBookingWindow,
  bookingWindowOf,
  cancelCutoffAt,
  isLateCancel,
  policyText,
} from './windows.js';

/**
 * Las cinco ventanas de §2.1.5.c. Son aritmética de calendario, así que viven
 * en el dominio y se prueban sin base ni HTTP.
 *
 * Todo se evalúa contra instantes, nunca contra "la fecha de hoy": una clase de
 * las 6:00 en Buenos Aires y el reloj del servidor en UTC son el mismo instante
 * o el producto se equivoca de día.
 */
const CLASE = Temporal.Instant.from('2026-03-10T13:00:00Z'); // martes 10:00 en AR

const politica = (overrides: Partial<BookingPolicy> = {}): BookingPolicy => ({
  ...DEFAULT_BOOKING_POLICY,
  ...overrides,
});

describe('la ventana de reserva', () => {
  it('abre 7 días antes y cierra 15 minutos antes, que son los defaults', () => {
    const ventana = bookingWindowOf(politica(), CLASE);

    expect(ventana.opensAt.toString()).toBe('2026-03-03T13:00:00Z');
    expect(ventana.closesAt.toString()).toBe('2026-03-10T12:45:00Z');
  });

  it('antes de que abra, no se reserva', () => {
    const temprano = Temporal.Instant.from('2026-03-01T13:00:00Z');

    expect(() => assertWithinBookingWindow(politica(), CLASE, temprano)).toThrow(AppError);
    try {
      assertWithinBookingWindow(politica(), CLASE, temprano);
    } catch (error) {
      expect((error as AppError).code).toBe('LP-BOOK-422-003');
      // El mensaje dice desde cuándo: "todavía no" sin fecha no sirve de nada.
      expect((error as AppError).message).toContain('3 de marzo');
    }
  });

  it('pasado el cierre, tampoco', () => {
    const sobreLaHora = Temporal.Instant.from('2026-03-10T12:50:00Z');

    try {
      assertWithinBookingWindow(politica(), CLASE, sobreLaHora);
      throw new Error('tenía que rechazar');
    } catch (error) {
      expect((error as AppError).code).toBe('LP-BOOK-422-003');
      expect((error as AppError).message).toContain('cerraron');
    }
  });

  it('en el medio, sí', () => {
    const aTiempo = Temporal.Instant.from('2026-03-09T13:00:00Z');

    expect(() => assertWithinBookingWindow(politica(), CLASE, aTiempo)).not.toThrow();
  });

  it('el borde exacto de la apertura ya cuenta como abierta', () => {
    const justo = Temporal.Instant.from('2026-03-03T13:00:00Z');

    expect(() => assertWithinBookingWindow(politica(), CLASE, justo)).not.toThrow();
  });
});

describe('el corte de cancelación', () => {
  it('cae 2 horas antes del inicio con el default', () => {
    expect(cancelCutoffAt(politica(), CLASE).toString()).toBe('2026-03-10T11:00:00Z');
  });

  it('cancelar antes del corte no es tarde', () => {
    expect(isLateCancel(politica(), CLASE, Temporal.Instant.from('2026-03-10T10:00:00Z'))).toBe(
      false,
    );
  });

  it('cancelar después sí lo es', () => {
    expect(isLateCancel(politica(), CLASE, Temporal.Instant.from('2026-03-10T12:00:00Z'))).toBe(
      true,
    );
  });

  it('con `cancelCutoffMinutes: 0` nunca es tarde: el centro no penaliza', () => {
    const sinCorte = politica({ cancelCutoffMinutes: 0 });

    expect(isLateCancel(sinCorte, CLASE, Temporal.Instant.from('2026-03-10T12:59:00Z'))).toBe(
      false,
    );
  });
});

describe('la política por categoría le pisa a la del centro (§2.1.5.c)', () => {
  const conSpinning = politica({
    categoryPolicies: { spinning: { cancelCutoffMinutes: 720, bookingOpensMinutesBefore: 60 } },
  });

  it('la categoría con excepción usa la suya', () => {
    const spinning = policyFor(conSpinning, 'spinning');

    expect(spinning.cancelCutoffMinutes).toBe(720);
    expect(spinning.bookingOpensMinutesBefore).toBe(60);
  });

  it('lo que la categoría no pisa lo sigue poniendo el centro', () => {
    const spinning = policyFor(conSpinning, 'spinning');

    expect(spinning.bookingClosesMinutesBefore).toBe(
      DEFAULT_BOOKING_POLICY.bookingClosesMinutesBefore,
    );
    expect(spinning.allowDebt).toBe(false);
  });

  it('una categoría sin excepción usa la del centro entera', () => {
    expect(policyFor(conSpinning, 'funcional').cancelCutoffMinutes).toBe(120);
  });
});

describe('el texto de la política (§2.1.5.d)', () => {
  const texto = policyText(politica(), CLASE, 'America/Argentina/Buenos_Aires');

  it('dice hasta cuándo se puede cancelar, en la hora del centro', () => {
    // 11:00 UTC es 08:00 en Buenos Aires: mostrarle UTC al socio sería mentirle.
    expect(texto).toContain('08:00');
  });

  it('dice qué pasa si cancela tarde', () => {
    expect(texto).toContain('no se te devuelve');
  });

  it('con la política generosa, dice lo contrario', () => {
    const generoso = policyText(
      politica({ lateCancelPolicy: 'refund' }),
      CLASE,
      'America/Argentina/Buenos_Aires',
    );

    expect(generoso).toContain('se te devuelve');
    expect(generoso).not.toContain('no se te devuelve');
  });
});

import { describe, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { DEFAULT_BOOKING_POLICY, type BookingPolicy } from '@laplace/schemas';
import { blockUntil, isNoShowDue, noShowWindowStart } from './no-show.js';

/**
 * El no-show y su penalización (§2.1.5.d), que es la práctica estándar del
 * sector: quien reserva y no va le sacó el lugar a otro.
 *
 * Lo que se cuida acá es no castigar de más. La ventana de check-in tiene que
 * haber cerrado —el que llegó tarde no es un ausente— y el umbral se cuenta en
 * una ventana móvil, no desde que el socio existe: tres faltas en tres años no
 * son las tres faltas de un mes.
 */
const CLASE = Temporal.Instant.from('2026-03-10T13:00:00Z');

const politica = (overrides: Partial<BookingPolicy> = {}): BookingPolicy => ({
  ...DEFAULT_BOOKING_POLICY,
  ...overrides,
});

describe('cuándo una reserva ya es un ausente', () => {
  it('durante la clase todavía no: el socio puede estar llegando', () => {
    // El check-in cierra 30 minutos después del inicio, por default.
    expect(isNoShowDue(politica(), CLASE, Temporal.Instant.from('2026-03-10T13:20:00Z'))).toBe(
      false,
    );
  });

  it('cerrada la ventana de check-in, sí', () => {
    expect(isNoShowDue(politica(), CLASE, Temporal.Instant.from('2026-03-10T13:31:00Z'))).toBe(
      true,
    );
  });

  it('el borde exacto todavía no cuenta: el que llega justo, llegó', () => {
    expect(isNoShowDue(politica(), CLASE, Temporal.Instant.from('2026-03-10T13:30:00Z'))).toBe(
      false,
    );
  });
});

describe('desde cuándo se cuentan las faltas', () => {
  it('la ventana por default es de 30 días', () => {
    const ahora = Temporal.Instant.from('2026-03-10T13:00:00Z');

    expect(noShowWindowStart(politica(), ahora).toString()).toBe('2026-02-08T13:00:00Z');
  });
});

describe('el bloqueo por faltas', () => {
  const ahora = Temporal.Instant.from('2026-03-10T14:00:00Z');

  it('por debajo del umbral no bloquea', () => {
    // Con el umbral en 3, la segunda falta todavía no penaliza.
    expect(blockUntil(politica(), 2, ahora)).toBeNull();
  });

  it('alcanzado el umbral, bloquea por el tiempo configurado', () => {
    const hasta = blockUntil(politica(), 3, ahora);

    // 48 horas es el default de §2.1.5.d.
    expect(hasta?.toString()).toBe('2026-03-12T14:00:00Z');
  });

  it('pasado el umbral sigue bloqueando: la cuarta falta no es gratis', () => {
    expect(blockUntil(politica(), 5, ahora)).not.toBeNull();
  });

  it('con el umbral en 0 el centro no penaliza, y no bloquea nunca', () => {
    // La falta se marca igual: la métrica se mide siempre (§2.1.5.d).
    expect(blockUntil(politica({ noShowThreshold: 0 }), 10, ahora)).toBeNull();
  });

  it('con el bloqueo en 0 minutos tampoco: el centro solo quiere contarlas', () => {
    expect(blockUntil(politica({ noShowBlockMinutes: 0 }), 3, ahora)).toBeNull();
  });
});

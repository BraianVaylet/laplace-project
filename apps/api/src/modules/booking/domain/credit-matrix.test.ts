import { describe, expect, it } from 'vitest';
import { CREDIT_EVENTS, creditEffectOf } from './credit-matrix.js';

/**
 * 🔴 §Testing.5: **la matriz completa de consumo de crédito**, una fila por
 * caso de la tabla de §2.1.9.
 *
 * Es la tabla que decide si el producto se siente justo o arbitrario, y está
 * acá — en una función pura — y no repartida por los servicios, porque la misma
 * regla la consultan Booking, Schedule, Contracts, Attendance y el job de
 * no-shows. Cinco copias de una regla de plata son cinco versiones de la verdad.
 */
const SIN_DEVOLUCION = { lateCancelPolicy: 'no_refund' } as const;

describe('la matriz de §2.1.9, fila por fila', () => {
  it('reserva creada: se descuenta 1 crédito', () => {
    expect(creditEffectOf('booking_created', SIN_DEVOLUCION)).toBe('consume');
  });

  it('cancelación dentro del plazo: se devuelve', () => {
    expect(creditEffectOf('cancelled_in_time', SIN_DEVOLUCION)).toBe('refund');
  });

  it('cancelación fuera de plazo: no se devuelve', () => {
    expect(creditEffectOf('late_cancelled', SIN_DEVOLUCION)).toBe('keep');
  });

  it('no-show: no se devuelve', () => {
    expect(creditEffectOf('no_show', SIN_DEVOLUCION)).toBe('keep');
  });

  it('clase cancelada por el centro: se devuelve', () => {
    // El socio no hizo nada mal: acá no se mira ninguna ventana.
    expect(creditEffectOf('session_cancelled', SIN_DEVOLUCION)).toBe('refund');
  });

  it('contrato congelado: se devuelve', () => {
    expect(creditEffectOf('contract_frozen', SIN_DEVOLUCION)).toBe('refund');
  });

  it('walk-in sin reserva: se descuenta en el check-in', () => {
    // Único camino donde el consumo no ocurre al reservar (ADR-001).
    expect(creditEffectOf('walk_in', SIN_DEVOLUCION)).toBe('consume_at_check_in');
  });

  it('ajuste manual del staff: queda auditado', () => {
    expect(creditEffectOf('manual_adjustment', SIN_DEVOLUCION)).toBe('audited');
  });

  it('las ocho filas están cubiertas y ninguna quedó sin efecto', () => {
    expect(CREDIT_EVENTS).toHaveLength(8);
    for (const evento of CREDIT_EVENTS) {
      expect(creditEffectOf(evento, SIN_DEVOLUCION)).toBeTruthy();
    }
  });
});

describe('el late cancel es lo único configurable de la tabla (§2.1.5.d)', () => {
  it('con `refund` el crédito vuelve aunque haya cancelado tarde', () => {
    expect(creditEffectOf('late_cancelled', { lateCancelPolicy: 'refund' })).toBe('refund');
  });

  it('con `refund_and_notify` también vuelve, y además se avisa', () => {
    expect(creditEffectOf('late_cancelled', { lateCancelPolicy: 'refund_and_notify' })).toBe(
      'refund',
    );
  });

  it('ninguna otra fila cambia con la política del centro', () => {
    const generoso = { lateCancelPolicy: 'refund' } as const;

    expect(creditEffectOf('no_show', generoso)).toBe('keep');
    expect(creditEffectOf('booking_created', generoso)).toBe('consume');
  });
});

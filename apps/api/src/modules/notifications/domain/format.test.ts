import { describe, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { fechaLarga, horaDe, montoDe } from './format.js';

const AR = 'America/Argentina/Buenos_Aires';

describe('la fecha adentro del aviso', () => {
  it('sale en castellano y en la zona del centro', () => {
    // 2026-03-09T22:00Z es el lunes 9 a las 19:00 en Buenos Aires.
    const local = Temporal.Instant.from('2026-03-09T22:00:00Z').toZonedDateTimeISO(AR);

    expect(fechaLarga(local)).toBe('lunes 9 de marzo');
    expect(horaDe(local)).toBe('19:00');
  });

  it('🔴 la hora es la del socio, no la del servidor', () => {
    // El mismo instante es martes 10 a las 07:00 en Tokio.
    const instante = Temporal.Instant.from('2026-03-09T22:00:00Z');

    expect(horaDe(instante.toZonedDateTimeISO(AR))).toBe('19:00');
    expect(horaDe(instante.toZonedDateTimeISO('Asia/Tokyo'))).toBe('07:00');
    expect(fechaLarga(instante.toZonedDateTimeISO('Asia/Tokyo'))).toBe('martes 10 de marzo');
  });

  it('el domingo es el último día de la semana, no el primero', () => {
    const domingo = Temporal.Instant.from('2026-03-08T15:00:00Z').toZonedDateTimeISO(AR);

    expect(fechaLarga(domingo)).toBe('domingo 8 de marzo');
  });
});

describe('el monto adentro del aviso', () => {
  it('sale en pesos, con separador de miles', () => {
    expect(montoDe(1_800_000)).toBe('$18.000');
  });

  it('el centavo suelto no aparece: el aviso no es un recibo', () => {
    expect(montoDe(1_800_050)).toBe('$18.001');
  });
});

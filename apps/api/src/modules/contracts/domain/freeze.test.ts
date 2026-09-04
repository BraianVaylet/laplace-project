import { describe, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import type { AppError } from '../../../http/errors.js';
import { assertFreezeAllowed, expiryMilestone, shiftExpiry } from './freeze.js';

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';
/** Chile cambia de hora: es donde el cálculo se rompe si se suman horas. */
const SANTIAGO = 'America/Santiago';

describe('corrimiento del vencimiento', () => {
  it('corre los días declarados', () => {
    const vence = Temporal.Instant.from('2026-03-15T22:00:00Z');

    const corrido = shiftExpiry(vence, 10, BUENOS_AIRES);

    expect(corrido.toZonedDateTimeISO(BUENOS_AIRES).toPlainDate().toString()).toBe('2026-03-25');
  });

  it('mantiene la hora local aunque en el medio cambie el horario de verano', () => {
    /*
     * §Testing.6, obligatorio: 30 días son 30 días, no 30×24 h. En Santiago el
     * 6 de septiembre de 2026 se adelanta el reloj, así que ese día dura 23
     * horas. Sumando milisegundos, el pack que se vendió venciendo a las 19:00
     * pasaría a vencer a las 20:00 — y en el cambio del otro sentido, a las
     * 18:00. En los dos casos deja de coincidir con lo que se vendió.
     */
    const vence = Temporal.ZonedDateTime.from('2026-08-25T19:00[America/Santiago]').toInstant();

    const corrido = shiftExpiry(vence, 30, SANTIAGO);
    const local = corrido.toZonedDateTimeISO(SANTIAGO);

    expect(local.toPlainTime().toString({ smallestUnit: 'minute' })).toBe('19:00');
    expect(local.toPlainDate().toString()).toBe('2026-09-24');
  });

  it('sumar horas daría un resultado distinto: es el bug que este cálculo evita', () => {
    const vence = Temporal.ZonedDateTime.from('2026-08-25T19:00[America/Santiago]').toInstant();

    const correcto = shiftExpiry(vence, 30, SANTIAGO);
    const ingenuo = vence.add({ hours: 30 * 24 });

    // Chile adelanta el reloj el 6 de septiembre, así que ese día dura 23 horas
    // y 30×24 h caen una hora más tarde que 30 días de calendario.
    expect(ingenuo.until(correcto).total({ unit: 'hour' })).toBe(-1);

    // Lo que importa no es la hora de diferencia sino que el ingenuo mueve la
    // hora LOCAL del vencimiento: el pack se vendió venciendo a las 19:00.
    expect(
      ingenuo.toZonedDateTimeISO(SANTIAGO).toPlainTime().toString({ smallestUnit: 'minute' }),
    ).toBe('20:00');
  });

  it('en una zona sin cambio de hora da lo mismo, y tiene que seguir dando lo mismo', () => {
    const vence = Temporal.ZonedDateTime.from(
      '2026-03-01T19:00[America/Argentina/Buenos_Aires]',
    ).toInstant();

    const corrido = shiftExpiry(vence, 30, BUENOS_AIRES);

    expect(corrido.epochMilliseconds).toBe(vence.add({ hours: 30 * 24 }).epochMilliseconds);
  });
});

describe('tope anual de días de congelamiento (§2.1.9)', () => {
  it('deja congelar mientras entre en el tope', () => {
    expect(() => assertFreezeAllowed({ used: 10, requested: 15, max: 30 })).not.toThrow();
  });

  it('deja usar el último día disponible', () => {
    expect(() => assertFreezeAllowed({ used: 29, requested: 1, max: 30 })).not.toThrow();
  });

  it('rechaza con LP-CTRT-422-006 y dice cuántos quedan', () => {
    try {
      assertFreezeAllowed({ used: 25, requested: 10, max: 30 });
      expect.unreachable();
    } catch (error) {
      expect((error as AppError).code).toBe('LP-CTRT-422-006');
      // Sin el número, el staff prueba de a un día hasta que entra.
      expect((error as AppError).message).toContain('5');
    }
  });

  it('con el tope en 0 el centro no habilita congelar', () => {
    expect(() => assertFreezeAllowed({ used: 0, requested: 1, max: 0 })).toThrow();
  });
});

describe('hito de aviso de vencimiento', () => {
  const at = (date: string) =>
    Temporal.ZonedDateTime.from(`${date}T08:00[${BUENOS_AIRES}]`).toInstant();

  it('reconoce los tres hitos de §2.1.9', () => {
    const vence = Temporal.ZonedDateTime.from(`2026-03-15T22:00[${BUENOS_AIRES}]`).toInstant();

    expect(expiryMilestone(vence, at('2026-03-08'), BUENOS_AIRES)).toBe(7);
    expect(expiryMilestone(vence, at('2026-03-12'), BUENOS_AIRES)).toBe(3);
    expect(expiryMilestone(vence, at('2026-03-14'), BUENOS_AIRES)).toBe(1);
  });

  it('los días que no son hito no avisan', () => {
    const vence = Temporal.ZonedDateTime.from(`2026-03-15T22:00[${BUENOS_AIRES}]`).toInstant();

    for (const dia of ['2026-03-09', '2026-03-10', '2026-03-11', '2026-03-13']) {
      expect(expiryMilestone(vence, at(dia), BUENOS_AIRES), dia).toBeNull();
    }
  });

  it('el día del vencimiento y después, tampoco: ya no es un aviso previo', () => {
    const vence = Temporal.ZonedDateTime.from(`2026-03-15T22:00[${BUENOS_AIRES}]`).toInstant();

    expect(expiryMilestone(vence, at('2026-03-15'), BUENOS_AIRES)).toBeNull();
    expect(expiryMilestone(vence, at('2026-03-20'), BUENOS_AIRES)).toBeNull();
  });

  it('cuenta días de calendario del centro, no bloques de 24 horas', () => {
    // Un pack que vence a las 23:00 del 15 sigue estando "a 1 día" a las 08:00
    // del 14, aunque falten 39 horas.
    const vence = Temporal.ZonedDateTime.from(`2026-03-15T23:00[${BUENOS_AIRES}]`).toInstant();

    expect(expiryMilestone(vence, at('2026-03-14'), BUENOS_AIRES)).toBe(1);
  });
});

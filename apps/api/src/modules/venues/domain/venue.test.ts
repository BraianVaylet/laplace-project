import { describe, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { canTransition, countsTowardPlanLimit, isOpenAt, venueToday } from './venue.js';

const BOX_TORO = { timeZone: 'America/Argentina/Buenos_Aires' };

describe('estados de la sede', () => {
  it('una sede activa se puede archivar', () => {
    expect(canTransition('active', 'archived')).toBe(true);
  });

  it('una archivada se puede reactivar', () => {
    expect(canTransition('archived', 'active')).toBe(true);
  });

  it('no hay transicion a si misma: no es un cambio de estado', () => {
    expect(canTransition('active', 'active')).toBe(false);
    expect(canTransition('archived', 'archived')).toBe(false);
  });
});

describe('limite del plan', () => {
  it('solo cuentan las activas (§2.2.1)', () => {
    expect(countsTowardPlanLimit('active')).toBe(true);
  });

  it('archivar libera el cupo, y el historico queda', () => {
    // Es la diferencia entre archivar y borrar: cerrar una sede no puede
    // costar los datos de lo que paso ahi.
    expect(countsTowardPlanLimit('archived')).toBe(false);
  });
});

describe('el dia del centro', () => {
  it('es el de SU zona, no el del servidor', () => {
    // 16/03 01:00 UTC son todavia las 22:00 del 15/03 en Buenos Aires.
    const instant = Temporal.Instant.from('2026-03-16T01:00:00Z');

    expect(venueToday(BOX_TORO, instant).toString()).toBe('2026-03-15');
    expect(venueToday({ timeZone: 'UTC' }, instant).toString()).toBe('2026-03-16');
  });
});

describe('el dia del centro cruzando DST', () => {
  /*
   * Argentina no cambia de hora desde 2009, asi que si el unico caso probado
   * fuera el de Buenos Aires este calculo pareceria correcto para siempre. Un
   * centro en Santiago o en Madrid lo rompe: el dia de calendario tiene que
   * salir de la zona del Venue, nunca de restar 24 horas.
   */
  const SANTIAGO = { timeZone: 'America/Santiago' };

  it('el dia arranca a la hora local aunque ese dia dure 23 horas', () => {
    // 2026-09-06: Chile adelanta el reloj a medianoche; ese dia tiene 23 horas.
    const antes = Temporal.Instant.from('2026-09-06T02:30:00Z'); // 22:30 del 05
    const despues = Temporal.Instant.from('2026-09-06T05:00:00Z'); // 01:00 del 06

    expect(venueToday(SANTIAGO, antes).toString()).toBe('2026-09-05');
    expect(venueToday(SANTIAGO, despues).toString()).toBe('2026-09-06');
  });

  it('sumar dias de calendario no se corre una hora en el salto', () => {
    const inicio = Temporal.ZonedDateTime.from('2026-09-05T19:00[America/Santiago]');

    // Un pack a 30 dias vence a la misma hora local, no una hora antes.
    const vence = inicio.add({ days: 30 });

    expect(vence.toPlainTime().toString({ smallestUnit: 'minute' })).toBe('19:00');
    expect(vence.toPlainDate().toString()).toBe('2026-10-05');
  });
});

describe('horarios de atencion', () => {
  const conHorarios = {
    timeZone: BOX_TORO.timeZone,
    businessHours: [
      { weekday: 1, opensAt: '07:00', closesAt: '22:00' },
      { weekday: 6, opensAt: '09:00', closesAt: '13:00' },
    ],
  };

  /** Arma un instante a partir de una hora local del centro. */
  const at = (date: string, time: string) =>
    Temporal.ZonedDateTime.from(`${date}T${time}[${BOX_TORO.timeZone}]`).toInstant();

  it('un lunes a las 10 esta abierto', () => {
    expect(isOpenAt(conHorarios, at('2026-03-16', '10:00'))).toBe(true);
  });

  it('un lunes a las 23 esta cerrado', () => {
    expect(isOpenAt(conHorarios, at('2026-03-16', '23:00'))).toBe(false);
  });

  it('un martes esta cerrado: no tiene horario declarado', () => {
    expect(isOpenAt(conHorarios, at('2026-03-17', '10:00'))).toBe(false);
  });

  it('el sabado tiene su propio horario, mas corto', () => {
    expect(isOpenAt(conHorarios, at('2026-03-21', '10:00'))).toBe(true);
    expect(isOpenAt(conHorarios, at('2026-03-21', '14:00'))).toBe(false);
  });

  it('justo en la apertura esta abierto; justo en el cierre, ya no', () => {
    expect(isOpenAt(conHorarios, at('2026-03-16', '07:00'))).toBe(true);
    expect(isOpenAt(conHorarios, at('2026-03-16', '22:00'))).toBe(false);
  });

  it('sin horarios cargados no bloquea nada: el centro todavia no los declaro', () => {
    const sinHorarios = { timeZone: BOX_TORO.timeZone, businessHours: [] };

    expect(isOpenAt(sinHorarios, at('2026-03-16', '03:00'))).toBe(true);
  });
});

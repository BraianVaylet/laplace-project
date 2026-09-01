import { describe, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import {
  addDaysInVenue,
  daysUntil,
  endOfWeek,
  formatDate,
  formatDateTime,
  formatLongDate,
  formatMoney,
  formatTime,
  startOfWeek,
} from './format.js';

/**
 * Fechas en la zona del **Venue**, no la del navegador (§2.1.2). El caso que
 * importa: el vencimiento de un pack a 30 dias tiene que caer el mismo dia
 * aunque el socio abra la app desde otro pais.
 */
const BUENOS_AIRES = { timeZone: 'America/Argentina/Buenos_Aires' };
const MADRID = { timeZone: 'Europe/Madrid' };

/** 15/03/2026 a las 22:00 en Buenos Aires = 16/03 01:00 UTC. */
const NOCHE = Temporal.Instant.from('2026-03-16T01:00:00Z');

describe('formato es-AR', () => {
  it('la fecha va dia/mes/año', () => {
    expect(formatDate(NOCHE, BUENOS_AIRES)).toBe('15/03/2026');
  });

  it('la hora va en 24 horas: nadie dice "clase de 7 PM" en un box', () => {
    expect(formatTime(NOCHE, BUENOS_AIRES)).toBe('22:00');
  });

  it('fecha y hora juntas', () => {
    expect(formatDateTime(NOCHE, BUENOS_AIRES)).toBe('15/03/2026 22:00');
  });

  it('la fecha larga sale en español', () => {
    const texto = formatLongDate(NOCHE, BUENOS_AIRES);

    expect(texto).toContain('marzo');
    expect(texto).toContain('15');
  });
});

describe('la zona horaria es la del centro, no la del navegador', () => {
  it('el mismo instante se lee distinto en cada sede', () => {
    // 22:00 en Buenos Aires son las 02:00 del dia siguiente en Madrid.
    expect(formatDate(NOCHE, BUENOS_AIRES)).toBe('15/03/2026');
    expect(formatDate(NOCHE, MADRID)).toBe('16/03/2026');
  });

  it('una clase de las 7:00 del centro es a las 7:00, se mire desde donde se mire', () => {
    const siete = Temporal.ZonedDateTime.from({
      timeZone: BUENOS_AIRES.timeZone,
      year: 2026,
      month: 3,
      day: 15,
      hour: 7,
    }).toInstant();

    expect(formatTime(siete, BUENOS_AIRES)).toBe('07:00');
  });
});

describe('sumar dias cruzando el cambio de horario', () => {
  /**
   * Es el test que §Testing.6 declara obligatorio. En una zona con horario de
   * verano, "30 dias" contados en horas cae una hora corrida; contados en dias
   * de calendario, no. `Date` hace lo primero, `Temporal` lo segundo.
   */
  const ZONA_CON_DST = { timeZone: 'Europe/Madrid' };

  it('30 dias son 30 dias de calendario, no 720 horas', () => {
    // El 29/03/2026 Madrid adelanta una hora (cambio a horario de verano).
    const antes = Temporal.ZonedDateTime.from({
      timeZone: ZONA_CON_DST.timeZone,
      year: 2026,
      month: 3,
      day: 15,
      hour: 10,
    }).toInstant();

    const despues = addDaysInVenue(antes, 30, ZONA_CON_DST);

    // La hora local se conserva aunque el offset haya cambiado en el medio.
    expect(formatTime(despues, ZONA_CON_DST)).toBe('10:00');
    expect(formatDate(despues, ZONA_CON_DST)).toBe('14/04/2026');
  });

  it('contar en horas daria un resultado distinto: por eso no se usa Date', () => {
    const antes = Temporal.ZonedDateTime.from({
      timeZone: ZONA_CON_DST.timeZone,
      year: 2026,
      month: 3,
      day: 15,
      hour: 10,
    }).toInstant();

    const porCalendario = addDaysInVenue(antes, 30, ZONA_CON_DST);
    const porHoras = antes.add({ hours: 30 * 24 });

    expect(porCalendario.epochMilliseconds).not.toBe(porHoras.epochMilliseconds);
    // Madrid ADELANTA una hora el 29/03, asi que 720 horas fijas caen a las
    // 11:00 locales en vez de a las 10:00. Una hora de diferencia alcanza para
    // que un pack venza el dia equivocado si el corte es a medianoche.
    expect(formatTime(porHoras, ZONA_CON_DST)).toBe('11:00');
  });

  it('en una zona sin DST el resultado es el mismo por los dos caminos', () => {
    const antes = Temporal.Instant.from('2026-03-15T13:00:00Z');

    expect(formatTime(addDaysInVenue(antes, 30, BUENOS_AIRES), BUENOS_AIRES)).toBe(
      formatTime(antes.add({ hours: 30 * 24 }), BUENOS_AIRES),
    );
  });
});

describe('dias que faltan', () => {
  const hoy = Temporal.Instant.from('2026-03-15T13:00:00Z');

  it('cuenta dias de calendario', () => {
    expect(daysUntil(Temporal.Instant.from('2026-03-22T13:00:00Z'), BUENOS_AIRES, hoy)).toBe(7);
  });

  it('hoy es cero', () => {
    expect(daysUntil(Temporal.Instant.from('2026-03-15T23:00:00Z'), BUENOS_AIRES, hoy)).toBe(0);
  });

  it('lo vencido da negativo', () => {
    expect(daysUntil(Temporal.Instant.from('2026-03-10T13:00:00Z'), BUENOS_AIRES, hoy)).toBe(-5);
  });

  it('cuenta por dia de calendario y no por 24 horas: falta 1 dia aunque falten 2 horas', () => {
    // 15/03 23:00 en Buenos Aires → el 16/03 01:00 local es "mañana".
    const casiMedianoche = Temporal.Instant.from('2026-03-16T02:00:00Z');
    const dosHorasDespues = Temporal.Instant.from('2026-03-16T04:00:00Z');

    expect(daysUntil(dosHorasDespues, BUENOS_AIRES, casiMedianoche)).toBe(1);
  });
});

describe('semana', () => {
  it('arranca el lunes, no el domingo', () => {
    // El 18/03/2026 es un miercoles.
    const miercoles = Temporal.PlainDate.from('2026-03-18');

    expect(startOfWeek(miercoles).toString()).toBe('2026-03-16');
    expect(startOfWeek(miercoles).dayOfWeek).toBe(1);
  });

  it('un lunes es su propio inicio de semana', () => {
    const lunes = Temporal.PlainDate.from('2026-03-16');

    expect(startOfWeek(lunes).toString()).toBe('2026-03-16');
  });

  it('un domingo pertenece a la semana que arranco el lunes anterior', () => {
    const domingo = Temporal.PlainDate.from('2026-03-22');

    expect(startOfWeek(domingo).toString()).toBe('2026-03-16');
  });

  it('la semana termina el domingo', () => {
    const miercoles = Temporal.PlainDate.from('2026-03-18');

    expect(endOfWeek(miercoles).toString()).toBe('2026-03-22');
    expect(endOfWeek(miercoles).dayOfWeek).toBe(7);
  });

  it('de inicio a fin hay siete dias', () => {
    const fecha = Temporal.PlainDate.from('2026-03-18');

    expect(startOfWeek(fecha).until(endOfWeek(fecha)).days).toBe(6);
  });
});

describe('dinero', () => {
  it('se guarda en centavos y se muestra en pesos (§5.2.1)', () => {
    // 60.000 pesos = 6.000.000 centavos.
    expect(formatMoney(6_000_000)).toContain('60.000');
  });

  it('lleva el simbolo de la moneda', () => {
    expect(formatMoney(100_00)).toContain('$');
  });

  it('cero es cero, no vacio', () => {
    expect(formatMoney(0)).toContain('0');
  });

  it('muestra los centavos: un pago parcial de $12,50 no se redondea a $12', () => {
    expect(formatMoney(1250)).toContain('12,50');
  });

  it('lo negativo se muestra como negativo: un reembolso no es un cobro', () => {
    expect(formatMoney(-6_000_000)).toContain('-');
  });
});

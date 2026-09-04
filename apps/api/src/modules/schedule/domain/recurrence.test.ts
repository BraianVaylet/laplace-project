import { describe, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import type { Recurrence } from '@laplace/schemas';
import type { AppError } from '../../../http/errors.js';
import { assertProducesOccurrences, expandRecurrence, overlaps } from './recurrence.js';

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';
/** Chile cambia de hora: es donde el expansor se rompe si suma horas. */
const SANTIAGO = 'America/Santiago';

const regla = (overrides: Partial<Recurrence> = {}): Recurrence => ({
  freq: 'weekly',
  byWeekday: [1, 2, 3, 4, 5],
  timeOfDay: '07:00',
  interval: 1,
  from: '2026-03-02',
  ...overrides,
});

/** Ventana desde el día `from` hasta `days` días después, en la zona dada. */
const ventana = (from: string, days: number, timeZone = BUENOS_AIRES) => ({
  from: Temporal.PlainDate.from(from).toZonedDateTime({ timeZone }).toInstant(),
  to: Temporal.PlainDate.from(from).add({ days }).toZonedDateTime({ timeZone }).toInstant(),
});

const localesDe = (instantes: Temporal.Instant[], timeZone = BUENOS_AIRES) =>
  instantes.map((instante) =>
    instante.toZonedDateTimeISO(timeZone).toString({ offset: 'never', timeZoneName: 'never' }),
  );

describe('expansión semanal', () => {
  it('lunes a viernes a las 7:00 genera 5 clases en una semana', () => {
    const clases = expandRecurrence(regla(), BUENOS_AIRES, ventana('2026-03-02', 7));

    expect(clases).toHaveLength(5);
    expect(localesDe(clases)[0]).toBe('2026-03-02T07:00:00');
    expect(localesDe(clases)[4]).toBe('2026-03-06T07:00:00');
  });

  it('respeta el día de la semana elegido', () => {
    const clases = expandRecurrence(
      regla({ byWeekday: [6] }),
      BUENOS_AIRES,
      ventana('2026-03-02', 14),
    );

    // Dos sábados en dos semanas.
    expect(localesDe(clases)).toEqual(['2026-03-07T07:00:00', '2026-03-14T07:00:00']);
  });

  it('no genera nada antes de la vigencia', () => {
    const clases = expandRecurrence(
      regla({ from: '2026-03-10' }),
      BUENOS_AIRES,
      ventana('2026-03-02', 14),
    );

    expect(localesDe(clases)[0]).toBe('2026-03-10T07:00:00');
  });

  it('no genera nada después de `until`', () => {
    const clases = expandRecurrence(
      regla({ until: '2026-03-04' }),
      BUENOS_AIRES,
      ventana('2026-03-02', 30),
    );

    expect(localesDe(clases)).toEqual([
      '2026-03-02T07:00:00',
      '2026-03-03T07:00:00',
      '2026-03-04T07:00:00',
    ]);
  });

  it('con `interval: 2` va una semana sí y una no', () => {
    const clases = expandRecurrence(
      regla({ byWeekday: [1], interval: 2 }),
      BUENOS_AIRES,
      ventana('2026-03-02', 28),
    );

    expect(localesDe(clases)).toEqual(['2026-03-02T07:00:00', '2026-03-16T07:00:00']);
  });

  it('el intervalo se cuenta desde la vigencia, no desde la ventana', () => {
    // Correr el job un mes después no puede correr la grilla: la semana par
    // sigue siendo la misma que era.
    const cada2 = regla({ byWeekday: [1], interval: 2, from: '2026-03-02' });

    const enMarzo = expandRecurrence(cada2, BUENOS_AIRES, ventana('2026-03-02', 28));
    const enAbril = expandRecurrence(cada2, BUENOS_AIRES, ventana('2026-03-30', 28));

    expect(localesDe(enMarzo)).toContain('2026-03-16T07:00:00');
    expect(localesDe(enAbril)).toContain('2026-04-13T07:00:00');
    expect(localesDe(enAbril)).not.toContain('2026-04-06T07:00:00');
  });

  it('una ventana vacía no genera nada', () => {
    expect(expandRecurrence(regla(), BUENOS_AIRES, ventana('2026-03-07', 2))).toHaveLength(0);
  });
});

describe('🔴 cambio de horario de verano (§2.1.5.a)', () => {
  it('la clase de las 7:00 sigue siendo a las 7:00 locales todo el año', () => {
    /*
     * Chile adelanta el reloj el 6 de septiembre de 2026. Expandiendo con sumas
     * de 24 h, la clase del lunes siguiente caería a las 8:00 y el socio se
     * encontraría el gimnasio cerrado.
     */
    const clases = expandRecurrence(
      regla({ byWeekday: [1, 2, 3, 4, 5, 6, 7], from: '2026-09-01' }),
      SANTIAGO,
      ventana('2026-09-01', 14, SANTIAGO),
    );

    for (const local of localesDe(clases, SANTIAGO)) {
      expect(local, local).toContain('T07:00:00');
    }
  });

  it('el instante absoluto SÍ cambia: es lo que confirma que la zona se aplicó', () => {
    const clases = expandRecurrence(
      regla({ byWeekday: [1, 2, 3, 4, 5, 6, 7], from: '2026-09-01' }),
      SANTIAGO,
      ventana('2026-09-01', 14, SANTIAGO),
    );

    const antes = clases[0] as Temporal.Instant;
    const despues = clases[13] as Temporal.Instant;
    const dias = antes.until(despues).total({ unit: 'hour' }) / 24;

    // Trece días de calendario, pero una hora menos en absoluto.
    expect(dias).toBeCloseTo(13 - 1 / 24, 5);
  });

  it('en una zona sin cambio de hora, los saltos son de 24 horas exactas', () => {
    const clases = expandRecurrence(
      regla({ byWeekday: [1, 2, 3, 4, 5, 6, 7], from: '2026-09-01' }),
      BUENOS_AIRES,
      ventana('2026-09-01', 3),
    );

    const [primero, segundo] = clases as [Temporal.Instant, Temporal.Instant];
    expect(primero.until(segundo).total({ unit: 'hour' })).toBe(24);
  });

  it('una hora que no existe por el salto se corre hacia adelante, no se pierde', () => {
    // El 6 de septiembre de 2026 en Santiago no existen las 00:30.
    const clases = expandRecurrence(
      regla({ byWeekday: [7], timeOfDay: '00:30', from: '2026-09-06', until: '2026-09-06' }),
      SANTIAGO,
      ventana('2026-09-01', 14, SANTIAGO),
    );

    expect(clases).toHaveLength(1);
    expect(localesDe(clases, SANTIAGO)[0]).toBe('2026-09-06T01:30:00');
  });
});

describe('validación de la regla', () => {
  it('una regla que genera clases es válida', () => {
    expect(() => assertProducesOccurrences(regla(), BUENOS_AIRES)).not.toThrow();
  });

  it('una vigencia de un solo día sin ese día de la semana responde LP-SCHD-422-004', () => {
    // Lunes a viernes con vigencia solo el sábado: no genera nada nunca.
    const imposible = regla({ from: '2026-03-07', until: '2026-03-07' });

    try {
      assertProducesOccurrences(imposible, BUENOS_AIRES);
      expect.unreachable();
    } catch (error) {
      expect((error as AppError).code).toBe('LP-SCHD-422-004');
    }
  });

  it('una regla sin `until` se valida sobre su primer período', () => {
    expect(() =>
      assertProducesOccurrences(regla({ byWeekday: [7], from: '2026-03-02' }), BUENOS_AIRES),
    ).not.toThrow();
  });
});

describe('colisión de sala', () => {
  const at = (iso: string) => Temporal.Instant.from(iso);
  const clase = (from: string, to: string) => ({ startAt: at(from), endAt: at(to) });

  it('dos clases al mismo tiempo se pisan', () => {
    expect(
      overlaps(
        clase('2026-03-02T10:00:00Z', '2026-03-02T11:00:00Z'),
        clase('2026-03-02T10:30:00Z', '2026-03-02T11:30:00Z'),
      ),
    ).toBe(true);
  });

  it('una adentro de la otra se pisa', () => {
    expect(
      overlaps(
        clase('2026-03-02T10:00:00Z', '2026-03-02T12:00:00Z'),
        clase('2026-03-02T10:30:00Z', '2026-03-02T11:00:00Z'),
      ),
    ).toBe(true);
  });

  it('los bordes que se tocan NO se pisan', () => {
    // La de 10 a 11 y la de 11 a 12 conviven: es la grilla normal de un box.
    expect(
      overlaps(
        clase('2026-03-02T10:00:00Z', '2026-03-02T11:00:00Z'),
        clase('2026-03-02T11:00:00Z', '2026-03-02T12:00:00Z'),
      ),
    ).toBe(false);
  });

  it('dos clases en horarios distintos no se pisan', () => {
    expect(
      overlaps(
        clase('2026-03-02T10:00:00Z', '2026-03-02T11:00:00Z'),
        clase('2026-03-02T15:00:00Z', '2026-03-02T16:00:00Z'),
      ),
    ).toBe(false);
  });
});

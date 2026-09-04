import { describe, expect, it } from 'vitest';
import { EMPTY_COUNTS, dayKpisOf, ratio, summarize, type DayKpis } from './kpis.js';

/**
 * Los KPIs de §2.1.12. Cada uno se verifica con un resultado calculado a mano:
 * un panel que muestra un número que nadie puede reproducir con una
 * calculadora no sirve para tomar decisiones.
 */
const dia = (overrides: Partial<DayKpis> = {}): DayKpis =>
  dayKpisOf({ ...EMPTY_COUNTS, ...overrides });

describe('las divisiones', () => {
  it('sin denominador dan cero, no infinito', () => {
    // Un día sin clases tiene 0% de utilización, no un error en el panel.
    expect(ratio(3, 0)).toBe(0);
    expect(ratio(0, 0)).toBe(0);
  });

  it('redondean a cuatro decimales', () => {
    expect(ratio(1, 3)).toBe(0.3333);
  });
});

describe('los KPIs del día', () => {
  it('la utilización es inscriptos sobre cupo', () => {
    // 87 inscriptos en clases con 120 lugares: 72,5%.
    expect(dia({ bookings: 87, capacity: 120 }).utilization).toBe(0.725);
  });

  it('🔴 el no-show se mide contra las reservas que llegaron a la clase', () => {
    /*
     * 3 faltas sobre 50 reservas vivas: 6%. Si el denominador fueran todas las
     * reservas del día — canceladas en plazo incluidas — el centro quedaría
     * mejor cuanta más gente cancele, que es al revés de lo que la política
     * quiere fomentar.
     */
    expect(dia({ noShows: 3, bookings: 50 }).noShowRate).toBe(0.06);
  });

  it('el día sin actividad vale cero, no null', () => {
    const vacio = dia();

    expect(vacio.utilization).toBe(0);
    expect(vacio.noShowRate).toBe(0);
    expect(vacio.attendances).toBe(0);
  });
});

describe('el período', () => {
  it('🔴 las tasas se recalculan sobre las sumas, no se promedian', () => {
    /*
     * Un día con 1 reserva y 1 falta (100%) y otro con 99 y ninguna (0%):
     * el promedio de las tasas da 50%, la tasa real es 1%. Promediar tasas con
     * denominadores distintos es la forma más fácil de mentir en un panel.
     */
    const total = summarize([dia({ noShows: 1, bookings: 1 }), dia({ noShows: 0, bookings: 99 })]);

    expect(total.noShowRate).toBe(0.01);
  });

  it('los flujos se suman: asistencias, ingresos y clases', () => {
    const total = summarize([
      dia({ attendances: 87, incomeCents: 34_000_000, sessions: 8 }),
      dia({ attendances: 60, incomeCents: 12_000_000, sessions: 6 }),
    ]);

    expect(total.attendances).toBe(147);
    expect(total.incomeCents).toBe(46_000_000);
    expect(total.sessions).toBe(14);
    expect(total.days).toBe(2);
  });

  it('🔴 los stocks no se suman: se toma la foto del último día', () => {
    /*
     * Los socios activos y la deuda vencida son fotos. Sumarlas contaría diez
     * veces al mismo socio y diez veces la misma deuda: un centro de 60 socios
     * mostraría 600 en un panel de diez días.
     */
    const total = summarize([
      dia({ activeMembers: 58, overdueCents: 20_000_00 }),
      dia({ activeMembers: 60, overdueCents: 18_000_00 }),
    ]);

    expect(total.activeMembers).toBe(60);
    expect(total.overdueCents).toBe(1_800_000);
  });

  it('las asistencias por socio usan los activos del último día', () => {
    const total = summarize([
      dia({ attendances: 100 }),
      dia({ attendances: 50, activeMembers: 60 }),
    ]);

    // 150 asistencias entre 60 socios activos: 2,5 por socio en el período.
    expect(total.attendancesPerMember).toBe(2.5);
  });

  it('la morosidad es la deuda vencida sobre lo facturado en el período', () => {
    const total = summarize([
      dia({ chargedCents: 30_000_000 }),
      dia({ chargedCents: 10_000_000, overdueCents: 4_000_000 }),
    ]);

    // $40.000 facturados, $4.000 vencidos: 10%.
    expect(total.delinquency).toBe(0.1);
  });

  it('un período sin días no rompe: todo en cero', () => {
    const total = summarize([]);

    expect(total.days).toBe(0);
    expect(total.activeMembers).toBe(0);
    expect(total.delinquency).toBe(0);
  });
});

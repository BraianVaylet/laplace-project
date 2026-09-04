import { describe, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import {
  dayWindow,
  expiringUntil,
  inactiveSince,
  isLowOccupancy,
  occupancyOf,
  todayIn,
  weekWindow,
} from './alerts.js';

/**
 * Los umbrales del panel de alertas (§2.1.12). Todos se miden en el calendario
 * del centro: un corte calculado en UTC caería a las 21:00 del día anterior
 * para un centro argentino, y la alerta aparecería un día antes de tiempo.
 */
const AR = 'America/Argentina/Buenos_Aires';
// 09:00 del 4 de marzo en Buenos Aires.
const AHORA = Temporal.Instant.from('2026-03-04T12:00:00Z');

describe('las ventanas de tiempo', () => {
  it('🔴 el corte de inactividad cae a la medianoche del socio, no a la del servidor', () => {
    // Catorce días antes del 4 es el 18 de febrero, 00:00 local = 03:00 UTC.
    expect(inactiveSince(AHORA, AR).toString()).toBe('2026-02-18T03:00:00Z');
  });

  it('el vencimiento mira hasta el final del séptimo día', () => {
    // Hasta el arranque del 12: incluye todo lo que vence el 11.
    expect(expiringUntil(AHORA, AR).toString()).toBe('2026-03-12T03:00:00Z');
  });

  it('el día del centro es el suyo, no el del servidor', () => {
    expect(todayIn(AHORA, AR)).toBe('2026-03-04');
    // El mismo instante ya es el 4 a la noche en Tokio... y el 4 igual.
    expect(todayIn(Temporal.Instant.from('2026-03-04T02:00:00Z'), AR)).toBe('2026-03-03');
  });

  it('la ventana del día va de medianoche a medianoche', () => {
    const { from, to } = dayWindow(AHORA, AR);

    expect(from.toString()).toBe('2026-03-04T03:00:00Z');
    expect(to.toString()).toBe('2026-03-05T03:00:00Z');
  });

  it('🔴 la semana de baja ocupación mira hacia adelante', () => {
    // La clase de ayer con 3 de 16 ya pasó: no hay nada que hacer con ella.
    const { from, to } = weekWindow(AHORA, AR);

    expect(from.toString()).toBe('2026-03-04T03:00:00Z');
    expect(to.toString()).toBe('2026-03-11T03:00:00Z');
  });
});

describe('la ocupación de una clase', () => {
  it('es inscriptos sobre cupo', () => {
    expect(occupancyOf(3, 16)).toBe(0.1875);
    expect(occupancyOf(16, 16)).toBe(1);
  });

  it('sin cupo declarado no hay ocupación que medir', () => {
    expect(occupancyOf(3, 0)).toBe(0);
  });

  it('menos de la mitad del cupo es baja ocupación', () => {
    expect(isLowOccupancy(3, 16)).toBe(true);
    expect(isLowOccupancy(8, 16)).toBe(false);
  });

  it('la mitad justa no es baja: el umbral es estricto', () => {
    expect(isLowOccupancy(8, 16)).toBe(false);
  });

  it('🔴 la clase sin cupo no entra: no se puede estar bajo un umbral que no existe', () => {
    // Meterla llenaría el panel de falsos positivos.
    expect(isLowOccupancy(0, 0)).toBe(false);
  });

  it('el umbral se puede mover sin tocar la consulta', () => {
    expect(isLowOccupancy(9, 16, 0.7)).toBe(true);
  });
});

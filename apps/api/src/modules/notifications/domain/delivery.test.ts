import { describe, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { isCriticalEventType } from '@laplace/schemas';
import { isAllowed, nextAttempt, sendableAt } from './delivery.js';

/**
 * Las tres reglas que deciden cuándo sale un aviso (§2.1.14). Están acá,
 * puras, porque son las que hay que poder explicar cuando alguien pregunta
 * "¿por qué no me llegó?".
 */
const AR = 'America/Argentina/Buenos_Aires';

describe('la ventana horaria', () => {
  it('a media tarde sale en el momento', () => {
    // 18:00 en Buenos Aires.
    const ahora = Temporal.Instant.from('2026-03-03T21:00:00Z');

    expect(sendableAt(ahora, AR).toString()).toBe(ahora.toString());
  });

  it('🔴 a las 3 de la mañana se difiere hasta las 8', () => {
    // 03:00 en Buenos Aires es 06:00 UTC.
    const madrugada = Temporal.Instant.from('2026-03-03T06:00:00Z');

    // 08:00 local del mismo día = 11:00 UTC.
    expect(sendableAt(madrugada, AR).toString()).toBe('2026-03-03T11:00:00Z');
  });

  it('a las 23:00 se difiere hasta las 8 del día siguiente', () => {
    // 23:00 del 3 en Buenos Aires es 02:00 UTC del 4.
    const nocheTarde = Temporal.Instant.from('2026-03-04T02:00:00Z');

    expect(sendableAt(nocheTarde, AR).toString()).toBe('2026-03-04T11:00:00Z');
  });

  it('la ventana es la del centro, no la del servidor', () => {
    // El mismo instante: mediodía en Buenos Aires, madrugada en Tokio.
    const instante = Temporal.Instant.from('2026-03-03T15:00:00Z');

    expect(sendableAt(instante, AR).toString()).toBe(instante.toString());
    expect(sendableAt(instante, 'Asia/Tokyo').toString()).not.toBe(instante.toString());
  });

  it('las 08:00 en punto ya está adentro de la ventana', () => {
    const justo = Temporal.Instant.from('2026-03-03T11:00:00Z');

    expect(sendableAt(justo, AR).toString()).toBe(justo.toString());
  });
});

describe('el backoff de los reintentos', () => {
  const ahora = Temporal.Instant.from('2026-03-03T15:00:00Z');

  it('el primer reintento va a los 30 segundos', () => {
    expect(nextAttempt(1, ahora).nextAttemptAt?.toString()).toBe('2026-03-03T15:00:30Z');
  });

  it('el segundo a los 2 minutos y el tercero a los 10', () => {
    expect(nextAttempt(2, ahora).nextAttemptAt?.toString()).toBe('2026-03-03T15:02:00Z');
    expect(nextAttempt(3, ahora).nextAttemptAt?.toString()).toBe('2026-03-03T15:10:00Z');
  });

  it('🔴 agotados los intentos, no se reintenta más: queda fallido para soporte', () => {
    const decision = nextAttempt(4, ahora);

    expect(decision.exhausted).toBe(true);
    expect(decision.nextAttemptAt).toBeNull();
  });
});

describe('las preferencias del usuario', () => {
  it('sin preferencia guardada, se manda: el default es recibir', () => {
    expect(isAllowed('booking.created', 'email', [])).toBe(true);
  });

  it('desactivado ese canal para ese evento, no se manda', () => {
    const prefs = [{ channel: 'email', eventType: 'booking.created', enabled: false }];

    expect(isAllowed('booking.created', 'email', prefs)).toBe(false);
  });

  it('el opt-out es por canal: apagar el mail no apaga el in-app', () => {
    const prefs = [{ channel: 'email', eventType: 'booking.created', enabled: false }];

    expect(isAllowed('booking.created', 'in_app', prefs)).toBe(true);
  });

  it('el opt-out es por evento: apagar el recordatorio no apaga la confirmación', () => {
    const prefs = [{ channel: 'email', eventType: 'session.reminder', enabled: false }];

    expect(isAllowed('booking.created', 'email', prefs)).toBe(true);
  });

  it('🔴 los avisos de plata salen igual, aunque el canal esté apagado (§2.1.14)', () => {
    const apagado = [
      { channel: 'email', eventType: 'charge.overdue', enabled: false },
      { channel: 'email', eventType: 'payment.received', enabled: false },
    ];

    expect(isAllowed('charge.overdue', 'email', apagado)).toBe(true);
    expect(isAllowed('payment.received', 'email', apagado)).toBe(true);
    expect(isCriticalEventType('booking.created')).toBe(false);
  });
});

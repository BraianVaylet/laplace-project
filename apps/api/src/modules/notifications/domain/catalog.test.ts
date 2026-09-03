import { describe, expect, it } from 'vitest';
import { NOTIFICATION_EVENT_TYPES } from '@laplace/schemas';
import {
  assertTransition,
  dedupeKeyOf,
  defaultTemplate,
  sampleValues,
  variablesFor,
} from './catalog.js';
import { assertRenderable, render } from './template.js';
import type { AppError } from '../../../http/errors.js';

describe('las plantillas de fábrica', () => {
  it('🔴 todas se pueden resolver con las variables de su evento', () => {
    // Si esto falla, el centro que todavía no editó nada manda un aviso con un
    // `{{hueco}}` adentro — o directamente no lo manda.
    for (const eventType of NOTIFICATION_EVENT_TYPES) {
      const plantilla = defaultTemplate(eventType);

      expect(() => assertRenderable(plantilla.subject, variablesFor(eventType))).not.toThrow();
      expect(() => assertRenderable(plantilla.body, variablesFor(eventType))).not.toThrow();
      expect(() => render(plantilla.body, sampleValues(eventType))).not.toThrow();
      expect(() => render(plantilla.subject, sampleValues(eventType))).not.toThrow();
    }
  });

  it('la vista previa queda legible, sin variables sin resolver', () => {
    const plantilla = defaultTemplate('booking.created');
    const previa = render(plantilla.body, sampleValues('booking.created'));

    expect(previa).toContain('Micaela');
    expect(previa).not.toContain('{{');
  });

  it('hay una plantilla para cada aviso del catálogo', () => {
    for (const eventType of NOTIFICATION_EVENT_TYPES) {
      expect(defaultTemplate(eventType).body.length).toBeGreaterThan(0);
    }
  });
});

describe('la máquina de estados del envío', () => {
  it('el camino feliz: encolado, enviando, enviado', () => {
    expect(() => assertTransition('queued', 'sending')).not.toThrow();
    expect(() => assertTransition('sending', 'sent')).not.toThrow();
  });

  it('un envío que falla vuelve a la cola o queda fallido', () => {
    expect(() => assertTransition('sending', 'queued')).not.toThrow();
    expect(() => assertTransition('sending', 'failed')).not.toThrow();
  });

  it('🔴 lo enviado no vuelve a la cola: sería mandar el mismo mail dos veces', () => {
    try {
      assertTransition('sent', 'queued');
      throw new Error('tenía que fallar');
    } catch (error) {
      expect((error as AppError).code).toBe('LP-NOTF-500-001');
    }
  });

  it('no se saltea el reclamo: de la cola no se pasa directo a enviado', () => {
    expect(() => assertTransition('queued', 'sent')).toThrow();
  });
});

describe('la clave de deduplicación', () => {
  const base = {
    userId: 'usr_1',
    eventType: 'session.reminder_1h' as const,
    channel: 'email' as const,
    subjectId: 'ses_1',
  };

  it('el mismo aviso para la misma persona da la misma clave', () => {
    expect(dedupeKeyOf(base)).toBe(dedupeKeyOf({ ...base }));
  });

  it('cambia por persona, por canal, por evento y por lo que lo originó', () => {
    const claves = new Set([
      dedupeKeyOf(base),
      dedupeKeyOf({ ...base, userId: 'usr_2' }),
      dedupeKeyOf({ ...base, channel: 'in_app' }),
      dedupeKeyOf({ ...base, eventType: 'session.reminder_24h' }),
      dedupeKeyOf({ ...base, subjectId: 'ses_2' }),
    ]);

    expect(claves.size).toBe(5);
  });
});

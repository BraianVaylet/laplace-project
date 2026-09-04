import { describe, expect, it } from 'vitest';
import { appliesTo, requirementsFor } from './requirement.js';

/**
 * Qué documento le corresponde a quién (§2.1.20).
 *
 * El caso que importa de verdad: el consentimiento del tutor **no es una
 * opción del SMU**, es obligatorio para todo menor y para nadie más. Un adulto
 * nunca tiene que ver ese documento, y un menor no puede entrenar sin él.
 */
const DESLINDE = { documentId: 'doc_1', type: 'liability_waiver', required: true };
const TUTOR = { documentId: 'doc_2', type: 'guardian_consent', required: true };
const IMAGEN_OPCIONAL = { documentId: 'doc_3', type: 'image_consent', required: false };

const HOY = '2026-03-03';

describe('un documento general (no de tutor)', () => {
  it('aplica a cualquiera si es obligatorio', () => {
    expect(appliesTo(DESLINDE, {}, HOY)).toBe(true);
    expect(appliesTo(DESLINDE, { birthDate: '2020-01-01' }, HOY)).toBe(true);
  });

  it('no aplica si no es obligatorio: nadie tiene que firmarlo para entrar', () => {
    expect(appliesTo(IMAGEN_OPCIONAL, {}, HOY)).toBe(false);
  });
});

describe('el consentimiento del tutor', () => {
  it('aplica a un menor', () => {
    // Cumple 18 en 2030: en 2026 todavía es menor.
    expect(appliesTo(TUTOR, { birthDate: '2012-06-01' }, HOY)).toBe(true);
  });

  it('no aplica a un adulto', () => {
    expect(appliesTo(TUTOR, { birthDate: '2000-01-01' }, HOY)).toBe(false);
  });

  it('el día exacto del cumpleaños 18 ya no aplica', () => {
    expect(appliesTo(TUTOR, { birthDate: '2008-03-03' }, HOY)).toBe(false);
  });

  it('sin fecha de nacimiento no se le exige: no se puede probar que es menor', () => {
    expect(appliesTo(TUTOR, {}, HOY)).toBe(false);
  });
});

describe('requirementsFor', () => {
  it('devuelve solo lo que le corresponde a esta persona', () => {
    const vigentes = [DESLINDE, TUTOR, IMAGEN_OPCIONAL];

    const paraUnAdulto = requirementsFor(vigentes, { birthDate: '2000-01-01' }, HOY);
    expect(paraUnAdulto.map((d) => d.documentId)).toEqual(['doc_1']);

    const paraUnMenor = requirementsFor(vigentes, { birthDate: '2012-06-01' }, HOY);
    expect(paraUnMenor.map((d) => d.documentId)).toEqual(['doc_1', 'doc_2']);
  });

  it('lista vacía si no hay documentos vigentes', () => {
    expect(requirementsFor([], {}, HOY)).toEqual([]);
  });
});

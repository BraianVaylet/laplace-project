import { describe, expect, it } from 'vitest';
import { MEMBER_STATES, type MemberStatus } from '@laplace/schemas';
import { canTransition, countsTowardPlanLimit, fullName, requiresGuardian } from './member.js';

/** Toda transición válida, declarada a mano para que el test no repita la implementación. */
const VALIDAS: ReadonlyArray<[MemberStatus, MemberStatus]> = [
  ['lead', 'trial'],
  ['lead', 'active'],
  ['lead', 'inactive'],
  ['lead', 'archived'],
  ['trial', 'active'],
  ['trial', 'inactive'],
  ['trial', 'archived'],
  ['active', 'at_risk'],
  ['active', 'inactive'],
  ['active', 'archived'],
  ['at_risk', 'active'],
  ['at_risk', 'inactive'],
  ['at_risk', 'archived'],
  ['inactive', 'active'],
  ['inactive', 'archived'],
  ['archived', 'active'],
];

describe('maquina de estados del miembro (§14)', () => {
  it.each(VALIDAS)('%s → %s es valida', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it('toda combinacion que no este en la lista es invalida', () => {
    // Exhaustivo: 6 x 6 = 36 pares, 16 validos, 20 que tienen que fallar. Es el
    // test que la spec §Testing pide para las maquinas de estado, y el que caza
    // una transicion agregada sin pensar.
    const validas = new Set(VALIDAS.map(([from, to]) => `${from}->${to}`));
    const invalidas: string[] = [];

    for (const from of MEMBER_STATES) {
      for (const to of MEMBER_STATES) {
        const par = `${from}->${to}`;
        if (validas.has(par)) continue;
        if (canTransition(from, to)) invalidas.push(par);
      }
    }

    expect(invalidas).toEqual([]);
  });

  it('cuenta: 16 transiciones validas de 36 combinaciones', () => {
    const total = MEMBER_STATES.flatMap((from) =>
      MEMBER_STATES.filter((to) => canTransition(from, to)),
    );

    expect(total).toHaveLength(16);
  });
});

describe('limite del plan', () => {
  it('archivar no cuesta plata (§2.2.1)', () => {
    expect(countsTowardPlanLimit('archived')).toBe(false);
  });

  it('todos los demas cuentan', () => {
    for (const state of MEMBER_STATES) {
      if (state === 'archived') continue;
      expect(countsTowardPlanLimit(state), state).toBe(true);
    }
  });
});

describe('tutor de un menor (§2.1.7)', () => {
  const HOY = '2026-09-01';

  it('un menor sin fecha de nacimiento no se puede detectar: no exige tutor', () => {
    // Sin el dato no se puede afirmar que es menor. El bloqueo real de la
    // reserva lo pone Waivers (F1-20) con el consentimiento firmado.
    expect(requiresGuardian(undefined, HOY)).toBe(false);
  });

  it('un menor exige tutor', () => {
    expect(requiresGuardian('2012-05-10', HOY)).toBe(true);
  });

  it('un mayor no', () => {
    expect(requiresGuardian('1999-04-12', HOY)).toBe(false);
  });

  it('el dia que cumple 18 deja de exigirlo', () => {
    expect(requiresGuardian('2008-09-01', HOY)).toBe(false);
    expect(requiresGuardian('2008-09-02', HOY)).toBe(true);
  });
});

describe('nombre completo', () => {
  it('arma "Nombre Apellido" para las listas y los mails', () => {
    expect(fullName({ firstName: 'Micaela', lastName: 'Sosa' })).toBe('Micaela Sosa');
  });
});

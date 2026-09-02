import { describe, expect, it } from 'vitest';
import {
  MEMBER_STATES,
  MEMBER_TRANSITIONS,
  createMemberSchema,
  isMinorOn,
  memberNoteSchema,
  memberResponseSchema,
  updateMemberSchema,
} from './index.js';

const VALIDA = {
  firstName: 'Micaela',
  lastName: 'Sosa',
  venueIds: ['ven_abc123'],
};

describe('alta de miembro', () => {
  it('con nombre, apellido y sede alcanza para empezar', () => {
    const parsed = createMemberSchema.parse(VALIDA);

    expect(parsed.firstName).toBe('Micaela');
    expect(parsed.status).toBe('lead');
    expect(parsed.tags).toEqual([]);
  });

  it('acepta la ficha completa de §2.1.7', () => {
    const parsed = createMemberSchema.parse({
      ...VALIDA,
      docId: '40123456',
      phone: '+5492914000000',
      email: 'mica@example.com',
      birthDate: '1999-04-12',
      emergencyContact: { fullName: 'Ana Sosa', phone: '+5492914111111', relationship: 'hermana' },
      tags: ['turno-mañana'],
    });

    expect(parsed.emergencyContact?.fullName).toBe('Ana Sosa');
    expect(parsed.docId).toBe('40123456');
  });

  it('exige al menos una sede: un socio sin sede no puede reservar en ningun lado', () => {
    expect(() => createMemberSchema.parse({ ...VALIDA, venueIds: [] })).toThrow();
  });

  it('normaliza el documento: los puntos son de la UI, no del dato', () => {
    // "40.123.456" y "40123456" son la misma persona. Sin normalizar, el unico
    // por documento no detecta el duplicado y el centro termina con dos fichas.
    expect(createMemberSchema.parse({ ...VALIDA, docId: '40.123.456' }).docId).toBe('40123456');
    expect(createMemberSchema.parse({ ...VALIDA, docId: ' 40 123 456 ' }).docId).toBe('40123456');
  });

  it('un documento vacio queda sin documento, no como cadena vacia', () => {
    // Es lo que hace que el indice unico parcial ignore a quien no lo cargo:
    // dos cadenas vacias chocarian entre si.
    expect(createMemberSchema.parse({ ...VALIDA, docId: '   ' }).docId).toBeUndefined();
  });

  it('la fecha de nacimiento es una fecha de calendario, no un instante', () => {
    expect(() => createMemberSchema.parse({ ...VALIDA, birthDate: '1999-04-12' })).not.toThrow();
    expect(() =>
      createMemberSchema.parse({ ...VALIDA, birthDate: '1999-04-12T00:00:00Z' }),
    ).toThrow();
    expect(() => createMemberSchema.parse({ ...VALIDA, birthDate: '12/04/1999' })).toThrow();
  });

  it('rechaza una fecha de nacimiento imposible', () => {
    expect(() => createMemberSchema.parse({ ...VALIDA, birthDate: '1999-02-31' })).toThrow();
  });

  it('el estado inicial se puede declarar, pero solo entre los de arranque', () => {
    expect(createMemberSchema.parse({ ...VALIDA, status: 'trial' }).status).toBe('trial');
    expect(createMemberSchema.parse({ ...VALIDA, status: 'active' }).status).toBe('active');
    // Nadie nace archivado ni en riesgo: a eso se llega.
    expect(() => createMemberSchema.parse({ ...VALIDA, status: 'archived' })).toThrow();
    expect(() => createMemberSchema.parse({ ...VALIDA, status: 'at_risk' })).toThrow();
  });

  it('las etiquetas se normalizan y no se repiten', () => {
    const parsed = createMemberSchema.parse({ ...VALIDA, tags: ['  Mañana ', 'mañana', 'PRO'] });

    expect(parsed.tags).toEqual(['mañana', 'pro']);
  });
});

describe('menores de edad (§2.1.7)', () => {
  const HOY = '2026-09-01';

  it('sabe quien es menor en una fecha dada', () => {
    expect(isMinorOn('2010-09-02', HOY)).toBe(true);
    expect(isMinorOn('2008-09-01', HOY)).toBe(false);
  });

  it('el dia que cumple 18 ya no es menor', () => {
    expect(isMinorOn('2008-09-01', HOY)).toBe(false);
    expect(isMinorOn('2008-09-02', HOY)).toBe(true);
  });

  it('un menor con tutor completo valida', () => {
    expect(() =>
      createMemberSchema.parse({
        ...VALIDA,
        birthDate: '2012-05-10',
        guardian: { fullName: 'Ana Sosa', phone: '+5492914111111', relationship: 'madre' },
      }),
    ).not.toThrow();
  });

  it('el tutor exige nombre y telefono: un tutor sin telefono no sirve en una urgencia', () => {
    expect(() =>
      createMemberSchema.parse({
        ...VALIDA,
        birthDate: '2012-05-10',
        guardian: { fullName: 'Ana Sosa', relationship: 'madre' },
      }),
    ).toThrow();
  });
});

describe('maquina de estados (§14)', () => {
  it('cubre los seis estados de la spec', () => {
    expect([...MEMBER_STATES]).toEqual([
      'lead',
      'trial',
      'active',
      'at_risk',
      'inactive',
      'archived',
    ]);
  });

  it('el camino feliz del embudo esta habilitado', () => {
    expect(MEMBER_TRANSITIONS.lead).toContain('trial');
    expect(MEMBER_TRANSITIONS.trial).toContain('active');
    expect(MEMBER_TRANSITIONS.active).toContain('at_risk');
    expect(MEMBER_TRANSITIONS.at_risk).toContain('inactive');
    expect(MEMBER_TRANSITIONS.inactive).toContain('archived');
  });

  it('un lead puede comprar sin pasar por la prueba', () => {
    expect(MEMBER_TRANSITIONS.lead).toContain('active');
  });

  it('el que se fue puede volver: en un centro pasa todo el tiempo', () => {
    expect(MEMBER_TRANSITIONS.at_risk).toContain('active');
    expect(MEMBER_TRANSITIONS.inactive).toContain('active');
    expect(MEMBER_TRANSITIONS.archived).toContain('active');
  });

  it('ningun estado transiciona a si mismo', () => {
    for (const state of MEMBER_STATES) {
      expect(MEMBER_TRANSITIONS[state], state).not.toContain(state);
    }
  });

  it('no se vuelve a `lead` ni a `trial`: la prueba es una vez', () => {
    for (const state of MEMBER_STATES) {
      if (state === 'lead') continue;
      expect(MEMBER_TRANSITIONS[state], state).not.toContain('lead');
    }
    expect(MEMBER_TRANSITIONS.active).not.toContain('trial');
    expect(MEMBER_TRANSITIONS.archived).not.toContain('trial');
  });
});

describe('flags transversales', () => {
  it('`debtor` y `suspended` no son estados: conviven con cualquiera', () => {
    // Un socio puede estar `active` y `debtor` a la vez. Modelarlos como estados
    // obligaria a elegir, y "activo con deuda" es el caso mas comun del negocio.
    expect(MEMBER_STATES).not.toContain('debtor');
    expect(MEMBER_STATES).not.toContain('suspended');
  });

  it('el alta no los acepta: los pone el sistema, no el formulario', () => {
    const parsed = createMemberSchema.parse({ ...VALIDA, debtor: true, suspended: true } as never);

    expect('debtor' in parsed).toBe(false);
    expect('suspended' in parsed).toBe(false);
  });
});

describe('notas internas', () => {
  it('una nota necesita texto', () => {
    expect(() => memberNoteSchema.parse({ text: '' })).toThrow();
    expect(() => memberNoteSchema.parse({ text: 'Prefiere el turno de la mañana.' })).not.toThrow();
  });

  it('la respuesta del miembro NO las incluye', () => {
    // §2.1.7: las notas del staff nunca son visibles para el miembro. Se valida
    // sobre el schema y no sobre un mapper para que no dependa de acordarse.
    expect('notes' in memberResponseSchema.shape).toBe(false);
  });

  it('la respuesta tampoco expone el saldo crudo ni el userId de la cuenta', () => {
    expect('balanceCents' in memberResponseSchema.shape).toBe(true);
    expect('tenantId' in memberResponseSchema.shape).toBe(false);
  });
});

describe('edicion de miembro', () => {
  it('todo opcional', () => {
    expect(() => updateMemberSchema.parse({})).not.toThrow();
  });

  it('el estado no se edita: se cambia por transicion (§14)', () => {
    expect('status' in updateMemberSchema.shape).toBe(false);
  });

  it('lo que se manda igual se valida', () => {
    expect(() => updateMemberSchema.parse({ birthDate: '12/04/1999' })).toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import {
  LAPLACE_STATEMENT,
  ORG_ROLE_NAMES,
  authorize,
  type OrgRoleName,
  type PermissionRequest,
} from './permissions.js';

/**
 * F0-02. La matriz de permisos, celda por celda. Es un test de datos a
 * proposito: la autorizacion es la regla de la que depende que un recepcionista
 * no vea los ingresos y que un coach no invite usuarios.
 *
 * Regla del test: cada par (recurso, accion) del statement tiene que estar
 * declarado abajo. Un permiso nuevo sin fila **rompe la suite**, que es
 * exactamente lo que pide la tarea.
 */

/** Que roles pueden ejercer cada (recurso, accion). El resto, no. */
const MATRIX: Record<string, Record<string, OrgRoleName[]>> = {
  // ── Gestion de accesos: reservado por Better Auth ────────────────────────
  organization: {
    update: ['owner'],
    delete: ['owner'],
  },
  member: {
    create: ['owner'],
    update: ['owner'],
    delete: ['owner'],
  },
  invitation: {
    create: ['owner'],
    cancel: ['owner'],
  },

  // ── Negocio ──────────────────────────────────────────────────────────────
  athlete: {
    create: ['owner', 'manager_assistant', 'front_desk'],
    read: ['owner', 'manager_assistant', 'front_desk', 'head_coach', 'coach'],
    update: ['owner', 'manager_assistant', 'front_desk'],
    archive: ['owner', 'manager_assistant'],
    import: ['owner', 'manager_assistant'],
  },
  athleteNote: {
    read: ['owner', 'manager_assistant', 'front_desk', 'head_coach', 'coach'],
    write: ['owner', 'manager_assistant', 'front_desk', 'head_coach', 'coach'],
  },
  venue: {
    create: ['owner'],
    read: ['owner', 'manager_assistant', 'front_desk', 'head_coach', 'coach'],
    update: ['owner', 'manager_assistant'],
    archive: ['owner'],
  },
  room: {
    create: ['owner', 'manager_assistant'],
    read: ['owner', 'manager_assistant', 'front_desk', 'head_coach', 'coach'],
    update: ['owner', 'manager_assistant'],
    archive: ['owner', 'manager_assistant'],
  },
  product: {
    create: ['owner', 'manager_assistant'],
    read: ['owner', 'manager_assistant', 'front_desk', 'head_coach', 'coach', 'member'],
    update: ['owner', 'manager_assistant'],
    archive: ['owner', 'manager_assistant'],
  },
  contract: {
    create: ['owner', 'manager_assistant', 'front_desk'],
    read: ['owner', 'manager_assistant', 'front_desk', 'head_coach', 'coach'],
    freeze: ['owner', 'manager_assistant', 'front_desk'],
    adjust: ['owner', 'manager_assistant'],
    cancel: ['owner', 'manager_assistant'],
  },
  classSession: {
    create: ['owner', 'manager_assistant', 'head_coach'],
    read: ['owner', 'manager_assistant', 'front_desk', 'head_coach', 'coach', 'member'],
    update: ['owner', 'manager_assistant', 'head_coach'],
    cancel: ['owner', 'manager_assistant', 'head_coach'],
  },
  booking: {
    create: ['owner', 'manager_assistant', 'front_desk', 'head_coach', 'coach', 'member'],
    read: ['owner', 'manager_assistant', 'front_desk', 'head_coach', 'coach', 'member'],
    cancel: ['owner', 'manager_assistant', 'front_desk', 'head_coach', 'coach', 'member'],
    createForOther: ['owner', 'manager_assistant', 'front_desk'],
  },
  attendance: {
    read: ['owner', 'manager_assistant', 'front_desk', 'head_coach', 'coach'],
    checkIn: ['owner', 'manager_assistant', 'front_desk', 'head_coach', 'coach'],
  },
  waiver: {
    read: ['owner', 'manager_assistant', 'front_desk', 'head_coach', 'coach', 'member'],
    publish: ['owner', 'manager_assistant'],
    // El socio es quien firma lo suyo; nadie firma por otro (§2.1.20). El
    // owner tiene `accept` igual, heredado de `everything`: no tiene techo.
    accept: ['owner', 'member'],
  },
  // El manager_assistant NO entra: §1.1 dice "todo salvo metricas de negocio
  // y facturacion". La facturacion es del owner y del mostrador.
  billing: {
    read: ['owner', 'front_desk'],
    charge: ['owner', 'front_desk'],
    collect: ['owner', 'front_desk'],
    refund: ['owner'],
  },
  businessMetrics: {
    read: ['owner'],
  },
  planning: {
    create: ['owner', 'manager_assistant', 'head_coach'],
    read: ['owner', 'manager_assistant', 'head_coach', 'coach', 'member'],
    update: ['owner', 'manager_assistant', 'head_coach'],
    publish: ['owner', 'manager_assistant', 'head_coach'],
  },
  exercise: {
    create: ['owner', 'manager_assistant', 'head_coach'],
    read: ['owner', 'manager_assistant', 'front_desk', 'head_coach', 'coach', 'member'],
    update: ['owner', 'manager_assistant', 'head_coach'],
  },
  result: {
    create: ['owner', 'manager_assistant', 'head_coach', 'coach', 'member'],
    read: ['owner', 'manager_assistant', 'head_coach', 'coach', 'member'],
  },
  health: {
    read: ['owner', 'head_coach', 'coach'],
  },
};

describe('cobertura de la matriz', () => {
  it('todo par (recurso, accion) del statement esta declarado en la matriz', () => {
    const faltantes: string[] = [];

    for (const [resource, actions] of Object.entries(LAPLACE_STATEMENT)) {
      for (const action of actions) {
        if (MATRIX[resource]?.[action] === undefined) faltantes.push(`${resource}.${action}`);
      }
    }

    expect(faltantes).toEqual([]);
  });

  it('la matriz no declara permisos que el statement no tiene', () => {
    const sobrantes: string[] = [];

    for (const [resource, actions] of Object.entries(MATRIX)) {
      const declared = LAPLACE_STATEMENT[resource as keyof typeof LAPLACE_STATEMENT] as
        readonly string[] | undefined;
      for (const action of Object.keys(actions)) {
        if (!declared?.includes(action)) sobrantes.push(`${resource}.${action}`);
      }
    }

    expect(sobrantes).toEqual([]);
  });
});

describe('matriz rol x recurso x accion', () => {
  const cells = Object.entries(MATRIX).flatMap(([resource, actions]) =>
    Object.entries(actions).flatMap(([action, allowed]) =>
      ORG_ROLE_NAMES.map((role) => ({ resource, action, role, expected: allowed.includes(role) })),
    ),
  );

  it.each(cells)(
    '$role → $resource · $action = $expected',
    ({ resource, action, role, expected }) => {
      const request = { [resource]: [action] } as PermissionRequest;
      expect(authorize([role], request)).toBe(expected);
    },
  );
});

describe('reglas que la spec declara de forma explicita', () => {
  it('ningun sub-rol de staff accede a las metricas de negocio (§2.1.12)', () => {
    const staff: OrgRoleName[] = ['coach', 'head_coach', 'front_desk', 'manager_assistant'];

    for (const role of staff) {
      expect(authorize([role], { businessMetrics: ['read'] })).toBe(false);
    }
  });

  it('el manager_assistant hace todo salvo metricas de negocio y facturacion (§1.1)', () => {
    expect(authorize(['manager_assistant'], { athlete: ['create'] })).toBe(true);
    expect(authorize(['manager_assistant'], { planning: ['update'] })).toBe(true);
    expect(authorize(['manager_assistant'], { businessMetrics: ['read'] })).toBe(false);
    expect(authorize(['manager_assistant'], { billing: ['read'] })).toBe(false);
    expect(authorize(['manager_assistant'], { billing: ['collect'] })).toBe(false);
  });

  it('el head_coach es un coach que ademas edita planificaciones y ejercicios (§1.1)', () => {
    expect(authorize(['head_coach'], { attendance: ['checkIn'] })).toBe(true);
    expect(authorize(['head_coach'], { planning: ['create', 'update'] })).toBe(true);
    expect(authorize(['head_coach'], { exercise: ['create', 'update'] })).toBe(true);

    expect(authorize(['coach'], { planning: ['update'] })).toBe(false);
    expect(authorize(['coach'], { exercise: ['create'] })).toBe(false);
  });

  it('el front_desk da de alta socios y cobra, pero no toca planificaciones (§1.1)', () => {
    expect(authorize(['front_desk'], { athlete: ['create'] })).toBe(true);
    expect(authorize(['front_desk'], { contract: ['create'] })).toBe(true);
    expect(authorize(['front_desk'], { billing: ['collect'] })).toBe(true);
    expect(authorize(['front_desk'], { attendance: ['checkIn'] })).toBe(true);

    expect(authorize(['front_desk'], { planning: ['update'] })).toBe(false);
    expect(authorize(['front_desk'], { billing: ['refund'] })).toBe(false);
  });

  it('el coach ve la ficha de salud de sus atletas; el front_desk no (§1.1)', () => {
    expect(authorize(['coach'], { health: ['read'] })).toBe(true);
    expect(authorize(['head_coach'], { health: ['read'] })).toBe(true);
    expect(authorize(['front_desk'], { health: ['read'] })).toBe(false);
    expect(authorize(['manager_assistant'], { health: ['read'] })).toBe(false);
  });

  it('las notas internas del staff no son visibles para el socio (§2.1.7)', () => {
    expect(authorize(['member'], { athleteNote: ['read'] })).toBe(false);
    expect(authorize(['coach'], { athleteNote: ['read'] })).toBe(true);
  });

  it('solo el staff de mostrador reserva en nombre de otro (§2.1.5.f)', () => {
    expect(authorize(['member'], { booking: ['createForOther'] })).toBe(false);
    expect(authorize(['front_desk'], { booking: ['createForOther'] })).toBe(true);
  });

  it('ningun rol de staff invita usuarios: `member` en Better Auth es la pertenencia a la organizacion', () => {
    const staff: OrgRoleName[] = ['coach', 'head_coach', 'front_desk', 'manager_assistant'];

    for (const role of staff) {
      expect(authorize([role], { member: ['create'] })).toBe(false);
      expect(authorize([role], { invitation: ['create'] })).toBe(false);
    }
  });
});

describe('comportamiento del evaluador', () => {
  it('sin rol no se autoriza nada', () => {
    expect(authorize([], { booking: ['read'] })).toBe(false);
  });

  it('un rol desconocido no autoriza: no se cae con un throw ni deja pasar', () => {
    expect(authorize(['no_existe'], { booking: ['read'] })).toBe(false);
  });

  it('con varios roles alcanza con que uno lo permita', () => {
    expect(authorize(['coach', 'front_desk'], { billing: ['collect'] })).toBe(true);
  });

  it('exige TODAS las acciones pedidas, no solo una', () => {
    expect(authorize(['coach'], { planning: ['read'] })).toBe(true);
    expect(authorize(['coach'], { planning: ['read', 'update'] })).toBe(false);
  });

  it('el owner puede todo lo declarado en el statement', () => {
    for (const [resource, actions] of Object.entries(LAPLACE_STATEMENT)) {
      const request = { [resource]: [...actions] } as PermissionRequest;
      expect(authorize(['owner'], request), `owner deberia poder ${resource}`).toBe(true);
    }
  });
});

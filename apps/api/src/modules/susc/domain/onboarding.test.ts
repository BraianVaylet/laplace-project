import { describe, expect, it } from 'vitest';
import { buildOnboarding, type CenterSetup } from './onboarding.js';

/**
 * El asistente de onboarding (§2.1.3). La métrica de §2.0 es
 * **time-to-first-class < 30 min**: es donde se pierde el SaaS.
 *
 * 🔴 Lo que se prueba acá es una sola idea: **el progreso sale del estado real
 * del centro, no de lo que el usuario declaró.** Un checklist que dice "clase
 * publicada" sin que exista una clase es una mentira que el SMU descubre
 * cuando un socio abre la app y no encuentra nada.
 */
const VACIO: CenterSetup = {
  venues: 0,
  venuesWithHours: 0,
  classTemplates: 0,
  products: 0,
  inviteCodes: 0,
};

const LISTO: CenterSetup = {
  venues: 1,
  venuesWithHours: 1,
  classTemplates: 3,
  products: 2,
  inviteCodes: 1,
};

const paso = (progreso: ReturnType<typeof buildOnboarding>, id: string) =>
  progreso.steps.find((s) => s.id === id);

describe('los pasos del asistente', () => {
  it('son los cinco de §2.1.3, en orden', () => {
    // El orden importa: es el camino de menor fricción, y cada paso necesita
    // el anterior.
    expect(buildOnboarding({ setup: VACIO, skipped: [] }).steps.map((s) => s.id)).toEqual([
      'venue',
      'hours',
      'class',
      'product',
      'invite',
    ]);
  });

  it('cada paso dice a dónde va: el asistente lleva, no explica', () => {
    for (const s of buildOnboarding({ setup: VACIO, skipped: [] }).steps) {
      expect(s.href.startsWith('/')).toBe(true);
      expect(s.title.length).toBeGreaterThan(0);
    }
  });
});

describe('🔴 el progreso sale del estado real, no de lo que se declaró', () => {
  it('un centro vacío no tiene ningún paso hecho', () => {
    const progreso = buildOnboarding({ setup: VACIO, skipped: [] });

    expect(progreso.doneCount).toBe(0);
    expect(progreso.percent).toBe(0);
    expect(progreso.completedAt).toBeNull();
  });

  it('el paso se marca hecho cuando la cosa existe', () => {
    const progreso = buildOnboarding({ setup: { ...VACIO, venues: 1 }, skipped: [] });

    expect(paso(progreso, 'venue')?.done).toBe(true);
    expect(paso(progreso, 'class')?.done).toBe(false);
  });

  it('🔴 saltear un paso no lo marca hecho: lo saca del camino y nada más', () => {
    // Es la diferencia entre "lo dejé para después" y "ya está". Si saltear
    // marcara hecho, la barra llegaría al 100% con el centro vacío.
    const progreso = buildOnboarding({ setup: VACIO, skipped: ['invite'] });

    expect(paso(progreso, 'invite')?.skipped).toBe(true);
    expect(paso(progreso, 'invite')?.done).toBe(false);
    expect(progreso.doneCount).toBe(0);
    expect(progreso.percent).toBe(0);
  });

  it('el paso salteado que después se hace queda hecho igual', () => {
    const progreso = buildOnboarding({
      setup: { ...VACIO, venues: 1, inviteCodes: 1 },
      skipped: ['invite'],
    });

    expect(paso(progreso, 'invite')?.done).toBe(true);
  });

  it('el porcentaje es el de los pasos hechos sobre el total', () => {
    const progreso = buildOnboarding({ setup: { ...VACIO, venues: 1, products: 1 }, skipped: [] });

    expect(progreso.doneCount).toBe(2);
    expect(progreso.totalCount).toBe(5);
    expect(progreso.percent).toBe(40);
  });
});

describe('🔴 el paso que todavía no se puede hacer', () => {
  it('sin sede no hay dónde poner una clase, y el asistente lo dice', () => {
    // Dejarlo tocar y que falle con un 422 es peor: el error no explica que
    // le falta el paso de antes.
    const progreso = buildOnboarding({ setup: VACIO, skipped: [] });

    expect(paso(progreso, 'class')?.blocked).toBe(true);
    expect(paso(progreso, 'product')?.blocked).toBe(true);
    expect(paso(progreso, 'venue')?.blocked).toBe(false);
  });

  it('con la sede creada se destraba todo lo demás', () => {
    const progreso = buildOnboarding({ setup: { ...VACIO, venues: 1 }, skipped: [] });

    for (const s of progreso.steps) expect(s.blocked).toBe(false);
  });
});

describe('dónde se para el asistente al abrir', () => {
  it('en el primer paso pendiente que se pueda hacer', () => {
    expect(buildOnboarding({ setup: VACIO, skipped: [] }).currentStep).toBe('venue');
  });

  it('saltea lo salteado y lo ya hecho', () => {
    const progreso = buildOnboarding({
      setup: { ...VACIO, venues: 1 },
      skipped: ['hours'],
    });

    expect(progreso.currentStep).toBe('class');
  });

  it('sin nada pendiente, no se para en ningún lado', () => {
    expect(buildOnboarding({ setup: LISTO, skipped: [] }).currentStep).toBeNull();
  });

  it('🔴 con todo salteado se para igual en lo obligatorio', () => {
    // Saltear "publicar una clase" no termina el onboarding: sin clase el
    // centro no abre, y el asistente no puede fingir que sí.
    const progreso = buildOnboarding({
      setup: { ...VACIO, venues: 1 },
      skipped: ['hours', 'class', 'product', 'invite'],
    });

    expect(progreso.currentStep).toBe('class');
  });
});

describe('🔴 cuándo se da por terminado', () => {
  it('cuando hay una clase publicada y un producto vendible, no antes', () => {
    // Es el criterio de la tarjeta y de §12: el centro tiene que quedar
    // operando, no con el formulario lleno.
    const casi = buildOnboarding({
      setup: { ...VACIO, venues: 1, classTemplates: 1 },
      skipped: [],
      now: '2026-03-02T12:00:00Z',
    });
    expect(casi.completedAt).toBeNull();

    const listo = buildOnboarding({
      setup: { ...VACIO, venues: 1, classTemplates: 1, products: 1 },
      skipped: [],
      now: '2026-03-02T12:00:00Z',
    });
    expect(listo.completedAt).toBe('2026-03-02T12:00:00Z');
  });

  it('los pasos opcionales no lo frenan', () => {
    const progreso = buildOnboarding({
      setup: { ...VACIO, venues: 1, classTemplates: 1, products: 1 },
      skipped: ['hours', 'invite'],
      now: '2026-03-02T12:00:00Z',
    });

    expect(progreso.completedAt).not.toBeNull();
  });

  it('🔴 una vez terminado no se desarma: la fecha vieja manda', () => {
    /*
     * Si el SMU borra su único producto tres meses después, el asistente no
     * puede volver a aparecer como si recién se hubiera registrado. Terminar
     * el onboarding es un hecho del pasado, no un estado que se recalcula.
     */
    const progreso = buildOnboarding({
      setup: VACIO,
      skipped: [],
      completedAt: '2026-01-10T09:00:00Z',
      now: '2026-03-02T12:00:00Z',
    });

    expect(progreso.completedAt).toBe('2026-01-10T09:00:00Z');
  });
});

describe('🔴 el time-to-first-class de §2.0', () => {
  it('se mide en minutos entre el alta y la primera clase', () => {
    // La métrica del producto es "menos de 30 minutos". Sin el número medido,
    // es una promesa que nadie verifica.
    const progreso = buildOnboarding({
      setup: LISTO,
      skipped: [],
      signedUpAt: '2026-03-02T12:00:00Z',
      firstClassPublishedAt: '2026-03-02T12:22:00Z',
    });

    expect(progreso.timeToFirstClassMinutes).toBe(22);
  });

  it('sin clase publicada todavía no hay número', () => {
    const progreso = buildOnboarding({
      setup: VACIO,
      skipped: [],
      signedUpAt: '2026-03-02T12:00:00Z',
    });

    expect(progreso.timeToFirstClassMinutes).toBeNull();
  });

  it('nunca es negativo aunque los relojes discrepen', () => {
    const progreso = buildOnboarding({
      setup: LISTO,
      skipped: [],
      signedUpAt: '2026-03-02T12:22:00Z',
      firstClassPublishedAt: '2026-03-02T12:00:00Z',
    });

    expect(progreso.timeToFirstClassMinutes).toBe(0);
  });
});

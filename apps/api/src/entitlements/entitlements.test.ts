import { describe, expect, it } from 'vitest';
import { FEATURES, MODULES, PLANS, PLAN_IDS, planFor, type PlanId } from './catalog.js';
import {
  LIMIT_LABELS,
  hasFeature,
  hasModule,
  limitStatus,
  resolveEntitlements,
  validateDowngrade,
  type Usage,
} from './entitlements.js';

const entitlementsOf = (planId: PlanId) => resolveEntitlements({ planId });

describe('el catalogo respeta el empaquetado de §2.2.1', () => {
  it('Basic incluye Members y Billing: sin eso el plan es inutilizable', () => {
    const basic = entitlementsOf('basic');

    expect(hasModule(basic, 'members')).toBe(true);
    expect(hasModule(basic, 'billing')).toBe(true);
    expect(hasModule(basic, 'schedule')).toBe(true);
    expect(hasModule(basic, 'products')).toBe(true);
  });

  it('Basic limita staff a 3, no a 10: un centro de 60 socios no tiene 10 empleados', () => {
    expect(planFor('basic').limits.staffUsers).toBe(3);
  });

  it('los limites de miembros y sedes son los de la tabla', () => {
    expect(planFor('basic').limits).toMatchObject({ venues: 1, activeMembers: 60 });
    expect(planFor('pro').limits).toMatchObject({ venues: 3, activeMembers: 180, staffUsers: 10 });
    expect(planFor('max').limits).toMatchObject({
      venues: null,
      activeMembers: null,
      staffUsers: null,
    });
  });

  it('Planning, Results, RMs y Feedback entran recien en Pro', () => {
    const basic = entitlementsOf('basic');
    const pro = entitlementsOf('pro');

    for (const module of ['planning', 'results', 'rms', 'feedback'] as const) {
      expect(hasModule(basic, module), `basic no deberia tener ${module}`).toBe(false);
      expect(hasModule(pro, module), `pro deberia tener ${module}`).toBe(true);
    }
  });

  it('Health y CRM son exclusivos de Max', () => {
    for (const module of ['health', 'crm'] as const) {
      expect(hasModule(entitlementsOf('basic'), module)).toBe(false);
      expect(hasModule(entitlementsOf('pro'), module)).toBe(false);
      expect(hasModule(entitlementsOf('max'), module)).toBe(true);
    }
  });

  it('el QR de check-in y el cobro online arrancan en Pro', () => {
    expect(hasFeature(entitlementsOf('basic'), 'attendance.qr')).toBe(false);
    expect(hasFeature(entitlementsOf('pro'), 'attendance.qr')).toBe(true);
    expect(hasFeature(entitlementsOf('basic'), 'billing.online')).toBe(false);
    expect(hasFeature(entitlementsOf('pro'), 'billing.online')).toBe(true);
  });

  it('Basic ve la libreria de ejercicios pero no la edita', () => {
    expect(hasModule(entitlementsOf('basic'), 'training')).toBe(true);
    expect(hasFeature(entitlementsOf('basic'), 'training.write')).toBe(false);
    expect(hasFeature(entitlementsOf('pro'), 'training.write')).toBe(true);
  });

  it('exportar los propios datos esta en TODOS los planes: retenerlos es lo que espanta clientes', () => {
    for (const planId of PLAN_IDS) {
      expect(hasFeature(entitlementsOf(planId), 'data.export'), planId).toBe(true);
    }
  });

  it('la marca propia y el modo TV son de Max', () => {
    expect(hasFeature(entitlementsOf('pro'), 'wafm.branding')).toBe(false);
    expect(hasFeature(entitlementsOf('max'), 'wafm.branding')).toBe(true);
    expect(hasFeature(entitlementsOf('max'), 'results.tvMode')).toBe(true);
  });

  it('cada plan incluye todo lo del anterior: no hay downgrade encubierto', () => {
    const basic = entitlementsOf('basic');
    const pro = entitlementsOf('pro');
    const max = entitlementsOf('max');

    for (const module of basic.modules) expect(pro.modules.has(module), module).toBe(true);
    for (const module of pro.modules) expect(max.modules.has(module), module).toBe(true);
    for (const feature of basic.features) expect(pro.features.has(feature), feature).toBe(true);
    for (const feature of pro.features) expect(max.features.has(feature), feature).toBe(true);
  });

  it('no hay modulos ni features declarados fuera del catalogo', () => {
    for (const plan of Object.values(PLANS)) {
      for (const module of plan.modules) expect(MODULES).toContain(module);
      for (const feature of plan.features) expect(FEATURES).toContain(feature);
    }
  });

  it('todo limite tiene su nombre en español para el mensaje al usuario', () => {
    for (const limit of Object.keys(planFor('basic').limits)) {
      expect(LIMIT_LABELS[limit as keyof typeof LIMIT_LABELS]).toBeDefined();
    }
  });
});

describe('overrides por suscriptor', () => {
  it('un override pisa el limite del plan', () => {
    const vip = resolveEntitlements({ planId: 'basic', planLimits: { activeMembers: 500 } });

    expect(vip.limits.activeMembers).toBe(500);
    expect(vip.limits.venues).toBe(1);
  });

  it('un override puede quitar el limite del todo', () => {
    const vip = resolveEntitlements({ planId: 'basic', planLimits: { activeMembers: null } });

    expect(limitStatus(vip, 'activeMembers', 10_000).allowsOneMore).toBe(true);
  });

  it('se pueden sumar modulos y features sueltos sin cambiar de plan', () => {
    const vip = resolveEntitlements({
      planId: 'basic',
      extraModules: ['health'],
      extraFeatures: ['attendance.qr'],
    });

    expect(hasModule(vip, 'health')).toBe(true);
    expect(hasFeature(vip, 'attendance.qr')).toBe(true);
  });
});

describe('estado de un limite', () => {
  const basic = entitlementsOf('basic');

  it('con lugar disponible, deja crear', () => {
    const status = limitStatus(basic, 'activeMembers', 59);

    expect(status.allowsOneMore).toBe(true);
    expect(status.atLimit).toBe(false);
  });

  it('justo en el limite, no deja crear uno mas', () => {
    const status = limitStatus(basic, 'activeMembers', 60);

    expect(status.allowsOneMore).toBe(false);
    expect(status.atLimit).toBe(true);
  });

  it('avisa al 80%', () => {
    expect(limitStatus(basic, 'activeMembers', 47).atWarning).toBe(false);
    expect(limitStatus(basic, 'activeMembers', 48).atWarning).toBe(true);
  });

  it('sin limite no avisa nunca', () => {
    const status = limitStatus(entitlementsOf('max'), 'activeMembers', 100_000);

    expect(status.allowsOneMore).toBe(true);
    expect(status.atWarning).toBe(false);
    expect(status.limit).toBeNull();
  });
});

describe('cambio de plan hacia abajo', () => {
  const usage = (partial: Partial<Usage>): Usage => ({
    venues: 1,
    activeMembers: 10,
    staffUsers: 1,
    storageMb: 10,
    ...partial,
  });

  it('un centro chico puede bajar sin problema', () => {
    expect(validateDowngrade('basic', usage({})).allowed).toBe(true);
  });

  it('120 miembros en Pro no pueden bajar a Basic, y se dice por que', () => {
    const check = validateDowngrade('basic', usage({ activeMembers: 120 }));

    expect(check.allowed).toBe(false);
    expect(check.violations).toEqual([{ limit: 'activeMembers', current: 120, max: 60 }]);
  });

  it('lista TODAS las violaciones, no solo la primera: el usuario tiene que ver el cuadro completo', () => {
    const check = validateDowngrade(
      'basic',
      usage({ activeMembers: 120, venues: 2, staffUsers: 7 }),
    );

    expect(check.violations.map((v) => v.limit).sort()).toEqual([
      'activeMembers',
      'staffUsers',
      'venues',
    ]);
  });

  it('subir de plan nunca se bloquea', () => {
    expect(validateDowngrade('max', usage({ activeMembers: 5000, venues: 40 })).allowed).toBe(true);
  });

  it('estar justo en el limite del plan destino se permite', () => {
    expect(validateDowngrade('basic', usage({ activeMembers: 60 })).allowed).toBe(true);
    expect(validateDowngrade('basic', usage({ activeMembers: 61 })).allowed).toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createErrorHandler } from '../http/error-handler.js';
import { createLogger } from '../observability/logger.js';
import type { Entitlements, OrganizationEntitlementSource } from './entitlements.js';
import {
  createEntitlementsLoader,
  entitlementsContext,
  requireFeature,
  requireModule,
  requireWithinLimit,
  type EntitlementsEnv,
} from './middleware.js';

const logger = createLogger({ env: 'test', level: 'silent', service: 'api' });
const ORG = 'org_boxtoro';

type ErrorBody = { success: false; error: { code: string; message: string; action?: string } };

/** App minima con el contexto de organizacion ya resuelto, para probar los guards. */
function buildApp(
  source: OrganizationEntitlementSource,
  wire: (app: Hono<EntitlementsEnv>, loader: ReturnType<typeof createEntitlementsLoader>) => void,
) {
  const read = vi.fn(async (): Promise<OrganizationEntitlementSource> => source);
  const loader = createEntitlementsLoader(read);
  const app = new Hono<EntitlementsEnv>();

  app.use('*', async (c, next) => {
    c.set('org', { organizationId: ORG, memberId: 'mbr_1', roles: ['owner'] });
    await next();
  });
  app.use('*', entitlementsContext(loader));
  app.onError(createErrorHandler(logger));
  wire(app, loader);

  return { app, loader, read };
}

describe('contexto de entitlements', () => {
  it('deja los entitlements resueltos en el contexto', async () => {
    const { app } = buildApp({ planId: 'pro' }, (a) => {
      a.get('/plan', (c) => c.json({ plan: (c.get('entitlements') as Entitlements).planId }));
    });

    const res = await app.request('/plan');

    expect(await res.json()).toEqual({ plan: 'pro' });
  });

  it('no vuelve a leer el plan en cada peticion: usa el cache', async () => {
    const { app, read } = buildApp({ planId: 'pro' }, (a) => {
      a.get('/plan', (c) => c.json({ ok: true }));
    });

    await app.request('/plan');
    await app.request('/plan');
    await app.request('/plan');

    expect(read).toHaveBeenCalledOnce();
  });

  it('al cambiar de plan se invalida: si no, el centro sigue con el anterior', async () => {
    const { app, loader, read } = buildApp({ planId: 'pro' }, (a) => {
      a.get('/plan', (c) => c.json({ ok: true }));
    });

    await app.request('/plan');
    loader.invalidate(ORG);
    await app.request('/plan');

    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe('modulos', () => {
  it('un centro Basic no entra a Planning: LP-ENTL-403-002', async () => {
    const { app } = buildApp({ planId: 'basic' }, (a) => {
      a.get('/planning', requireModule('planning'), (c) => c.json({ ok: true }));
    });

    const res = await app.request('/planning');

    expect(res.status).toBe(403);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('LP-ENTL-403-002');
    expect(body.error.message).toContain('Basic');
    expect(body.error.action).toBeDefined();
  });

  it('un centro Pro si entra', async () => {
    const { app } = buildApp({ planId: 'pro' }, (a) => {
      a.get('/planning', requireModule('planning'), (c) => c.json({ ok: true }));
    });

    expect((await app.request('/planning')).status).toBe(200);
  });

  it('un centro Max entra a Health; Pro no', async () => {
    const max = buildApp({ planId: 'max' }, (a) => {
      a.get('/health-module', requireModule('health'), (c) => c.json({ ok: true }));
    });
    const pro = buildApp({ planId: 'pro' }, (a) => {
      a.get('/health-module', requireModule('health'), (c) => c.json({ ok: true }));
    });

    expect((await max.app.request('/health-module')).status).toBe(200);
    expect((await pro.app.request('/health-module')).status).toBe(403);
  });
});

describe('features', () => {
  it('el QR de check-in no esta en Basic: LP-ENTL-403-003', async () => {
    const { app } = buildApp({ planId: 'basic' }, (a) => {
      a.post('/checkin/qr', requireFeature('attendance.qr'), (c) => c.json({ ok: true }));
    });

    const res = await app.request('/checkin/qr', { method: 'POST' });

    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrorBody).error.code).toBe('LP-ENTL-403-003');
  });

  it('un override le habilita la feature a un Basic sin cambiarle el plan', async () => {
    const { app } = buildApp({ planId: 'basic', extraFeatures: ['attendance.qr'] }, (a) => {
      a.post('/checkin/qr', requireFeature('attendance.qr'), (c) => c.json({ ok: true }));
    });

    expect((await app.request('/checkin/qr', { method: 'POST' })).status).toBe(200);
  });
});

describe('limites', () => {
  const withMembers = (planId: 'basic' | 'pro' | 'max', current: number, onWarning?: () => void) =>
    buildApp({ planId }, (a) => {
      a.post(
        '/members',
        requireWithinLimit('activeMembers', () => Promise.resolve(current), {
          ...(onWarning ? { onWarning } : {}),
        }),
        (c) => c.json({ ok: true }),
      );
    });

  it('el miembro 61 en Basic falla con LP-ENTL-403-001 (§Testing.4)', async () => {
    const { app } = withMembers('basic', 60);

    const res = await app.request('/members', { method: 'POST' });

    expect(res.status).toBe(403);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('LP-ENTL-403-001');
    expect(body.error.message).toContain('60');
    expect(body.error.message).toContain('miembros activos');
    expect(body.error.message).toContain('Basic');
  });

  it('el miembro 60 entra: el corte es exacto, no aproximado', async () => {
    const { app } = withMembers('basic', 59);

    expect((await app.request('/members', { method: 'POST' })).status).toBe(200);
  });

  it('en Max no hay techo', async () => {
    const { app } = withMembers('max', 100_000);

    expect((await app.request('/members', { method: 'POST' })).status).toBe(200);
  });

  it('avisa al 80% sin bloquear', async () => {
    const onWarning = vi.fn();
    const { app } = withMembers('basic', 48, onWarning);

    expect((await app.request('/members', { method: 'POST' })).status).toBe(200);
    expect(onWarning).toHaveBeenCalledWith({ limit: 'activeMembers', current: 48, max: 60 });
  });

  it('no avisa por debajo del 80%', async () => {
    const onWarning = vi.fn();
    const { app } = withMembers('basic', 47, onWarning);

    await app.request('/members', { method: 'POST' });

    expect(onWarning).not.toHaveBeenCalled();
  });

  it('el mensaje trae el numero exacto: sin el, el usuario no sabe que borrar', async () => {
    const { app } = buildApp({ planId: 'basic' }, (a) => {
      a.post(
        '/venues',
        requireWithinLimit('venues', () => Promise.resolve(1)),
        (c) => c.json({ ok: true }),
      );
    });

    const body = (await (await app.request('/venues', { method: 'POST' })).json()) as ErrorBody;

    expect(body.error.message).toContain('1 sedes');
  });
});

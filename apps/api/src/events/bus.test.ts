import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../observability/logger.js';
import { currentTenant, runWithTenant, type TenantContext } from '../tenancy/context.js';
import { createEventBus } from './bus.js';

const logger = createLogger({ env: 'test', level: 'silent', service: 'api' });

const CTX: TenantContext = {
  tenantId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  userId: 'usr_braian',
  requestId: 'req-1',
};

describe('bus de eventos de dominio', () => {
  it('entrega el payload a su handler', async () => {
    const bus = createEventBus(logger);
    const seen: string[] = [];
    bus.on('booking.created', (payload) => {
      seen.push(payload.bookingId);
    });

    await bus.emit('booking.created', {
      bookingId: 'bkg_1',
      sessionId: 'ses_1',
      memberId: 'mem_1',
      venueId: 'ven_1',
    });

    expect(seen).toEqual(['bkg_1']);
  });

  it('entrega a todos los suscriptores del mismo evento', async () => {
    const bus = createEventBus(logger);
    const notifications = vi.fn();
    const metrics = vi.fn();
    bus.on('booking.created', notifications);
    bus.on('booking.created', metrics);

    await bus.emit('booking.created', {
      bookingId: 'bkg_1',
      sessionId: 'ses_1',
      memberId: 'mem_1',
      venueId: 'ven_1',
    });

    expect(notifications).toHaveBeenCalledOnce();
    expect(metrics).toHaveBeenCalledOnce();
  });

  it('un evento sin handlers no es un error', async () => {
    const bus = createEventBus(logger);

    await expect(
      bus.emit('pr.achieved', { resultId: 'rsl_1', memberId: 'mem_1', exerciseId: 'exr_1' }),
    ).resolves.toBeUndefined();
  });

  it('no entrega a los handlers de otro evento', async () => {
    const bus = createEventBus(logger);
    const other = vi.fn();
    bus.on('booking.cancelled', other);

    await bus.emit('booking.created', {
      bookingId: 'bkg_1',
      sessionId: 'ses_1',
      memberId: 'mem_1',
      venueId: 'ven_1',
    });

    expect(other).not.toHaveBeenCalled();
  });
});

describe('aislamiento de fallos', () => {
  it('un handler que lanza no rompe al emisor', async () => {
    const bus = createEventBus(logger);
    bus.on('payment.received', () => {
      throw new Error('el proveedor de mail esta caido');
    });

    await expect(
      bus.emit('payment.received', {
        paymentId: 'pay_1',
        memberId: 'mem_1',
        amountCents: 6_000_000,
      }),
    ).resolves.toBeUndefined();
  });

  it('un handler que falla no impide que corran los otros', async () => {
    const bus = createEventBus(logger);
    const survivor = vi.fn();
    bus.on('payment.received', () => {
      throw new Error('boom');
    });
    bus.on('payment.received', survivor);

    await bus.emit('payment.received', {
      paymentId: 'pay_1',
      memberId: 'mem_1',
      amountCents: 100,
    });

    expect(survivor).toHaveBeenCalledOnce();
  });

  it('tambien aisla los fallos asincronicos', async () => {
    const bus = createEventBus(logger);
    const survivor = vi.fn();
    bus.on('payment.received', async () => {
      await Promise.resolve();
      throw new Error('boom async');
    });
    bus.on('payment.received', survivor);

    await expect(
      bus.emit('payment.received', { paymentId: 'pay_1', memberId: 'mem_1', amountCents: 100 }),
    ).resolves.toBeUndefined();
    expect(survivor).toHaveBeenCalledOnce();
  });

  it('el fallo se loguea con LP-SYS-500-004: no se traga en silencio', async () => {
    const errors: Array<Record<string, unknown>> = [];
    const spyLogger = {
      ...logger,
      error: (obj: Record<string, unknown>) => {
        errors.push(obj);
      },
    } as unknown as typeof logger;

    const bus = createEventBus(spyLogger);
    bus.on('payment.received', () => {
      throw new Error('boom');
    });

    await bus.emit('payment.received', { paymentId: 'pay_1', memberId: 'mem_1', amountCents: 1 });

    expect(errors).toHaveLength(1);
    expect(errors[0]?.['errorCode']).toBe('LP-SYS-500-004');
    expect(errors[0]?.['module']).toBe('events');
  });
});

describe('propagacion del contexto', () => {
  it('el handler ve el mismo tenant que el emisor: sin eso no puede consultar nada', async () => {
    const bus = createEventBus(logger);
    let seen: string | undefined;
    bus.on('booking.created', () => {
      seen = currentTenant()?.tenantId;
    });

    await runWithTenant(CTX, () =>
      bus.emit('booking.created', {
        bookingId: 'bkg_1',
        sessionId: 'ses_1',
        memberId: 'mem_1',
        venueId: 'ven_1',
      }),
    );

    expect(seen).toBe(CTX.tenantId);
  });

  it('el log del fallo lleva el requestId y el tenantId, para poder trazarlo', async () => {
    const errors: Array<Record<string, unknown>> = [];
    const spyLogger = {
      ...logger,
      error: (obj: Record<string, unknown>) => {
        errors.push(obj);
      },
    } as unknown as typeof logger;

    const bus = createEventBus(spyLogger);
    bus.on('booking.created', () => {
      throw new Error('boom');
    });

    await runWithTenant(CTX, () =>
      bus.emit('booking.created', {
        bookingId: 'bkg_1',
        sessionId: 'ses_1',
        memberId: 'mem_1',
        venueId: 'ven_1',
      }),
    );

    expect(errors[0]?.['requestId']).toBe(CTX.requestId);
    expect(errors[0]?.['tenantId']).toBe(CTX.tenantId);
  });

  it('emitir fuera de un contexto no rompe: hay eventos que nacen en un job', async () => {
    const bus = createEventBus(logger);
    const handler = vi.fn();
    bus.on('contract.expiring', handler);

    await expect(
      bus.emit('contract.expiring', { contractId: 'ctr_1', memberId: 'mem_1', daysLeft: 3 }),
    ).resolves.toBeUndefined();
    expect(handler).toHaveBeenCalledOnce();
  });
});

import { describe, expect, it } from 'vitest';
import { AppError } from '../http/errors.js';
import { currentTenant, requireTenant, runWithTenant, type TenantContext } from './context.js';

const CTX: TenantContext = {
  tenantId: '68b5f1a2c3d4e5f6a7b8c9d0',
  userId: '68b5f1a2c3d4e5f6a7b8c9d1',
  requestId: 'req-1',
};

describe('contexto de tenant', () => {
  it('fuera de un contexto no hay tenant', () => {
    expect(currentTenant()).toBeUndefined();
  });

  it('dentro del contexto se lee el tenant', () => {
    runWithTenant(CTX, () => {
      expect(currentTenant()?.tenantId).toBe(CTX.tenantId);
    });
  });

  it('el contexto no se filtra hacia afuera', () => {
    runWithTenant(CTX, () => currentTenant());
    expect(currentTenant()).toBeUndefined();
  });

  it('sobrevive a los saltos asincronicos: es de donde lo lee el plugin de Mongoose', async () => {
    await runWithTenant(CTX, async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(currentTenant()?.tenantId).toBe(CTX.tenantId);
    });
  });

  it('dos contextos concurrentes no se pisan', async () => {
    const a: TenantContext = { ...CTX, tenantId: 'aaaaaaaaaaaaaaaaaaaaaaaa', requestId: 'req-a' };
    const b: TenantContext = { ...CTX, tenantId: 'bbbbbbbbbbbbbbbbbbbbbbbb', requestId: 'req-b' };

    const [seenA, seenB] = await Promise.all([
      runWithTenant(a, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return currentTenant()?.tenantId;
      }),
      runWithTenant(b, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return currentTenant()?.tenantId;
      }),
    ]);

    expect(seenA).toBe(a.tenantId);
    expect(seenB).toBe(b.tenantId);
  });

  it('anidar contextos usa el de adentro y restaura el de afuera', () => {
    runWithTenant(CTX, () => {
      runWithTenant({ ...CTX, tenantId: 'cccccccccccccccccccccccc' }, () => {
        expect(currentTenant()?.tenantId).toBe('cccccccccccccccccccccccc');
      });
      expect(currentTenant()?.tenantId).toBe(CTX.tenantId);
    });
  });
});

describe('requireTenant', () => {
  it('devuelve el contexto cuando existe', () => {
    runWithTenant(CTX, () => {
      expect(requireTenant().tenantId).toBe(CTX.tenantId);
    });
  });

  it('sin contexto lanza LP-SYS-500-003: fallar es lo correcto, devolver todo es la catastrofe', () => {
    expect(() => requireTenant()).toThrowError(AppError);

    try {
      requireTenant();
      expect.unreachable('tenia que lanzar');
    } catch (error) {
      expect((error as AppError).code).toBe('LP-SYS-500-003');
      expect((error as AppError).status).toBe(500);
    }
  });

  it('el mensaje al usuario es generico: el detalle vive en el log, no en la respuesta', () => {
    try {
      requireTenant();
      expect.unreachable('tenia que lanzar');
    } catch (error) {
      expect((error as AppError).message).not.toMatch(/tenant/i);
    }
  });
});

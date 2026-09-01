import { describe, expect, it } from 'vitest';
import { objectIdSchema, tenantContextSchema } from './tenant.js';

/**
 * El tenant es la Organization (ADR-000). Este schema describe el contexto
 * INTERNO del pedido: no se usa para validar el borde HTTP, justamente porque
 * el `tenantId` nunca llega del cliente.
 */
describe('ObjectId', () => {
  it('acepta un ObjectId de 24 hex', () => {
    expect(objectIdSchema.parse('68b5f1a2c3d4e5f6a7b8c9d0')).toBe('68b5f1a2c3d4e5f6a7b8c9d0');
  });

  it('acepta mayusculas', () => {
    expect(() => objectIdSchema.parse('68B5F1A2C3D4E5F6A7B8C9D0')).not.toThrow();
  });

  it('rechaza lo que no lo es', () => {
    for (const invalid of ['', 'abc', '68b5f1a2c3d4e5f6a7b8c9d', '68b5f1a2c3d4e5f6a7b8c9d00', 'zzzzzzzzzzzzzzzzzzzzzzzz']) {
      expect(() => objectIdSchema.parse(invalid), invalid).toThrow();
    }
  });
});

describe('contexto de tenant', () => {
  const valid = {
    tenantId: '68b5f1a2c3d4e5f6a7b8c9d0',
    userId: '68b5f1a2c3d4e5f6a7b8c9d1',
    requestId: 'req-abc',
  };

  it('valida el contexto minimo', () => {
    expect(tenantContextSchema.parse(valid)).toEqual(valid);
  });

  it('el venueId es opcional: es discriminador secundario, no la frontera', () => {
    const withVenue = { ...valid, venueId: '68b5f1a2c3d4e5f6a7b8c9d2' };

    expect(tenantContextSchema.parse(withVenue).venueId).toBe('68b5f1a2c3d4e5f6a7b8c9d2');
    expect(tenantContextSchema.parse(valid).venueId).toBeUndefined();
  });

  it('sin tenantId no hay contexto valido', () => {
    const { tenantId: _, ...sinTenant } = valid;

    expect(() => tenantContextSchema.parse(sinTenant)).toThrow();
  });

  it('sin requestId tampoco: sin el no se puede trazar el pedido', () => {
    const { requestId: _, ...sinRequest } = valid;

    expect(() => tenantContextSchema.parse(sinRequest)).toThrow();
  });

  it('un requestId vacio no sirve', () => {
    expect(() => tenantContextSchema.parse({ ...valid, requestId: '' })).toThrow();
  });

  it('un tenantId que no es ObjectId se rechaza', () => {
    expect(() => tenantContextSchema.parse({ ...valid, tenantId: 'org_boxtoro' })).toThrow();
  });
});

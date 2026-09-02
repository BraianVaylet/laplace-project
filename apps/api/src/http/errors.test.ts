import { describe, expect, it } from 'vitest';
import { apiErrorSchema } from '@laplace/schemas';
import { AppError, statusOf, toErrorEnvelope } from './errors.js';

describe('toErrorEnvelope', () => {
  it('convierte un AppError al envelope de la spec §5.0', () => {
    const error = new AppError({
      code: 'LP-BOOK-409-002',
      status: 409,
      message: 'La clase esta completa.',
      action: 'Podes sumarte a la lista de espera.',
    });

    const envelope = toErrorEnvelope(error, 'req-123');

    expect(apiErrorSchema.safeParse(envelope).success).toBe(true);
    expect(envelope.error.code).toBe('LP-BOOK-409-002');
    expect(envelope.error.requestId).toBe('req-123');
    expect(statusOf(error)).toBe(409);
  });

  it('no filtra el detalle de un error no controlado, pero deja el requestId', () => {
    const envelope = toErrorEnvelope(new Error('connection string leaked'), 'req-456');

    expect(envelope.error.code).toBe('LP-SYS-500-001');
    expect(envelope.error.message).not.toContain('connection string');
    expect(envelope.error.requestId).toBe('req-456');
    expect(statusOf(new Error('x'))).toBe(500);
  });

  it('siempre produce un envelope valido contra el schema compartido', () => {
    for (const input of [new Error('x'), 'string suelto', null, undefined, { a: 1 }]) {
      expect(apiErrorSchema.safeParse(toErrorEnvelope(input, 'req')).success).toBe(true);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { apiErrorSchema, errorCodeSchema } from './error.js';

describe('errorCodeSchema', () => {
  it('acepta los codigos del diccionario de docs/errors.md', () => {
    for (const code of ['LP-AUTH-401-001', 'LP-BOOK-409-002', 'LP-SYS-500-001', 'LP-RM-422-001']) {
      expect(errorCodeSchema.safeParse(code).success).toBe(true);
    }
  });

  it('rechaza un codigo con formato invalido', () => {
    for (const code of ['AUTH-401-001', 'LP-auth-401-001', 'LP-AUTH-41-001', 'LP-AUTH-401-1']) {
      expect(errorCodeSchema.safeParse(code).success).toBe(false);
    }
  });
});

describe('apiErrorSchema', () => {
  it('valida el envelope de error de la spec §5.0', () => {
    const payload = {
      success: false,
      error: {
        code: 'LP-BOOK-409-002',
        message: 'La clase ya alcanzo su capacidad maxima.',
        action: 'Podes sumarte a la lista de espera.',
        requestId: '01J9X7K2ABCDEF',
        timestamp: '2026-08-31T14:03:11.412Z',
      },
    };
    expect(apiErrorSchema.safeParse(payload).success).toBe(true);
  });

  it('rechaza un error sin requestId, porque el usuario no podria reportarlo', () => {
    const payload = {
      success: false,
      error: {
        code: 'LP-SYS-500-001',
        message: 'Ocurrio un error.',
        timestamp: '2026-08-31T14:03:11.412Z',
      },
    };
    expect(apiErrorSchema.safeParse(payload).success).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { apiErrorSchema, apiSuccessSchema, errorCodeSchema } from './error.js';

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

describe('envelope de exito', () => {
  const memberSchema = z.object({ publicId: z.string(), firstName: z.string() });
  const ok = apiSuccessSchema(memberSchema);

  it('envuelve el dato con success: true', () => {
    const parsed = ok.parse({ success: true, data: { publicId: 'mem_1', firstName: 'Micaela' } });

    expect(parsed.success).toBe(true);
    expect(parsed.data.firstName).toBe('Micaela');
  });

  it('rechaza un success: false: para eso esta el envelope de error', () => {
    expect(() =>
      ok.parse({ success: false, data: { publicId: 'mem_1', firstName: 'Micaela' } }),
    ).toThrow();
  });

  it('valida el dato con el schema que se le pasa', () => {
    expect(() => ok.parse({ success: true, data: { publicId: 'mem_1' } })).toThrow();
  });

  it('exito y error nunca se confunden: los discrimina el campo success', () => {
    const errorShaped = {
      success: false,
      error: { code: 'LP-SYS-500-001', message: 'x', requestId: 'r', timestamp: 't' },
    };

    expect(() => ok.parse(errorShaped)).toThrow();
    expect(apiErrorSchema.parse(errorShaped).success).toBe(false);
  });
});

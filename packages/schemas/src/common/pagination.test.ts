import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { paginatedSchema, paginationQuerySchema } from './pagination.js';

/**
 * Paginacion cursor-based, obligatoria en todo listado (spec §5.0). El limite
 * tiene techo porque un `?limit=100000` es la forma mas facil de bajarse una
 * coleccion entera desde afuera.
 */
describe('query de paginacion', () => {
  it('sin nada, usa el limite por default', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: 20 });
  });

  it('acepta un cursor', () => {
    const parsed = paginationQuerySchema.parse({ cursor: 'abc123', limit: '10' });

    expect(parsed.cursor).toBe('abc123');
    expect(parsed.limit).toBe(10);
  });

  it('el limite llega como string desde la URL y sale como numero', () => {
    expect(paginationQuerySchema.parse({ limit: '50' }).limit).toBe(50);
  });

  it('rechaza un limite de cero o negativo', () => {
    expect(() => paginationQuerySchema.parse({ limit: '0' })).toThrow();
    expect(() => paginationQuerySchema.parse({ limit: '-5' })).toThrow();
  });

  it('rechaza un limite por encima del techo: pedir 100000 no baja la coleccion', () => {
    expect(() => paginationQuerySchema.parse({ limit: '101' })).toThrow();
    expect(paginationQuerySchema.parse({ limit: '100' }).limit).toBe(100);
  });

  it('rechaza un limite que no es numero', () => {
    expect(() => paginationQuerySchema.parse({ limit: 'muchos' })).toThrow();
  });

  it('rechaza un limite decimal: media pagina no existe', () => {
    expect(() => paginationQuerySchema.parse({ limit: '10.5' })).toThrow();
  });
});

describe('respuesta paginada', () => {
  const memberSchema = z.object({ publicId: z.string(), firstName: z.string() });
  const page = paginatedSchema(memberSchema);

  it('valida los items y el cursor de la pagina siguiente', () => {
    const parsed = page.parse({
      items: [{ publicId: 'mem_1', firstName: 'Micaela' }],
      nextCursor: 'eyJ2IjoxfQ',
    });

    expect(parsed.items).toHaveLength(1);
    expect(parsed.nextCursor).toBe('eyJ2IjoxfQ');
  });

  it('la ultima pagina trae nextCursor en null, no ausente', () => {
    expect(page.parse({ items: [], nextCursor: null }).nextCursor).toBeNull();
    expect(() => page.parse({ items: [] })).toThrow();
  });

  it('rechaza items que no cumplen el schema del elemento', () => {
    expect(() => page.parse({ items: [{ publicId: 'mem_1' }], nextCursor: null })).toThrow();
  });

  it('una lista vacia es valida: un centro nuevo no tiene socios', () => {
    expect(page.parse({ items: [], nextCursor: null }).items).toEqual([]);
  });
});

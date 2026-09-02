import { describe, expect, it } from 'vitest';
import {
  IMPORT_COLUMN_ALIASES,
  confirmImportSchema,
  importDateSchema,
  memberImportRowSchema,
} from './import.js';

describe('fecha de una planilla', () => {
  it('acepta el formato que exporta Excel en es-AR', () => {
    expect(importDateSchema.parse('12/04/1999')).toBe('1999-04-12');
    expect(importDateSchema.parse('1/4/1999')).toBe('1999-04-01');
  });

  it('acepta la ISO tal cual', () => {
    expect(importDateSchema.parse('1999-04-12')).toBe('1999-04-12');
  });

  it('rechaza una fecha que no existe, venga como venga', () => {
    expect(() => importDateSchema.parse('31/02/1999')).toThrow();
    expect(() => importDateSchema.parse('1999-02-31')).toThrow();
  });

  it('rechaza lo que no es una fecha', () => {
    expect(() => importDateSchema.parse('sin datos')).toThrow();
  });
});

describe('fila del archivo', () => {
  it('con nombre y apellido alcanza', () => {
    const row = memberImportRowSchema.parse({ firstName: 'Micaela', lastName: 'Sosa' });

    expect(row.tags).toEqual([]);
    expect(row.docId).toBeUndefined();
  });

  it('normaliza el documento igual que el alta manual', () => {
    const row = memberImportRowSchema.parse({
      firstName: 'Micaela',
      lastName: 'Sosa',
      docId: '40.123.456',
    });

    expect(row.docId).toBe('40123456');
  });

  it('el mensaje de error dice qué corregir, en español', () => {
    const result = memberImportRowSchema.safeParse({ firstName: 'M', lastName: 'Sosa' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Cargá el nombre.');
  });

  it('la sede no viaja por fila: la elige el SMU una vez para todo el archivo', () => {
    expect('venueIds' in memberImportRowSchema.shape).toBe(false);
  });
});

describe('alias de columna', () => {
  it('cubre lo que sale de un Excel argentino', () => {
    expect(IMPORT_COLUMN_ALIASES['docId']).toContain('dni');
    expect(IMPORT_COLUMN_ALIASES['phone']).toContain('celular');
    expect(IMPORT_COLUMN_ALIASES['birthDate']).toContain('fechadenacimiento');
  });

  it('los alias estan normalizados: sin acentos, sin espacios, en minuscula', () => {
    for (const alias of Object.values(IMPORT_COLUMN_ALIASES).flat()) {
      expect(alias, alias).toBe(alias.toLowerCase());
      expect(alias, alias).not.toMatch(/[\sáéíóúñ]/);
    }
  });
});

describe('confirmacion', () => {
  const FILA = { firstName: 'Micaela', lastName: 'Sosa' };

  it('exige sede y al menos una fila', () => {
    expect(() => confirmImportSchema.parse({ venueIds: [], rows: [FILA] })).toThrow();
    expect(() => confirmImportSchema.parse({ venueIds: ['ven_x'], rows: [] })).toThrow();
  });

  it('los duplicados se saltean salvo que se pida lo contrario', () => {
    const parsed = confirmImportSchema.parse({ venueIds: ['ven_x'], rows: [FILA] });

    // Pisar datos existentes por default seria destructivo y silencioso.
    expect(parsed.onDuplicate).toBe('skip');
  });
});

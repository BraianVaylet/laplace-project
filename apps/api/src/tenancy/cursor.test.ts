import { describe, expect, it } from 'vitest';
import { AppError } from '../http/errors.js';
import { decodeCursor, encodeCursor, keysetFilter, type CursorPosition } from './cursor.js';

const POSITION: CursorPosition = { value: '2026-03-15T10:00:00Z', id: '68b5f1a2c3d4e5f6a7b8c9d0' };

describe('cursor', () => {
  it('ida y vuelta conserva la posicion', () => {
    expect(decodeCursor(encodeCursor(POSITION))).toEqual(POSITION);
  });

  it('es opaco: no expone el _id en claro en la URL', () => {
    const cursor = encodeCursor(POSITION);

    expect(cursor).not.toContain(POSITION.id);
    expect(cursor).not.toContain('2026');
  });

  it('es seguro en una URL', () => {
    const cursor = encodeCursor(POSITION);

    expect(encodeURIComponent(cursor)).toBe(cursor);
  });

  it('soporta valores numericos', () => {
    const position: CursorPosition = { value: 42, id: POSITION.id };

    expect(decodeCursor(encodeCursor(position))).toEqual(position);
  });

  it('un cursor manipulado se rechaza con LP-SYS-422-006, no explota', () => {
    for (const basura of ['no-es-base64', '', 'eyJmb28iOiJiYXIifQ', btoa('{"nada":1}')]) {
      expect(() => decodeCursor(basura)).toThrowError(AppError);
    }

    try {
      decodeCursor('no-es-base64');
      expect.unreachable('tenia que lanzar');
    } catch (error) {
      expect((error as AppError).code).toBe('LP-SYS-422-006');
    }
  });
});

describe('filtro keyset', () => {
  it('sin cursor no agrega condicion: es la primera pagina', () => {
    expect(keysetFilter(null, 'startAt', 'desc')).toEqual({});
  });

  it('descendente pide lo estrictamente anterior, con el _id como desempate', () => {
    const filter = keysetFilter(POSITION, 'startAt', 'desc');

    expect(filter).toEqual({
      $or: [
        { startAt: { $lt: POSITION.value } },
        { startAt: POSITION.value, _id: { $lt: POSITION.id } },
      ],
    });
  });

  it('ascendente pide lo estrictamente posterior', () => {
    const filter = keysetFilter(POSITION, 'startAt', 'asc');

    expect(filter).toEqual({
      $or: [
        { startAt: { $gt: POSITION.value } },
        { startAt: POSITION.value, _id: { $gt: POSITION.id } },
      ],
    });
  });

  it('el desempate por _id existe para que dos documentos con el mismo valor no se pierdan ni se repitan', () => {
    const filter = keysetFilter(POSITION, 'startAt', 'desc') as {
      $or: Array<Record<string, unknown>>;
    };

    expect(filter.$or).toHaveLength(2);
    expect(filter.$or[1]).toHaveProperty('_id');
  });
});

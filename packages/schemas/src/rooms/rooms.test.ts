import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROOM_NAME,
  EQUIPMENT_KINDS,
  createRoomSchema,
  equipmentSchema,
  updateRoomSchema,
} from './index.js';

const VALIDO = { venueId: 'ven_abc123', name: 'Principal', capacity: 16 };

describe('alta de sala', () => {
  it('con nombre, capacidad y sede alcanza', () => {
    const parsed = createRoomSchema.parse(VALIDO);

    expect(parsed.name).toBe('Principal');
    expect(parsed.capacity).toBe(16);
    expect(parsed.equipment).toEqual([]);
  });

  it('exige la sede: una sala sin Venue no existe en el modelo (§1.1)', () => {
    const { venueId: _v, ...sinVenue } = VALIDO;

    expect(() => createRoomSchema.parse(sinVenue)).toThrow();
  });

  it('recorta los espacios del nombre', () => {
    expect(createRoomSchema.parse({ ...VALIDO, name: '  Sala 2  ' }).name).toBe('Sala 2');
  });

  it('la capacidad es un entero positivo: media persona no entra a una clase', () => {
    for (const invalida of [0, -3, 2.5]) {
      expect(
        () => createRoomSchema.parse({ ...VALIDO, capacity: invalida }),
        `${invalida}`,
      ).toThrow();
    }
  });

  it('rechaza una capacidad absurda: 5000 en una sala es un error de tipeo', () => {
    expect(() => createRoomSchema.parse({ ...VALIDO, capacity: 5000 })).toThrow();
  });
});

describe('equipamiento', () => {
  it('acepta los tipos declarados con su cantidad', () => {
    const parsed = createRoomSchema.parse({
      ...VALIDO,
      equipment: [
        { kind: 'rack', quantity: 8 },
        { kind: 'bike', quantity: 4 },
      ],
    });

    expect(parsed.equipment).toHaveLength(2);
    expect(parsed.equipment[0]?.kind).toBe('rack');
  });

  it('cubre los que nombra la spec §2.1: racks, bicis y remos', () => {
    for (const kind of ['rack', 'bike', 'rower'] as const) {
      expect(() => equipmentSchema.parse({ kind, quantity: 1 }), kind).not.toThrow();
    }
  });

  it('deja un "otro" con etiqueta libre: el catalogo cerrado deja centros afuera', () => {
    const parsed = equipmentSchema.parse({ kind: 'other', label: 'Camas elásticas', quantity: 6 });

    expect(parsed.label).toBe('Camas elásticas');
  });

  it('"otro" sin etiqueta no sirve: nadie sabria que se reservó', () => {
    expect(() => equipmentSchema.parse({ kind: 'other', quantity: 6 })).toThrow();
  });

  it('la cantidad es un entero de al menos 1', () => {
    expect(() => equipmentSchema.parse({ kind: 'rack', quantity: 0 })).toThrow();
    expect(() => equipmentSchema.parse({ kind: 'rack', quantity: 1.5 })).toThrow();
  });

  it('no admite el mismo tipo dos veces: son cantidades, no eventos', () => {
    expect(() =>
      createRoomSchema.parse({
        ...VALIDO,
        equipment: [
          { kind: 'rack', quantity: 8 },
          { kind: 'rack', quantity: 2 },
        ],
      }),
    ).toThrow();
  });

  it('pero si dos "otros" distintos, que se distinguen por su etiqueta', () => {
    expect(() =>
      createRoomSchema.parse({
        ...VALIDO,
        equipment: [
          { kind: 'other', label: 'TRX', quantity: 6 },
          { kind: 'other', label: 'Sacos', quantity: 4 },
        ],
      }),
    ).not.toThrow();
  });

  it('el catalogo de tipos esta exportado para que la UI no lo reescriba', () => {
    expect(EQUIPMENT_KINDS).toContain('rack');
    expect(EQUIPMENT_KINDS).toContain('other');
  });
});

describe('edicion de sala', () => {
  it('todo opcional salvo lo que se manda', () => {
    expect(() => updateRoomSchema.parse({})).not.toThrow();
    expect(updateRoomSchema.parse({ capacity: 20 }).capacity).toBe(20);
  });

  it('no deja mudar la sala de sede: eso rompe el historico de la clase', () => {
    // Mover una sala de Venue dejaria sesiones pasadas apuntando a una sede
    // donde nunca ocurrieron, y las metricas por sede quedarian mal para siempre.
    expect('venueId' in updateRoomSchema.shape).toBe(false);
  });

  it('lo que se manda igual se valida', () => {
    expect(() => updateRoomSchema.parse({ capacity: 0 })).toThrow();
  });
});

describe('la sala por default', () => {
  it('tiene un nombre unico y compartido con el modulo que la crea', () => {
    // §1.1: el 90% de los centros tiene una sola sala y nunca deberia ver el
    // concepto. El nombre vive acá para que el back y la UI digan lo mismo.
    expect(DEFAULT_ROOM_NAME).toBe('Principal');
  });
});

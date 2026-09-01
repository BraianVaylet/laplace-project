import { describe, expect, it } from 'vitest';
import { canTransition, resolveSessionCapacity } from './room.js';

describe('estados de la sala', () => {
  it('una sala activa se puede archivar y una archivada reactivar', () => {
    expect(canTransition('active', 'archived')).toBe(true);
    expect(canTransition('archived', 'active')).toBe(true);
  });

  it('no hay transicion a si misma', () => {
    expect(canTransition('active', 'active')).toBe(false);
  });
});

describe('capacidad de la clase (§2.1.5.b)', () => {
  it('sin override, la clase hereda la capacidad de la sala', () => {
    expect(resolveSessionCapacity(16)).toBe(16);
    expect(resolveSessionCapacity(16, undefined)).toBe(16);
  });

  it('con override menor, manda el override', () => {
    // Una clase de técnica con un solo coach puede querer 8 aunque entren 16.
    expect(resolveSessionCapacity(16, 8)).toBe(8);
  });

  it('el override no puede superar la capacidad fisica de la sala', () => {
    // La sala es el techo real: 20 personas no entran donde entran 16, y
    // dejarlo pasar convierte la lista de espera en una promesa que no se cumple.
    expect(() => resolveSessionCapacity(16, 20)).toThrow(/16/);
  });

  it('un override igual a la capacidad es valido: es el caso normal explicitado', () => {
    expect(resolveSessionCapacity(16, 16)).toBe(16);
  });

  it('un override de 0 o negativo no es una clase', () => {
    expect(() => resolveSessionCapacity(16, 0)).toThrow();
    expect(() => resolveSessionCapacity(16, -1)).toThrow();
  });
});

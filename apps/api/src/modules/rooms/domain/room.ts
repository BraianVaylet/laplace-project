import type { Equipment, RoomStatus } from '@laplace/schemas';
import { AppError } from '../../../http/errors.js';

/**
 * La sala: espacio físico con capacidad y equipamiento (§1.1). Es de donde
 * hereda la capacidad una clase.
 *
 * Reglas puras, sin Mongoose ni Hono.
 */
export interface Room {
  publicId: string;
  venueId: string;
  name: string;
  capacity: number;
  equipment: Equipment[];
  status: RoomStatus;
}

/** §14: los estados cambian solo por transición explícita, nunca con un update libre. */
const TRANSITIONS: Record<RoomStatus, readonly RoomStatus[]> = {
  active: ['archived'],
  archived: ['active'],
};

export function canTransition(from: RoomStatus, to: RoomStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * La capacidad con la que arranca una sesión (§2.1.5.b): la de la sala, salvo
 * que la clase declare la suya.
 *
 * El override puede bajar pero no subir: la sala es el techo físico. Dejar pasar
 * 20 donde entran 16 convierte la lista de espera en una promesa que no se
 * cumple, y el que se entera es el socio parado en la puerta.
 */
export function resolveSessionCapacity(roomCapacity: number, override?: number): number {
  if (override === undefined) return roomCapacity;

  if (!Number.isInteger(override) || override < 1) {
    throw new AppError({
      code: 'LP-SCHD-422-007',
      status: 422,
      message: 'El cupo de la clase tiene que ser de al menos 1 persona.',
      meta: { override },
    });
  }

  if (override > roomCapacity) {
    throw new AppError({
      code: 'LP-SCHD-422-007',
      status: 422,
      message: `La sala admite ${roomCapacity} personas: el cupo de la clase no puede superarlo.`,
      meta: { override, roomCapacity },
    });
  }

  return override;
}

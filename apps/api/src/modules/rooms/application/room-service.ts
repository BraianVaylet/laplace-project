import type { CreateRoomInput, UpdateRoomInput } from '@laplace/schemas';
import { DEFAULT_ROOM_NAME } from '@laplace/schemas';
import type { Logger } from 'pino';
import type { DomainEventBus } from '../../../events/bus.js';
import { AppError } from '../../../http/errors.js';
import type { Page } from '../../../tenancy/repository.js';
import { canTransition } from '../domain/room.js';
import type { RoomDoc } from '../infrastructure/room.model.js';
import type { RoomRepository } from '../infrastructure/room.repository.js';
import type { FutureSessionCounter, VenueLookup } from './ports.js';

/** Cupo de la sala que se crea sola. El SMU lo corrige en un campo. */
const DEFAULT_ROOM_CAPACITY = 20;

export interface RoomServiceDeps {
  rooms: RoomRepository;
  venues: VenueLookup;
  sessions: FutureSessionCounter;
  logger: Logger;
}

/**
 * Casos de uso de Room. Orquesta el repositorio y habla con los otros módulos
 * por interfaz; no sabe de HTTP ni de Mongoose.
 */
export class RoomService {
  private readonly rooms: RoomRepository;
  private readonly venues: VenueLookup;
  private readonly sessions: FutureSessionCounter;
  private readonly logger: Logger;

  constructor(deps: RoomServiceDeps) {
    this.rooms = deps.rooms;
    this.venues = deps.venues;
    this.sessions = deps.sessions;
    this.logger = deps.logger;
  }

  async create(input: CreateRoomInput): Promise<RoomDoc> {
    // La sede se valida contra Venues, no contra la base propia: una sala
    // colgando de un venueId inexistente no la ve nadie y no se puede borrar.
    if (!(await this.venues.exists(input.venueId))) {
      throw new AppError({
        code: 'LP-SCHD-404-008',
        status: 404,
        message: 'No encontramos esa sede.',
        meta: { venueId: input.venueId },
      });
    }

    return this.rooms.create({ ...input, status: 'active' } as Partial<RoomDoc>);
  }

  async list(venueId?: string, cursor?: string, limit?: number): Promise<Page<RoomDoc>> {
    return this.rooms.list(venueId === undefined ? {} : { venueId }, {
      sortField: 'createdAt',
      direction: 'desc',
      ...(cursor ? { cursor } : {}),
      ...(limit ? { limit } : {}),
    });
  }

  async getByPublicId(publicId: string): Promise<RoomDoc> {
    const room = await this.rooms.findByPublicId(publicId);
    if (!room) throw notFound(publicId);

    return room;
  }

  async update(publicId: string, input: UpdateRoomInput): Promise<RoomDoc> {
    const updated = await this.rooms.updateByPublicId(publicId, { $set: { ...input } });
    if (!updated) throw notFound(publicId);

    return updated;
  }

  /** §14: archivar y reactivar solo por transición explícita y validada. */
  async changeStatus(publicId: string, to: 'active' | 'archived'): Promise<RoomDoc> {
    const room = await this.getByPublicId(publicId);
    const from = room.status as 'active' | 'archived';

    if (!canTransition(from, to)) {
      throw new AppError({
        code: 'LP-SCHD-422-006',
        status: 422,
        message: `No se puede pasar de ${from} a ${to}.`,
        meta: { publicId, from, to },
      });
    }

    const updated = await this.rooms.updateByPublicId(publicId, { $set: { status: to } });
    if (!updated) throw notFound(publicId);

    return updated;
  }

  /**
   * Borrado lógico. Se bloquea si la sala tiene clases programadas: borrarla
   * dejaría sesiones apuntando a un espacio que ya no existe, y los socios que
   * reservaron se enterarían al llegar.
   */
  async remove(publicId: string): Promise<void> {
    await this.getByPublicId(publicId);

    const futuras = await this.sessions.countFutureSessions(publicId);
    if (futuras > 0) {
      throw new AppError({
        code: 'LP-SCHD-409-002',
        status: 409,
        message: 'La sala tiene clases programadas.',
        action: 'Podés archivarla: deja de usarse y el histórico se conserva.',
        meta: { publicId, futureSessions: futuras },
      });
    }

    await this.rooms.softDeleteByPublicId(publicId);
  }

  /**
   * Crea la sala por default de una sede recién creada (§1.1: el 90% de los
   * centros tiene una sola y nunca debería ver el concepto).
   *
   * Es idempotente: si la sede ya tiene salas, no hace nada. El evento puede
   * reintentarse, y un segundo "Principal" sería peor que ninguno.
   */
  async createDefaultRoom(venueId: string): Promise<RoomDoc | null> {
    if ((await this.rooms.countByVenue(venueId)) > 0) return null;

    const room = await this.rooms.create({
      venueId,
      name: DEFAULT_ROOM_NAME,
      capacity: DEFAULT_ROOM_CAPACITY,
      equipment: [],
      status: 'active',
    } as Partial<RoomDoc>);

    this.logger.info(
      { module: 'rooms', action: 'createDefaultRoom', venueId, meta: { roomId: room['publicId'] } },
      'Sala por default creada con la sede',
    );

    return room;
  }
}

/**
 * Se suscribe a `venue.created`. Va por evento y no por llamada directa porque
 * Venues no puede crear el modelo de Rooms (ADR-003).
 *
 * El bus aísla los fallos a propósito: si esto falla, la sede queda creada igual
 * y el error se loguea. Es preferible a que no se pueda dar de alta una sede
 * porque su sala automática falló.
 */
export function subscribeRoomsToVenues(events: DomainEventBus, service: RoomService): void {
  events.on('venue.created', async ({ venueId }) => {
    await service.createDefaultRoom(venueId);
  });
}

/** 404 y no 403: un 403 sobre el recurso de otro centro confirma que existe. */
function notFound(publicId: string): AppError {
  return new AppError({
    code: 'LP-SYS-404-002',
    status: 404,
    message: 'No encontramos esa sala.',
    meta: { publicId },
  });
}

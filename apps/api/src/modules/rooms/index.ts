import type { Logger } from 'pino';
import type { EntitlementsLoader } from '../../entitlements/middleware.js';
import type { DomainEventBus } from '../../events/bus.js';
import { runWithTenant } from '../../tenancy/context.js';
import { RoomService, subscribeRoomsToVenues } from './application/room-service.js';
import {
  NO_SESSIONS_YET,
  type FutureSessionCounter,
  type VenueLookup,
} from './application/ports.js';
import { RoomRepository } from './infrastructure/room.repository.js';
import { createRoomRoutes } from './infrastructure/routes.js';
import type { RoomDoc } from './infrastructure/room.model.js';

/**
 * Interfaz publica del modulo Rooms. Es lo unico que puede tocar otro modulo:
 * el repositorio y el modelo se quedan adentro (ADR-003).
 */
export interface RoomsModule {
  routes: ReturnType<typeof createRoomRoutes>;
  service: RoomService;
}

export interface RoomsModuleDeps {
  events: DomainEventBus;
  entitlements: EntitlementsLoader;
  logger: Logger;
  venues: VenueLookup;
  /** Lo contesta Schedule cuando exista (F1-12). */
  sessions?: FutureSessionCounter | undefined;
}

export function createRoomsModule(deps: RoomsModuleDeps): RoomsModule {
  const rooms = new RoomRepository();
  const service = new RoomService({
    rooms,
    venues: deps.venues,
    sessions: deps.sessions ?? NO_SESSIONS_YET,
    logger: deps.logger,
  });

  // La sala por default de una sede nueva. Va por evento porque Venues no puede
  // crear el modelo de Rooms (ADR-003).
  subscribeRoomsToVenues(deps.events, service);

  /**
   * Siembra una sala del tenant victima para la suite de aislamiento (F0-05).
   * Vive aca y no en las rutas porque es el modulo el que tiene el repositorio.
   *
   * El `venueId` es sintetico a proposito: la ruta bajo ataque nunca lo valida
   * al leer, y hacer que dependa de Venues ataria dos modulos por un fixture.
   */
  const seedVictimRoom = async (victimTenantId: string) => {
    const venueId = `ven_victima_${victimTenantId.slice(0, 8)}`;

    const room = await runWithTenant(
      { tenantId: victimTenantId, userId: 'usr_isolation_seed', requestId: 'req-isolation-seed' },
      () =>
        rooms.create({
          venueId,
          name: 'Sala del otro centro',
          capacity: 16,
          equipment: [],
          status: 'active',
        } as Partial<RoomDoc>),
    );

    return { roomId: String(room['publicId']), venueId };
  };

  return { routes: createRoomRoutes(service, deps.entitlements, seedVictimRoom), service };
}

export type { RoomService } from './application/room-service.js';
export type { FutureSessionCounter, VenueLookup } from './application/ports.js';

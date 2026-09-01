import type { Logger } from 'pino';
import { currentTenant } from '../tenancy/context.js';
import type { DomainEventName, DomainEvents } from './types.js';

export type EventHandler<K extends DomainEventName> = (
  payload: DomainEvents[K],
) => void | Promise<void>;

export interface DomainEventBus {
  on<K extends DomainEventName>(event: K, handler: EventHandler<K>): void;
  emit<K extends DomainEventName>(event: K, payload: DomainEvents[K]): Promise<void>;
}

/**
 * Bus in-process y tipado (ADR-003, ADR-006).
 *
 * Dos garantias que importan mas que la entrega:
 *
 * 1. **Un handler que falla no rompe al emisor.** Si el mail de confirmacion no
 *    sale, la reserva ya esta hecha igual — y al reves seria peor.
 * 2. **Un handler que falla no impide que corran los demas.** Se usa
 *    `allSettled`, no `all`.
 *
 * En Fase 2 esto pasa a una cola. La interfaz no cambia: `emit` pasa a encolar.
 */
export function createEventBus(logger: Logger): DomainEventBus {
  const handlers = new Map<DomainEventName, Array<EventHandler<DomainEventName>>>();

  return {
    on(event, handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler as EventHandler<DomainEventName>);
      handlers.set(event, list);
    },

    async emit(event, payload) {
      const subscribers = handlers.get(event);
      if (!subscribers?.length) return;

      const context = currentTenant();

      const results = await Promise.allSettled(
        subscribers.map(async (handler) => handler(payload as never)),
      );

      for (const result of results) {
        if (result.status !== 'rejected') continue;

        logger.error(
          {
            module: 'events',
            action: event,
            errorCode: 'LP-SYS-500-004',
            ...(context ? { requestId: context.requestId, tenantId: context.tenantId } : {}),
            meta: { payload },
          },
          result.reason instanceof Error ? result.reason.message : String(result.reason),
        );
      }
    },
  };
}

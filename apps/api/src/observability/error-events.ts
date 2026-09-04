import type { Collection, Db } from 'mongodb';
import { Temporal } from '@js-temporal/polyfill';
import { toBsonDate } from '../persistence/bson-date.js';
import { COLLECTIONS } from '../persistence/collections.js';

/**
 * El registro de errores que consulta el panel de soporte del DFSA (§11.3).
 *
 * Es lo que hace verdadera la promesa de §5: "compartí el código con soporte".
 * Sin esto, el socio pasa un `requestId` y del otro lado no hay dónde pegarlo.
 *
 * 🔴 **Guarda el código, no el contenido.** Nada del mensaje, del `meta` ni del
 * cuerpo del pedido entra acá, y no es una omisión: el SAU **no puede ver
 * datos de miembros** (ADR-004, decisión 7), y un `meta` con el nombre y el
 * saldo de un socio convertiría este panel en la puerta de atrás que esa
 * decisión existe para cerrar. Para ver datos de un centro hay un solo camino,
 * y es la impersonación auditada.
 */
export interface ErrorEvent {
  requestId: string;
  code: string;
  status: number;
  method: string;
  /** La ruta, sin querystring: ahí viajan filtros que pueden identificar gente. */
  path: string;
  /** De qué centro salió el pedido, si había sesión. Es un id, no un dato. */
  tenantId: string | null;
  at: Date;
}

export interface ErrorEventStore {
  record(event: Omit<ErrorEvent, 'at'>): Promise<void>;
  /** El buscador de soporte: por `requestId` o por código (§11.3). */
  find(filter: { requestId?: string; code?: string }, limit?: number): Promise<ErrorEvent[]>;
  /** Cuántos de cada código en las últimas horas, para el panel de salud. */
  countByCode(since: Temporal.Instant): Promise<Array<{ code: string; total: number }>>;
}

export function createErrorEventStore(db: Db): ErrorEventStore {
  const events: Collection<ErrorEvent> = db.collection(COLLECTIONS.errorEvent);

  return {
    async record(event) {
      await events.insertOne({
        ...event,
        at: toBsonDate(Temporal.Now.instant()),
      });
    },

    async find(filter, limit = 20) {
      // Sin filtro no devuelve nada: listar todos los errores del SaaS no es
      // una búsqueda de soporte, es un volcado.
      if (!filter.requestId && !filter.code) return [];

      return events
        .find({
          ...(filter.requestId ? { requestId: filter.requestId } : {}),
          ...(filter.code ? { code: filter.code } : {}),
        })
        .sort({ at: -1 })
        .limit(limit)
        .toArray();
    },

    async countByCode(since) {
      const filas = await events
        .aggregate<{ _id: string; total: number }>([
          { $match: { at: { $gte: toBsonDate(since) } } },
          { $group: { _id: '$code', total: { $sum: 1 } } },
          { $sort: { total: -1 } },
          { $limit: 20 },
        ])
        .toArray();

      return filas.map((fila) => ({ code: fila._id, total: fila.total }));
    },
  };
}

/**
 * Un store que no guarda nada. Lo usan los tests que no montan Mongo y el
 * arranque en local: el registro de errores no puede ser un requisito para que
 * la app levante.
 */
export const NULL_ERROR_EVENT_STORE: ErrorEventStore = {
  record: () => Promise.resolve(),
  find: () => Promise.resolve([]),
  countByCode: () => Promise.resolve([]),
};

import { ApiRequestError } from '../api/client.js';

/**
 * La cola del kiosko sin red (§2.1.18).
 *
 * La tablet de la puerta es el peor lugar del gimnasio para depender del WiFi:
 * está lejos del router, detrás de una pared, y cuando se cae hay gente
 * esperando para entrar. Así que el check-in se encola local y se sincroniza al
 * volver la conexión.
 *
 * 🔴 La clave de idempotencia se genera **al encolar**, no al enviar. Es lo
 * único que hace segura la cola: si el envío se corta a mitad de camino y el
 * item vuelve a la cola, el reintento lleva la misma clave y el backend
 * reconoce que ya lo registró (§5.0). Generándola al enviar, un timeout dudoso
 * se convertiría en dos ingresos.
 */
export interface QueuedRequest {
  id: string;
  path: string;
  body: unknown;
  idempotencyKey: string;
  queuedAt: string;
  /** Cuántas veces se intentó. Sirve para no reintentar para siempre. */
  attempts: number;
}

export interface OfflineQueueStorage {
  read(): QueuedRequest[];
  write(items: readonly QueuedRequest[]): void;
}

export interface OfflineQueueOptions {
  storage: OfflineQueueStorage;
  /** Manda un item. Debe rechazar si no salió. */
  send(item: QueuedRequest): Promise<unknown>;
  now(): string;
  newId?: () => string;
  /** Después de esto, el item se descarta y se reporta. */
  maxAttempts?: number;
  onDropped?: (item: QueuedRequest, reason: 'rejected' | 'exhausted') => void;
}

export interface FlushResult {
  sent: number;
  /** Los que siguen en la cola porque todavía no hay red. */
  pending: number;
  /** Los que se descartaron: el backend los rechazó o se agotaron los intentos. */
  dropped: number;
}

export interface OfflineQueue {
  enqueue(request: { path: string; body: unknown }): QueuedRequest;
  pending(): QueuedRequest[];
  flush(): Promise<FlushResult>;
}

const DEFAULT_MAX_ATTEMPTS = 5;

export function createOfflineQueue({
  storage,
  send,
  now,
  newId = () => globalThis.crypto.randomUUID(),
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  onDropped,
}: OfflineQueueOptions): OfflineQueue {
  return {
    enqueue(request) {
      const item: QueuedRequest = {
        id: newId(),
        path: request.path,
        body: request.body,
        // Se fija acá y no en el envío: es lo que hace que el reintento sea el
        // mismo pedido y no uno nuevo.
        idempotencyKey: newId(),
        queuedAt: now(),
        attempts: 0,
      };

      storage.write([...storage.read(), item]);

      return item;
    },

    pending() {
      return storage.read();
    },

    /**
     * Manda lo que haya, **en orden**. Un fallo de red detiene la pasada: si el
     * segundo no sale, el tercero tampoco va a salir, y seguir intentando solo
     * gasta batería y desordena la cola.
     */
    async flush() {
      const cola = storage.read();
      const quedan: QueuedRequest[] = [];
      let sent = 0;
      let dropped = 0;

      for (const [indice, item] of cola.entries()) {
        try {
          await send(item);
          sent += 1;
        } catch (error) {
          /*
           * Un 4xx no se reintenta: el pedido está mal o la ventana ya cerró, y
           * mandarlo mil veces no lo va a arreglar. Se reporta para que el
           * mostrador lo resuelva a mano.
           */
          if (error instanceof ApiRequestError && error.status < 500) {
            dropped += 1;
            onDropped?.(item, 'rejected');
            continue;
          }

          const intentado = { ...item, attempts: item.attempts + 1 };
          if (intentado.attempts >= maxAttempts) {
            dropped += 1;
            onDropped?.(intentado, 'exhausted');
          } else {
            quedan.push(intentado);
          }

          // Sin red, el resto de la cola tampoco va a salir.
          quedan.push(...cola.slice(indice + 1));
          break;
        }
      }

      storage.write(quedan);

      return { sent, pending: quedan.length, dropped };
    },
  };
}

/**
 * La cola en `localStorage`. Es lo que sobrevive a que alguien recargue la
 * tablet o la apague: una cola en memoria pierde los check-ins que justamente
 * está guardando.
 */
export function localStorageQueue(key = 'laplace.offline-queue'): OfflineQueueStorage {
  return {
    read() {
      try {
        const crudo = globalThis.localStorage?.getItem(key);

        return crudo ? (JSON.parse(crudo) as QueuedRequest[]) : [];
      } catch {
        // Un storage corrupto no puede dejar la puerta sin funcionar.
        return [];
      }
    },
    write(items) {
      try {
        globalThis.localStorage?.setItem(key, JSON.stringify(items));
      } catch {
        // Sin espacio no hay cola, pero el check-in en línea sigue andando.
      }
    },
  };
}

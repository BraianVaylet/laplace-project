import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../api/client.js';
import {
  createOfflineQueue,
  localStorageQueue,
  type OfflineQueueStorage,
  type QueuedRequest,
} from './offline-queue.js';

/**
 * La cola del kiosko (§2.1.18). La tablet de la puerta es el peor lugar del
 * gimnasio para depender del WiFi, y cuando se cae hay gente esperando.
 *
 * Lo que se protege acá es que un corte no se convierta en dos ingresos ni en
 * uno perdido.
 */
function memoria(inicial: QueuedRequest[] = []): OfflineQueueStorage {
  let items = [...inicial];

  return {
    read: () => [...items],
    write: (nuevos) => {
      items = [...nuevos];
    },
  };
}

let contador = 0;
const armar = (send: (item: QueuedRequest) => Promise<unknown>, storage = memoria()) =>
  createOfflineQueue({
    storage,
    send,
    now: () => '2026-03-03T09:45:00Z',
    newId: () => `id-${++contador}`,
  });

const errorDeApi = (status: number) =>
  new ApiRequestError({
    code: 'LP-ATTD-422-002',
    status,
    message: 'El check-in de esta clase cerró.',
    requestId: 'req-1',
    timestamp: '2026-03-03T09:45:00Z',
  });

describe('encolar', () => {
  it('guarda el pedido con su clave de idempotencia', () => {
    const cola = armar(() => Promise.resolve());

    const item = cola.enqueue({ path: '/bookings/bkg_1/check-in', body: { method: 'kiosk' } });

    expect(item.idempotencyKey).toBeTruthy();
    expect(cola.pending()).toHaveLength(1);
  });

  it('🔴 la clave se fija al encolar, no al enviar', async () => {
    const enviados: string[] = [];
    let falla = true;
    const cola = armar((item) => {
      enviados.push(item.idempotencyKey);
      if (falla) {
        falla = false;

        return Promise.reject(new Error('sin red'));
      }

      return Promise.resolve();
    });
    cola.enqueue({ path: '/bookings/bkg_1/check-in', body: {} });

    await cola.flush();
    await cola.flush();

    /*
     * El primer envío se cortó y el segundo es el reintento del MISMO pedido:
     * con dos claves distintas, el backend registraría dos ingresos y el socio
     * gastaría dos veces (§5.0).
     */
    expect(enviados).toHaveLength(2);
    expect(enviados[0]).toBe(enviados[1]);
  });

  it('sobrevive a que alguien recargue la tablet', () => {
    const storage = memoria();
    armar(() => Promise.resolve(), storage).enqueue({ path: '/uno', body: {} });

    // Otra instancia de la cola, como después de un refresh.
    const despues = armar(() => Promise.resolve(), storage);

    expect(despues.pending()).toHaveLength(1);
  });
});

describe('sincronizar al volver la red', () => {
  it('manda lo que había y deja la cola vacía', async () => {
    const send = vi.fn(() => Promise.resolve());
    const cola = armar(send);
    cola.enqueue({ path: '/uno', body: {} });
    cola.enqueue({ path: '/dos', body: {} });

    const resultado = await cola.flush();

    expect(resultado).toEqual({ sent: 2, pending: 0, dropped: 0 });
    expect(cola.pending()).toEqual([]);
  });

  it('manda en orden de llegada: el primero que entró es el primero que entra', async () => {
    const rutas: string[] = [];
    const cola = armar((item) => {
      rutas.push(item.path);

      return Promise.resolve();
    });
    cola.enqueue({ path: '/primero', body: {} });
    cola.enqueue({ path: '/segundo', body: {} });

    await cola.flush();

    expect(rutas).toEqual(['/primero', '/segundo']);
  });

  it('si sigue sin red, no pierde nada y corta la pasada', async () => {
    const send = vi.fn(() => Promise.reject(new Error('sin red')));
    const cola = armar(send);
    cola.enqueue({ path: '/uno', body: {} });
    cola.enqueue({ path: '/dos', body: {} });

    const resultado = await cola.flush();

    // El segundo no se intenta: si el primero no salió, el segundo tampoco va a
    // salir, y seguir gasta batería.
    expect(send).toHaveBeenCalledTimes(1);
    expect(resultado.pending).toBe(2);
    expect(cola.pending().map((item) => item.path)).toEqual(['/uno', '/dos']);
  });

  it('lo que el backend rechaza no se reintenta para siempre', async () => {
    const descartados: string[] = [];
    const cola = createOfflineQueue({
      storage: memoria(),
      send: () => Promise.reject(errorDeApi(422)),
      now: () => '2026-03-03T09:45:00Z',
      newId: () => `id-${++contador}`,
      onDropped: (item, reason) => descartados.push(`${item.path}:${reason}`),
    });
    cola.enqueue({ path: '/tarde', body: {} });

    const resultado = await cola.flush();

    // La ventana ya cerró: mandarlo mil veces no lo va a arreglar, y el
    // mostrador tiene que enterarse.
    expect(resultado.dropped).toBe(1);
    expect(cola.pending()).toEqual([]);
    expect(descartados).toEqual(['/tarde:rejected']);
  });

  it('un 500 sí se reintenta: el problema es del servidor, no del pedido', async () => {
    const cola = armar(() => Promise.reject(errorDeApi(500)));
    cola.enqueue({ path: '/uno', body: {} });

    await cola.flush();

    expect(cola.pending()).toHaveLength(1);
    expect(cola.pending()[0]?.attempts).toBe(1);
  });

  it('después de N intentos lo suelta y lo reporta', async () => {
    const descartados: string[] = [];
    const cola = createOfflineQueue({
      storage: memoria(),
      send: () => Promise.reject(new Error('sin red')),
      now: () => '2026-03-03T09:45:00Z',
      newId: () => `id-${++contador}`,
      maxAttempts: 2,
      onDropped: (item, reason) => descartados.push(`${item.path}:${reason}`),
    });
    cola.enqueue({ path: '/uno', body: {} });

    await cola.flush();
    await cola.flush();

    // Una cola que reintenta para siempre crece sola y esconde el problema.
    expect(cola.pending()).toEqual([]);
    expect(descartados).toEqual(['/uno:exhausted']);
  });
});

describe('la cola en `localStorage`', () => {
  it('lee vacío cuando no hay nada guardado', () => {
    const storage = localStorageQueue('laplace.test.queue');

    expect(storage.read()).toEqual([]);
  });

  it('un storage corrupto no deja la puerta sin funcionar', () => {
    globalThis.localStorage?.setItem('laplace.test.roto', 'no-es-json');
    const storage = localStorageQueue('laplace.test.roto');

    expect(storage.read()).toEqual([]);
  });

  it('guarda y recupera la cola', () => {
    const storage = localStorageQueue('laplace.test.ida-y-vuelta');
    const item: QueuedRequest = {
      id: 'id-1',
      path: '/uno',
      body: { method: 'kiosk' },
      idempotencyKey: 'key-1',
      queuedAt: '2026-03-03T09:45:00Z',
      attempts: 0,
    };

    storage.write([item]);

    expect(storage.read()).toEqual([item]);
  });
});

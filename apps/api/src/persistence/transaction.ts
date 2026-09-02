import mongoose, { type ClientSession } from 'mongoose';
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Transacciones de Mongo (§5.2.4).
 *
 * Existen para las operaciones donde **dos escrituras tienen que valer o no
 * valer juntas**: cancelar una clase y devolverle el crédito a cada inscripto,
 * o crear una reserva y descontar el crédito que la paga. A medias, el socio
 * pierde una clase que pagó o el centro regala una que no cobró.
 *
 * 🔴 Requieren **replica set**, que el runbook ya declara obligatorio en Atlas.
 * Contra un standalone esto falla en runtime, no en el build — es la razón por
 * la que el harness de tests levanta un replica set.
 *
 * La sesión viaja por `AsyncLocalStorage` y no como parámetro: si hubiera que
 * pasarla a mano, cada repositorio y cada servicio en el medio tendría que
 * conocerla, y alcanzaría con que uno se la olvidara para que su escritura
 * quedara fuera de la transacción sin que nadie lo note.
 */
const storage = new AsyncLocalStorage<ClientSession>();

/** La sesión de la transacción en curso, si hay una. */
export function currentSession(): ClientSession | undefined {
  return storage.getStore();
}

/**
 * Corre `fn` dentro de una transacción. Si lanza, se revierte todo lo escrito.
 *
 * Anidar es seguro: la transacción de adentro se suma a la de afuera en vez de
 * abrir una nueva, que es lo que permite que un servicio llame a otro sin tener
 * que saber si ya está en una.
 */
export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const yaAbierta = currentSession();
  if (yaAbierta) return fn();

  const session = await mongoose.startSession();

  try {
    let resultado: T | undefined;

    await session.withTransaction(async () => {
      resultado = await storage.run(session, fn);
    });

    return resultado as T;
  } finally {
    await session.endSession();
  }
}

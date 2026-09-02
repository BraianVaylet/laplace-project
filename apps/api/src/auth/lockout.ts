import { Temporal } from '@js-temporal/polyfill';

/**
 * Bloqueo progresivo de cuenta (spec §2.1.1, §9.1). Es distinto del rate limit
 * por IP: este cuenta fallos contra **una cuenta**, para que probar claves a
 * mano desde muchas IPs tampoco sirva.
 *
 * Logica pura: el reloj entra por parametro y el almacenamiento vive afuera.
 */
export interface LockoutPolicy {
  /** Fallos que no bloquean. Equivocarse la clave una vez es normal. */
  freeAttempts: number;
  /** Segundos de bloqueo por escalon, a partir del primer fallo que bloquea. */
  schedule: readonly number[];
  /** Techo del bloqueo. Sin esto, un ataque deja al titular afuera para siempre. */
  maxBlockSeconds: number;
  /** Ventana en la que se acumulan los fallos. Fuera de ella, se empieza de cero. */
  windowSeconds: number;
}

export const DEFAULT_LOCKOUT_POLICY: LockoutPolicy = {
  freeAttempts: 5,
  schedule: [60, 300, 900, 3600],
  maxBlockSeconds: 3600,
  windowSeconds: 900,
};

export interface LockoutState {
  failures: number;
  firstFailureAt: Temporal.Instant;
  blockedUntil: Temporal.Instant | null;
}

/** Cuantos segundos bloquea el fallo numero `failures`. 0 = no bloquea. */
export function blockSecondsFor(failures: number, policy: LockoutPolicy): number {
  if (failures <= policy.freeAttempts) return 0;

  const step = failures - policy.freeAttempts - 1;
  const fromSchedule = policy.schedule[Math.min(step, policy.schedule.length - 1)] ?? 0;

  return Math.min(fromSchedule, policy.maxBlockSeconds);
}

/** Estado resultante de un intento fallido. */
export function nextFailureState(
  previous: LockoutState | null,
  now: Temporal.Instant,
  policy: LockoutPolicy,
): LockoutState {
  const withinWindow =
    previous !== null &&
    now.since(previous.firstFailureAt).total({ unit: 'seconds' }) <= policy.windowSeconds;

  const failures = withinWindow ? previous.failures + 1 : 1;
  const firstFailureAt = withinWindow ? previous.firstFailureAt : now;
  const seconds = blockSecondsFor(failures, policy);

  return {
    failures,
    firstFailureAt,
    blockedUntil: seconds > 0 ? now.add({ seconds }) : null,
  };
}

export function isBlocked(state: LockoutState | null, now: Temporal.Instant): boolean {
  if (!state?.blockedUntil) return false;
  return Temporal.Instant.compare(now, state.blockedUntil) < 0;
}

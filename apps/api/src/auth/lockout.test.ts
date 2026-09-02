import { describe, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import {
  DEFAULT_LOCKOUT_POLICY,
  blockSecondsFor,
  isBlocked,
  nextFailureState,
  type LockoutState,
} from './lockout.js';

const NOW = Temporal.Instant.from('2026-09-01T10:00:00Z');

describe('escalera de bloqueo', () => {
  const p = DEFAULT_LOCKOUT_POLICY;

  it('los primeros intentos no bloquean: equivocarse la clave una vez es normal', () => {
    for (let failures = 1; failures <= p.freeAttempts; failures++) {
      expect(blockSecondsFor(failures, p)).toBe(0);
    }
  });

  it('el primero pasado el umbral bloquea, y cada fallo posterior bloquea mas', () => {
    const escalones = [
      p.freeAttempts + 1,
      p.freeAttempts + 2,
      p.freeAttempts + 3,
      p.freeAttempts + 4,
    ].map((f) => blockSecondsFor(f, p));

    expect(escalones[0]).toBeGreaterThan(0);
    for (let i = 1; i < escalones.length; i++) {
      expect(escalones[i]).toBeGreaterThan(escalones[i - 1] as number);
    }
  });

  it('el bloqueo tiene techo: no crece para siempre', () => {
    expect(blockSecondsFor(50, p)).toBe(p.maxBlockSeconds);
    expect(blockSecondsFor(5000, p)).toBe(p.maxBlockSeconds);
  });

  it('cero fallos no bloquea', () => {
    expect(blockSecondsFor(0, p)).toBe(0);
  });
});

describe('estado tras un fallo', () => {
  it('el primer fallo arranca el contador en 1 y no bloquea', () => {
    const state = nextFailureState(null, NOW, DEFAULT_LOCKOUT_POLICY);

    expect(state.failures).toBe(1);
    expect(state.blockedUntil).toBeNull();
  });

  it('acumula fallos dentro de la ventana', () => {
    let state: LockoutState | null = null;
    for (let i = 0; i < 3; i++) {
      state = nextFailureState(state, NOW.add({ seconds: i }), DEFAULT_LOCKOUT_POLICY);
    }

    expect(state?.failures).toBe(3);
  });

  it('un fallo despues de la ventana empieza de cero: el que se equivoco hace un mes no arrastra', () => {
    const viejo: LockoutState = {
      failures: 4,
      firstFailureAt: NOW,
      blockedUntil: null,
    };
    const muchoDespues = NOW.add({ seconds: DEFAULT_LOCKOUT_POLICY.windowSeconds + 1 });

    const state = nextFailureState(viejo, muchoDespues, DEFAULT_LOCKOUT_POLICY);

    expect(state.failures).toBe(1);
    expect(state.blockedUntil).toBeNull();
  });

  it('al superar el umbral fija el momento de desbloqueo', () => {
    let state: LockoutState | null = null;
    for (let i = 0; i <= DEFAULT_LOCKOUT_POLICY.freeAttempts; i++) {
      state = nextFailureState(state, NOW, DEFAULT_LOCKOUT_POLICY);
    }

    expect(state?.blockedUntil).not.toBeNull();
    const seconds = blockSecondsFor(
      DEFAULT_LOCKOUT_POLICY.freeAttempts + 1,
      DEFAULT_LOCKOUT_POLICY,
    );
    expect(state?.blockedUntil?.epochMilliseconds).toBe(NOW.add({ seconds }).epochMilliseconds);
  });
});

describe('lectura del bloqueo', () => {
  it('sin estado no hay bloqueo', () => {
    expect(isBlocked(null, NOW)).toBe(false);
  });

  it('con el bloqueo vigente esta bloqueado', () => {
    const state: LockoutState = {
      failures: 6,
      firstFailureAt: NOW,
      blockedUntil: NOW.add({ seconds: 60 }),
    };

    expect(isBlocked(state, NOW)).toBe(true);
    expect(isBlocked(state, NOW.add({ seconds: 59 }))).toBe(true);
  });

  it('vencido el bloqueo, deja pasar', () => {
    const state: LockoutState = {
      failures: 6,
      firstFailureAt: NOW,
      blockedUntil: NOW.add({ seconds: 60 }),
    };

    expect(isBlocked(state, NOW.add({ seconds: 61 }))).toBe(false);
  });

  it('un estado con fallos pero sin bloqueo no bloquea', () => {
    const state: LockoutState = { failures: 3, firstFailureAt: NOW, blockedUntil: null };

    expect(isBlocked(state, NOW)).toBe(false);
  });
});

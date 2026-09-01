import { describe, expect, it } from 'vitest';
import { BOOKING_STATES, CONTRACT_STATES, MEMBER_STATES, ORGANIZATION_STATES } from './states.js';

describe('glosario de estados (spec §14)', () => {
  it('ningun conjunto tiene estados duplicados', () => {
    const sets = { ORGANIZATION_STATES, MEMBER_STATES, CONTRACT_STATES, BOOKING_STATES };
    for (const [name, states] of Object.entries(sets)) {
      expect(new Set(states).size, name).toBe(states.length);
    }
  });

  it('booking distingue cancelacion en termino, late cancel y no-show', () => {
    // Las tres tienen consecuencias distintas sobre el credito (ADR-001).
    expect(BOOKING_STATES).toContain('cancelled');
    expect(BOOKING_STATES).toContain('late_cancelled');
    expect(BOOKING_STATES).toContain('no_show');
  });

  it('contract contempla el freeze, que devuelve las reservas futuras', () => {
    expect(CONTRACT_STATES).toContain('frozen');
  });
});

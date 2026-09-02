import { describe, expect, it } from 'vitest';
import { PLANS, STAFF_SUBROLES, USER_ROLES } from './roles.js';

/** Los cuatro tipos de usuario y los sub-roles de staff del §1.1. */
describe('roles', () => {
  it('estan los cuatro tipos de usuario de la spec', () => {
    expect(USER_ROLES).toEqual(['super_admin', 'suscriptor_manager', 'suscriptor_staff', 'member']);
  });

  it('estan los cuatro sub-roles de staff', () => {
    expect(STAFF_SUBROLES).toEqual(['coach', 'front_desk', 'head_coach', 'manager_assistant']);
  });

  it('los planes son Basic, Pro y Max', () => {
    expect(PLANS).toEqual(['basic', 'pro', 'max']);
  });

  it('no hay nombres repetidos entre roles ni entre sub-roles', () => {
    expect(new Set(USER_ROLES).size).toBe(USER_ROLES.length);
    expect(new Set(STAFF_SUBROLES).size).toBe(STAFF_SUBROLES.length);
  });

  it('un sub-rol de staff no es tambien un tipo de usuario: son dos ejes distintos', () => {
    for (const subrole of STAFF_SUBROLES) {
      expect(USER_ROLES as readonly string[]).not.toContain(subrole);
    }
  });
});

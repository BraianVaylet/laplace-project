/** Tipos de usuario y sub-roles de staff. Spec §1.1. */

export const USER_ROLES = [
  'super_admin',
  'suscriptor_manager',
  'suscriptor_staff',
  'member',
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const STAFF_SUBROLES = ['coach', 'front_desk', 'head_coach', 'manager_assistant'] as const;
export type StaffSubrole = (typeof STAFF_SUBROLES)[number];

export const PLANS = ['basic', 'pro', 'max'] as const;
export type Plan = (typeof PLANS)[number];

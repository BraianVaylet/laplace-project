/**
 * Glosario de estados. Spec §14.
 * Regla: los estados se cambian SOLO mediante transiciones explicitas y
 * validadas (maquina de estados), nunca con un update libre del campo.
 */

export const ORGANIZATION_STATES = [
  'trial',
  'active',
  'past_due',
  'suspended',
  'cancelled',
  'blocked',
] as const;

export const MEMBER_STATES = [
  'lead',
  'trial',
  'active',
  'at_risk',
  'inactive',
  'archived',
] as const;

export const CONTRACT_STATES = [
  'pending_payment',
  'active',
  'frozen',
  'expired',
  'exhausted',
  'cancelled',
] as const;

export const BOOKING_STATES = [
  'booked',
  'waitlisted',
  'checked_in',
  'cancelled',
  'late_cancelled',
  'no_show',
] as const;

export const CLASS_SESSION_STATES = [
  'draft',
  'scheduled',
  'in_progress',
  'completed',
  'cancelled',
] as const;

export const PAYMENT_STATES = [
  'pending',
  'approved',
  'rejected',
  'refunded',
  'chargeback',
] as const;

export const CHARGE_STATES = ['pending', 'paid', 'overdue', 'void'] as const;

export const LEAD_STATES = [
  'new',
  'contacted',
  'trial_scheduled',
  'trial_attended',
  'converted',
  'lost',
] as const;

export const PLANNING_STATES = ['draft', 'scheduled', 'published', 'archived'] as const;

export type OrganizationState = (typeof ORGANIZATION_STATES)[number];
export type MemberState = (typeof MEMBER_STATES)[number];
export type ContractState = (typeof CONTRACT_STATES)[number];
export type BookingState = (typeof BOOKING_STATES)[number];
export type ClassSessionState = (typeof CLASS_SESSION_STATES)[number];
export type PaymentState = (typeof PAYMENT_STATES)[number];
export type ChargeState = (typeof CHARGE_STATES)[number];
export type LeadState = (typeof LEAD_STATES)[number];
export type PlanningState = (typeof PLANNING_STATES)[number];

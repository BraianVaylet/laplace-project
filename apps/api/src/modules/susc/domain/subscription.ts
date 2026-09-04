import { Temporal } from '@js-temporal/polyfill';
import {
  PLAN_RANK,
  SUBSCRIBER_TRANSITIONS,
  TRIAL_DAYS,
  type SubscriberStatus,
  type SubscriptionPlanId,
} from '@laplace/schemas';
import { AppError } from '../../../http/errors.js';

/**
 * Las reglas del ciclo de vida del suscriptor (§2.1.3, §2.1.4).
 *
 * Puras y acá porque son las que deciden si alguien puede seguir usando el
 * producto y cuánto paga. Ninguna de las dos cosas puede depender de en qué
 * orden corrió un job ni de qué hora es en el servidor.
 */

/** §14: el estado cambia solo por transición explícita y validada. */
export function assertTransition(from: SubscriberStatus, to: SubscriberStatus): void {
  if (SUBSCRIBER_TRANSITIONS[from].includes(to)) return;

  throw new AppError({
    code: 'LP-SUSC-422-001',
    status: 422,
    message: `No se puede pasar de ${from} a ${to}.`,
    meta: { from, to },
  });
}

export function canTransition(from: SubscriberStatus, to: SubscriberStatus): boolean {
  return SUBSCRIBER_TRANSITIONS[from].includes(to);
}

/**
 * Cuándo se termina el trial: catorce días **en el calendario del centro**
 * (ADR-004), a la medianoche.
 *
 * En hora local y no sumando 14×24 horas: quien se registra el 1 de marzo a las
 * 23:50 tiene catorce días completos, no trece y diez minutos. Y si en el medio
 * hay cambio de hora, sigue siendo el mismo día del calendario.
 */
export function trialEndsAt(
  now: Temporal.Instant,
  timeZone: string,
  days = TRIAL_DAYS,
): Temporal.Instant {
  return now.toZonedDateTimeISO(timeZone).startOfDay().add({ days }).toInstant();
}

/** ¿Se le venció el trial? El borde exacto cuenta como vencido. */
export function isTrialOver(trialEnd: Temporal.Instant, now: Temporal.Instant): boolean {
  return Temporal.Instant.compare(now, trialEnd) >= 0;
}

export type PlanChangeKind = 'upgrade' | 'downgrade' | 'same';

export function planChangeKindOf(from: SubscriptionPlanId, to: SubscriptionPlanId): PlanChangeKind {
  if (PLAN_RANK[to] === PLAN_RANK[from]) return 'same';

  return PLAN_RANK[to] > PLAN_RANK[from] ? 'upgrade' : 'downgrade';
}

/**
 * 🔴 Lo que se cobra al subir de plan a mitad de ciclo (§2.1.4).
 *
 * Se cobra la **diferencia por lo que queda**, no el plan entero: quien pagó
 * Pro el día 1 y sube a Max el día 20 de un ciclo de 30 no tiene que pagar Max
 * completo — ya pagó veinte días de Pro.
 *
 * Se prorratea por días y no por segundos: es lo que alguien puede verificar
 * mirando un calendario, y la diferencia con el cálculo exacto es de centavos.
 */
export function prorate(input: {
  fromPriceCents: number;
  toPriceCents: number;
  now: Temporal.Instant;
  periodEndsAt: Temporal.Instant;
  timeZone: string;
}): number {
  const diferencia = input.toPriceCents - input.fromPriceCents;
  // Bajar de plan no devuelve plata a mitad de ciclo: baja al terminar.
  if (diferencia <= 0) return 0;

  const hoy = input.now.toZonedDateTimeISO(input.timeZone).toPlainDate();
  const fin = input.periodEndsAt.toZonedDateTimeISO(input.timeZone).toPlainDate();
  const restantes = hoy.until(fin).days;
  if (restantes <= 0) return 0;

  // Con más días restantes que el ciclo (un período largo), se cobra la
  // diferencia entera: nunca más que eso.
  return Math.round((diferencia * Math.min(restantes, DAYS_IN_CYCLE)) / DAYS_IN_CYCLE);
}

/** Un ciclo es un mes de treinta días: es como se cobra un SaaS mensual. */
export const DAYS_IN_CYCLE = 30;

/** Cuándo termina el ciclo que arranca ahora. */
export function periodEndsAt(now: Temporal.Instant, timeZone: string): Temporal.Instant {
  return now.toZonedDateTimeISO(timeZone).startOfDay().add({ days: DAYS_IN_CYCLE }).toInstant();
}

export interface UsageAgainstLimits {
  venues: number;
  activeMembers: number;
  staffUsers: number;
}

export interface PlanLimitsView {
  venues: number | null;
  activeMembers: number | null;
  staffUsers: number | null;
}

/**
 * 🔴 Antes de bajar de plan, ¿entra lo que ya tiene?
 *
 * §2.1.4 lo pide explícito: quien tiene 120 socios y quiere bajar a Basic (60)
 * no puede, y hay que decirle **exactamente qué excede** — "no podés bajar" a
 * secas lo deja adivinando qué borrar.
 */
export function assertFitsInPlan(
  planId: SubscriptionPlanId,
  usage: UsageAgainstLimits,
  limits: PlanLimitsView,
): void {
  const excesos = (
    [
      ['sedes', usage.venues, limits.venues],
      ['socios activos', usage.activeMembers, limits.activeMembers],
      ['usuarios de staff', usage.staffUsers, limits.staffUsers],
    ] as const
  )
    .filter(([, usado, tope]) => tope !== null && usado > tope)
    .map(([que, usado, tope]) => `${que}: tenés ${usado} y ${planId} permite ${String(tope)}`);

  if (excesos.length === 0) return;

  throw new AppError({
    code: 'LP-SUBS-422-001',
    status: 422,
    message: `No se puede cambiar al plan ${planId}: ${excesos.join(' · ')}.`,
    action: 'Bajá lo que sobra y volvé a intentar, o quedate en tu plan actual.',
    meta: { planId, excesos },
  });
}

/**
 * El dígito verificador del CUIT. Se valida porque un CUIT mal tipeado no se
 * nota hasta que hay que emitir el comprobante, que es tarde.
 */
export function isValidCuit(cuit: string): boolean {
  if (!/^\d{11}$/.test(cuit)) return false;

  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const digitos = [...cuit].map(Number);
  const suma = pesos.reduce((total, peso, indice) => total + peso * (digitos[indice] as number), 0);
  const resto = 11 - (suma % 11);
  const verificador = resto === 11 ? 0 : resto === 10 ? 9 : resto;

  return verificador === digitos[10];
}

export function assertValidCuit(cuit: string): void {
  if (isValidCuit(cuit)) return;

  throw new AppError({
    code: 'LP-SUSC-422-001',
    status: 422,
    message: 'El CUIT no es válido: revisá los números.',
    meta: { cuit },
  });
}

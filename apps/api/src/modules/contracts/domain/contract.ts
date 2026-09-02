import { Temporal } from '@js-temporal/polyfill';
import {
  CONTRACT_TRANSITIONS,
  consumesCredits,
  type ContractStatus,
  type ProductType,
  type TimeRange,
} from '@laplace/schemas';
import { AppError } from '../../../http/errors.js';

/**
 * El contrato: la instancia comprada por un socio.
 *
 * Acá vive la regla más delicada del producto — el orden de consumo cuando hay
 * varios contratos activos (§2.1.9) — y tiene que ser **determinista y
 * explicable al socio**, no "el que salga primero de la base".
 *
 * Reglas puras, sin Mongoose ni Hono.
 */
export interface ConsumableContract {
  publicId: string;
  productName: string;
  productType: ProductType;
  status: ContractStatus;
  creditsTotal: number;
  creditsUsed: number;
  /** Vacío = todas las categorías. */
  allowedCategories: string[];
  /** Vacío = todo el día. */
  allowedTimeRanges: TimeRange[];
  startsAt: Temporal.Instant;
  /** `null` en una membresía sin vencimiento. */
  endsAt: Temporal.Instant | null;
  createdAt: Temporal.Instant;
}

/** Contra qué clase se evalúa el contrato. */
export interface UsageContext {
  category?: string | undefined;
  /** Hora local de la clase en la zona del Venue, `HH:mm`. */
  startsAtLocal?: string | undefined;
}

/** §14: los estados cambian solo por transición explícita y validada. */
export function canTransition(from: ContractStatus, to: ContractStatus): boolean {
  return CONTRACT_TRANSITIONS[from].includes(to);
}

/**
 * ¿Le queda algo para consumir? Una membresía no lleva créditos: su validez la
 * resuelve la vigencia, así que mientras esté vigente siempre alcanza.
 */
export function hasCreditsLeft(contract: ConsumableContract): boolean {
  if (!consumesCredits(contract.productType)) return true;

  return contract.creditsUsed < contract.creditsTotal;
}

/**
 * Todo lo que tiene que cumplirse para usar este contrato en esta clase. Cada
 * motivo tiene su código: "no podés reservar" a secas obliga al socio a
 * preguntar por qué.
 */
export function assertUsable(
  contract: ConsumableContract,
  now: Temporal.Instant,
  context: UsageContext = {},
): void {
  if (contract.status !== 'active') {
    throw new AppError({
      code: 'LP-CTRT-422-004',
      status: 422,
      message:
        contract.status === 'frozen'
          ? `"${contract.productName}" está congelado.`
          : `"${contract.productName}" no está activo.`,
      ...(contract.status === 'frozen' ? { action: 'Descongelalo desde el mostrador.' } : {}),
      meta: { contractId: contract.publicId, status: contract.status },
    });
  }

  if (Temporal.Instant.compare(contract.startsAt, now) > 0) {
    throw new AppError({
      code: 'LP-CTRT-402-002',
      status: 402,
      message: `"${contract.productName}" arranca el ${dateOf(contract.startsAt)}.`,
      meta: { contractId: contract.publicId },
    });
  }

  if (contract.endsAt !== null && Temporal.Instant.compare(contract.endsAt, now) <= 0) {
    throw new AppError({
      code: 'LP-CTRT-402-002',
      status: 402,
      // La fecha va en el mensaje: sin ella el socio tiene que preguntar cuál.
      message: `Tu pack venció el ${dateOf(contract.endsAt)}.`,
      action: 'Comprá uno nuevo desde la app o en el mostrador.',
      meta: { contractId: contract.publicId, endsAt: contract.endsAt.toString() },
    });
  }

  if (!hasCreditsLeft(contract)) {
    throw new AppError({
      code: 'LP-CTRT-402-001',
      status: 402,
      message: 'No te quedan clases en tu pack.',
      action: 'Comprá uno nuevo desde la app o en el mostrador.',
      meta: { contractId: contract.publicId },
    });
  }

  if (!coversCategory(contract, context.category)) {
    throw new AppError({
      code: 'LP-CTRT-422-003',
      status: 422,
      message: 'Tu pack no incluye esta actividad.',
      meta: { contractId: contract.publicId, category: context.category },
    });
  }

  if (!coversTime(contract, context.startsAtLocal)) {
    throw new AppError({
      code: 'LP-CTRT-422-003',
      status: 422,
      message: 'Tu pack no incluye esta franja horaria.',
      meta: { contractId: contract.publicId, startsAtLocal: context.startsAtLocal },
    });
  }
}

/**
 * Los contratos que sirven para esta clase, **en el orden en que hay que
 * gastarlos** (§2.1.9):
 *
 * 1. El que vence primero. Es el que se pierde si no se usa.
 * 2. Entre iguales, el de categoría más específica: gastar el que solo sirve
 *    para funcional deja el general disponible para cualquier otra clase.
 * 3. Entre iguales, el más viejo. No aporta nada al negocio, pero hace que el
 *    orden sea determinista, que es lo que permite explicárselo al socio.
 *
 * Devuelve la lista completa y no solo el primero: si el elegido pierde la
 * carrera por su último crédito, quien llama intenta con el siguiente sin
 * volver a consultar la base.
 */
export function pickContract(
  contracts: readonly ConsumableContract[],
  now: Temporal.Instant,
  context: UsageContext = {},
): ConsumableContract[] {
  return contracts
    .filter((contract) => isEligible(contract, now, context))
    .sort((a, b) => byExpiry(a, b) || bySpecificity(a, b) || byAge(a, b));
}

function isEligible(
  contract: ConsumableContract,
  now: Temporal.Instant,
  context: UsageContext,
): boolean {
  try {
    assertUsable(contract, now, context);
    return true;
  } catch {
    // Filtrar y explicar son dos trabajos distintos: acá solo interesa si sirve.
    return false;
  }
}

/** El que no vence va último: se usa cuando ya no queda nada por vencer. */
function byExpiry(a: ConsumableContract, b: ConsumableContract): number {
  if (a.endsAt === null && b.endsAt === null) return 0;
  if (a.endsAt === null) return 1;
  if (b.endsAt === null) return -1;

  return Temporal.Instant.compare(a.endsAt, b.endsAt);
}

/** Menos categorías habilitadas = más específico. Vacío es "todas", o sea el menos específico. */
function bySpecificity(a: ConsumableContract, b: ConsumableContract): number {
  return specificity(a) - specificity(b);
}

const specificity = (contract: ConsumableContract): number =>
  contract.allowedCategories.length === 0
    ? Number.MAX_SAFE_INTEGER
    : contract.allowedCategories.length;

function byAge(a: ConsumableContract, b: ConsumableContract): number {
  return Temporal.Instant.compare(a.createdAt, b.createdAt);
}

function coversCategory(contract: ConsumableContract, category: string | undefined): boolean {
  if (contract.allowedCategories.length === 0 || category === undefined) return true;

  return contract.allowedCategories.includes(category);
}

function coversTime(contract: ConsumableContract, startsAtLocal: string | undefined): boolean {
  if (contract.allowedTimeRanges.length === 0 || startsAtLocal === undefined) return true;

  return contract.allowedTimeRanges.some(
    (range) => startsAtLocal >= range.from && startsAtLocal < range.to,
  );
}

/** `YYYY-MM-DD` en UTC. Alcanza para el mensaje; el cálculo de negocio usa la TZ del Venue. */
function dateOf(instant: Temporal.Instant): string {
  return instant.toZonedDateTimeISO('UTC').toPlainDate().toString();
}

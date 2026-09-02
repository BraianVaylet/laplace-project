import { z } from 'zod';
import { currencySchema } from '../venues/index.js';
import { productTypeSchema, timeRangeSchema } from '../products/index.js';

/**
 * Fuente única de validación de Contracts, compartida front/back (ADR-003).
 *
 * El contrato es la instancia comprada por un socio. Acá vive la regla más
 * delicada del producto: el orden de consumo cuando hay varios activos (§2.1.9).
 */

/** §14. `pending_payment` es el estado en el que nace una venta sin cobrar. */
export const CONTRACT_STATES = [
  'pending_payment',
  'active',
  'frozen',
  'expired',
  'exhausted',
  'cancelled',
] as const;

export const contractStatusSchema = z.enum(CONTRACT_STATES);
export type ContractStatus = z.infer<typeof contractStatusSchema>;

/**
 * Transiciones válidas (§14).
 *
 * `expired`, `exhausted` y `cancelled` son terminales: un contrato que se agotó
 * no "revive". La renovación crea un contrato nuevo, que es lo que permite que
 * el histórico de lo cobrado siga siendo legible.
 */
export const CONTRACT_TRANSITIONS: Record<ContractStatus, readonly ContractStatus[]> = {
  pending_payment: ['active', 'cancelled'],
  active: ['frozen', 'expired', 'exhausted', 'cancelled'],
  frozen: ['active', 'expired', 'cancelled'],
  expired: [],
  exhausted: [],
  cancelled: [],
};

export const sellContractSchema = z.object({
  memberId: z.string().min(1, 'Elegí el socio.'),
  productId: z.string().min(1, 'Elegí el producto.'),
  venueId: z.string().min(1, 'Elegí la sede.'),
  /**
   * Desde cuándo vale. Sin valor, arranca hoy en la zona del Venue. Sirve para
   * vender por adelantado: el socio paga el 28 la cuota que arranca el 1.
   */
  startsAt: z.string().datetime({ offset: true }).optional(),
  /**
   * Precio realmente cobrado, si difiere del de lista (promo, ajuste puntual).
   * Sin valor, se toma el del producto.
   */
  priceCents: z.number().int().min(0).optional(),
});

export type SellContractInput = z.infer<typeof sellContractSchema>;

/** Ajuste manual de créditos del staff. El motivo es obligatorio (§2.1.9). */
export const adjustCreditsSchema = z.object({
  /** Positivo agrega créditos, negativo los quita. */
  delta: z
    .number()
    .int('Los créditos son enteros.')
    .refine((value) => value !== 0, 'El ajuste tiene que cambiar algo.')
    .refine((value) => Math.abs(value) <= 500, 'El ajuste es demasiado grande.'),
  /** Queda en el AuditLog. Un ajuste sin motivo es indistinguible de un error. */
  reason: z.string().trim().min(5, 'Escribí el motivo del ajuste.').max(300),
});

export type AdjustCreditsInput = z.infer<typeof adjustCreditsSchema>;

export const contractSchema = z.object({
  publicId: z.string(),
  memberId: z.string(),
  productId: z.string(),
  venueId: z.string(),
  /** Copia del producto al vender: el producto puede cambiar, el contrato no. */
  productType: productTypeSchema,
  productName: z.string(),
  priceSnapshotCents: z.number().int(),
  currency: currencySchema,
  creditsTotal: z.number().int(),
  creditsUsed: z.number().int(),
  allowedCategories: z.array(z.string()),
  allowedTimeRanges: z.array(timeRangeSchema),
  weeklyLimit: z.number().int().optional(),
  monthlyLimit: z.number().int().optional(),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  status: contractStatusSchema,
  autoRenew: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Contract = z.infer<typeof contractSchema>;

/** Lo que la WAFM le muestra al socio cuando reserva: de qué pack salió el crédito. */
export const consumptionSchema = z.object({
  contractId: z.string(),
  productName: z.string(),
  creditsLeft: z.number().int().nullable(),
  /** Por qué se eligió este contrato y no otro. §2.1.9: tiene que ser explicable. */
  reason: z.string(),
});

export type Consumption = z.infer<typeof consumptionSchema>;

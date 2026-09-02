import { z } from 'zod';
import { currencySchema, timeOfDaySchema } from '../venues/index.js';

/**
 * Fuente única de validación de Products, compartida front/back (ADR-003).
 *
 * El catálogo vendible (§2.1.17). Absorbe y generaliza a Packs: modelar solo
 * packs deja afuera al gimnasio y al estudio de pilates, que trabajan con cuota
 * mensual.
 */

/** Los siete de §2.1.17. La venta física (`product`) queda fuera del MVP. */
export const PRODUCT_TYPES = [
  'class_pack',
  'membership_unlimited',
  'membership_limited',
  'drop_in',
  'trial',
  'personal_training',
  'event',
] as const;

export const productTypeSchema = z.enum(PRODUCT_TYPES);
export type ProductType = z.infer<typeof productTypeSchema>;

/** Franja horaria del día en la que el producto habilita reservar. */
export const timeRangeSchema = z
  .object({ from: timeOfDaySchema, to: timeOfDaySchema })
  .refine((range) => range.from < range.to, {
    message: 'El fin de la franja tiene que ser posterior al inicio.',
    path: ['to'],
  });

export type TimeRange = z.infer<typeof timeRangeSchema>;

/**
 * Precio en **centavos enteros** (§3.1). Nunca float: 60.000,50 pesos son
 * 6000050 centavos, y guardarlos como 60000.5 arrastra el error de punto
 * flotante hasta la caja del centro.
 */
export const priceCentsSchema = z
  .number()
  .int('El precio se guarda en centavos enteros.')
  .min(0, 'El precio no puede ser negativo.')
  .max(1_000_000_000);

const baseProductSchema = z.object({
  name: z.string().trim().min(2, 'Cargá el nombre del producto.').max(80),
  description: z.string().trim().max(500).optional(),
  type: productTypeSchema,
  priceCents: priceCentsSchema,
  currency: currencySchema.default('ARS'),
  /** Cuántas clases trae. Solo para los tipos que consumen por crédito. */
  credits: z.number().int().min(1).max(500).optional(),
  /** Cuántos días vale desde la compra. Es también el período de una membresía. */
  durationDays: z.number().int().min(1).max(3650).optional(),
  /** Tope de la membresía limitada. Uno de los dos alcanza. */
  weeklyLimit: z.number().int().min(1).max(50).optional(),
  monthlyLimit: z.number().int().min(1).max(200).optional(),
  /** Categorías de clase habilitadas. Vacío = todas, que es lo que espera el 90%. */
  allowedCategories: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  /** Franjas horarias habilitadas. Vacío = todo el día. */
  allowedTimeRanges: z.array(timeRangeSchema).max(5).default([]),
  venueIds: z.array(z.string()).min(1, 'Elegí al menos una sede.').max(20),
  visibleInApp: z.boolean().default(true),
  /** Cobra sola al vencer. Apagada por default: prenderla es cobrarle a alguien que no lo pidió. */
  autoRenew: z.boolean().default(false),
  /** Cupo máximo de ventas. Sin valor, no hay tope. */
  maxSales: z.number().int().min(1).max(100_000).optional(),
});

/**
 * Reglas por tipo. Son las que evitan que el motor de reservas tenga que
 * desambiguar contradicciones que se podían haber rechazado al crear el
 * producto: un "ilimitado" con créditos, un pack sin créditos, una prueba paga.
 */
function checkTypeRules(product: z.infer<typeof baseProductSchema>, ctx: z.RefinementCtx): void {
  const requires = (field: 'credits' | 'durationDays', message: string) => {
    if (product[field] === undefined) ctx.addIssue({ code: 'custom', message, path: [field] });
  };

  const forbids = (field: 'credits' | 'durationDays', message: string) => {
    if (product[field] !== undefined) ctx.addIssue({ code: 'custom', message, path: [field] });
  };

  switch (product.type) {
    case 'class_pack':
    case 'personal_training':
      requires('credits', 'Cargá cuántas clases trae.');
      requires('durationDays', 'Cargá en cuántos días vence.');
      break;

    case 'membership_unlimited':
      forbids('credits', 'Una membresía ilimitada no lleva créditos.');
      requires('durationDays', 'Cargá el período de la membresía, en días.');
      break;

    case 'membership_limited':
      forbids('credits', 'Una membresía limitada se topea por período, no por créditos.');
      requires('durationDays', 'Cargá el período de la membresía, en días.');
      if (product.weeklyLimit === undefined && product.monthlyLimit === undefined) {
        // Sin tope es una ilimitada con otro nombre.
        ctx.addIssue({
          code: 'custom',
          message: 'Cargá el tope semanal o el mensual.',
          path: ['weeklyLimit'],
        });
      }
      break;

    case 'drop_in':
    case 'trial':
      if (product.credits !== 1) {
        ctx.addIssue({
          code: 'custom',
          message: 'Una clase suelta vale exactamente 1 crédito.',
          path: ['credits'],
        });
      }
      // §2.1.17: la clase de prueba es gratuita. Cobrarla la convierte en un drop_in.
      if (product.type === 'trial' && product.priceCents !== 0) {
        ctx.addIssue({
          code: 'custom',
          message: 'La clase de prueba es gratuita.',
          path: ['priceCents'],
        });
      }
      break;

    case 'event':
      forbids('credits', 'Un evento se compra por inscripción, no por créditos.');
      break;
  }
}

export const createProductSchema = baseProductSchema.superRefine(checkTypeRules);
export type CreateProductInput = z.infer<typeof createProductSchema>;

/**
 * El **tipo no se edita**: cambiarlo cambiaría el significado de los contratos
 * ya vendidos, que apuntan al producto para saber cómo se consumen.
 */
export const updateProductSchema = baseProductSchema.omit({ type: true }).partial();
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const productSchema = z.object({
  publicId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  type: productTypeSchema,
  priceCents: z.number().int(),
  currency: currencySchema,
  credits: z.number().int().optional(),
  durationDays: z.number().int().optional(),
  weeklyLimit: z.number().int().optional(),
  monthlyLimit: z.number().int().optional(),
  allowedCategories: z.array(z.string()),
  allowedTimeRanges: z.array(timeRangeSchema),
  venueIds: z.array(z.string()),
  visibleInApp: z.boolean(),
  autoRenew: z.boolean(),
  maxSales: z.number().int().optional(),
  /** Cuántos se vendieron. Lo lleva Contracts (F1-08). */
  soldCount: z.number().int(),
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Product = z.infer<typeof productSchema>;

/** ¿Este tipo consume créditos al reservar? (ADR-001) */
export function consumesCredits(type: ProductType): boolean {
  return (
    type === 'class_pack' || type === 'drop_in' || type === 'trial' || type === 'personal_training'
  );
}

/** ¿Este tipo se valida por vigencia y tope de período en vez de por crédito? */
export function isMembership(type: ProductType): boolean {
  return type === 'membership_unlimited' || type === 'membership_limited';
}

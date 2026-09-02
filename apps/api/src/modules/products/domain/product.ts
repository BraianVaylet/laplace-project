import { consumesCredits, type ProductType } from '@laplace/schemas';
import { AppError } from '../../../http/errors.js';

/**
 * El catalogo vendible (§2.1.17).
 *
 * Reglas puras, sin Mongoose ni Hono.
 */
export interface SellableProduct {
  publicId: string;
  name: string;
  type: ProductType;
  priceCents: number;
  maxSales?: number | undefined;
  soldCount: number;
  active: boolean;
}

/**
 * ¿Se puede vender hoy? Cubre los tres motivos por los que un producto deja de
 * estar disponible, y los distingue: un "no se puede" sin motivo obliga al
 * mostrador a adivinar delante del socio.
 */
export function assertSellable(product: SellableProduct): void {
  if (!product.active) {
    throw new AppError({
      code: 'LP-PROD-422-001',
      status: 422,
      message: `"${product.name}" está archivado y no se vende más.`,
      action: 'Elegí otro producto del catálogo.',
      meta: { productId: product.publicId },
    });
  }

  if (product.maxSales !== undefined && product.soldCount >= product.maxSales) {
    throw new AppError({
      code: 'LP-PROD-422-001',
      status: 422,
      message: `"${product.name}" agotó su cupo de ${product.maxSales} ventas.`,
      meta: { productId: product.publicId, maxSales: product.maxSales },
    });
  }
}

/**
 * La clase de prueba es **una sola vez por persona** (§2.1.17). Es la regla que
 * evita que alguien entrene gratis para siempre encadenando pruebas.
 */
export function assertTrialAvailable(type: ProductType, alreadyUsedTrial: boolean): void {
  if (type !== 'trial' || !alreadyUsedTrial) return;

  throw new AppError({
    code: 'LP-PROD-409-002',
    status: 409,
    message: 'Ya usaste tu clase de prueba.',
    action: 'Mirá los packs y las membresías del centro.',
  });
}

/**
 * Cuantos creditos entrega una compra. Los tipos que no consumen por credito
 * devuelven 0: su validez la resuelve la vigencia, no un contador.
 */
export function creditsGranted(type: ProductType, credits: number | undefined): number {
  return consumesCredits(type) ? (credits ?? 0) : 0;
}

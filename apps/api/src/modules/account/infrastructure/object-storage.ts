import { createHmac, randomBytes } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { AppError } from '../../../http/errors.js';
import type { ObjectStorage } from '../application/ports.js';
import type { ImageType } from '../domain/image.js';

/**
 * Dónde viven las fotos de perfil.
 *
 * 🔴 En producción esto va a Backblaze B2 (§6), que todavía **no está
 * aprovisionado** — es parte de F0-16, que quedó bloqueada esperando las
 * credenciales. Mientras tanto hay una implementación en memoria que respeta
 * el mismo contrato: guarda los bytes, firma el enlace y lo vence.
 *
 * El contrato es lo que importa y es lo que ya está probado: cuando entre B2,
 * se reemplaza esta clase y ni el servicio ni los tests cambian.
 */
export const SIGNED_URL_MINUTES = 15;

interface Guardado {
  body: Uint8Array;
  contentType: ImageType;
}

/**
 * Almacenamiento en memoria, para desarrollo y tests.
 *
 * Firma de verdad — HMAC con vencimiento — porque el punto de la URL firmada no
 * es dónde están los bytes: es que el enlace **caduque**. Una URL pública
 * permanente de la foto de una persona es la que no puede existir, y eso no
 * depende del proveedor.
 */
export function createInMemoryObjectStorage(
  secret: string,
  now: () => Temporal.Instant = () => Temporal.Now.instant(),
): ObjectStorage & { read(key: string, token: string): Guardado } {
  const objetos = new Map<string, Guardado>();

  const firmar = (key: string, expiresAt: Temporal.Instant): string =>
    createHmac('sha256', secret)
      .update(`${key}:${expiresAt.epochMilliseconds}`)
      .digest('base64url');

  return {
    put({ key, body, contentType }) {
      objetos.set(key, { body, contentType });

      return Promise.resolve();
    },

    signedUrl(key) {
      const expiresAt = now().add({ minutes: SIGNED_URL_MINUTES });

      return Promise.resolve({
        url: `/api/v1/files/${encodeURIComponent(key)}?expires=${expiresAt.epochMilliseconds}&sig=${firmar(key, expiresAt)}`,
        expiresAt,
      });
    },

    remove(key) {
      objetos.delete(key);

      return Promise.resolve();
    },

    /** Lo que hace el endpoint que sirve el archivo: verificar y devolver. */
    read(key, token) {
      const [expiresRaw, firma] = token.split(':');
      const expiresAt = Temporal.Instant.fromEpochMilliseconds(Number(expiresRaw));

      if (Temporal.Instant.compare(now(), expiresAt) > 0) {
        throw new AppError({
          code: 'LP-SYS-404-002',
          status: 404,
          message: 'El enlace venció. Volvé a abrir la pantalla.',
        });
      }

      if (firma !== firmar(key, expiresAt)) {
        throw new AppError({
          code: 'LP-SYS-404-002',
          status: 404,
          message: 'No encontramos lo que buscabas.',
        });
      }

      const guardado = objetos.get(key);
      if (!guardado) {
        throw new AppError({
          code: 'LP-SYS-404-002',
          status: 404,
          message: 'No encontramos lo que buscabas.',
        });
      }

      return guardado;
    },
  };
}

/** Un secreto de firma para los entornos que no traen uno configurado. */
export function randomSigningSecret(): string {
  return randomBytes(32).toString('base64url');
}

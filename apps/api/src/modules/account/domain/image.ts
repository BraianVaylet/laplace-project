import { AppError } from '../../../http/errors.js';

/**
 * Validación de la foto de perfil (§2.1.2).
 *
 * 🔴 **El tipo se saca de los bytes, no de la extensión ni del
 * `Content-Type`.** Las dos cosas las escribe quien sube el archivo: renombrar
 * `payload.svg` a `foto.png` y declarar `image/png` no cuesta nada, y un SVG
 * servido como imagen ejecuta el script que tenga adentro contra el dominio que
 * lo sirve.
 *
 * Se leen los primeros bytes — la "firma mágica" que todo formato de imagen
 * pone al principio — y se acepta solo lo que de verdad es lo que dice ser.
 */

/** Los tres que un navegador muestra y que no ejecutan nada (§2.1.2). */
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type ImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

/** 2 MB. Una foto de perfil no necesita más, y el límite protege la cuota. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

interface Firma {
  type: ImageType;
  bytes: readonly number[];
  /** Desde qué byte arranca la firma. WebP la tiene en el 8. */
  offset?: number;
}

/**
 * Las firmas de los tres formatos. Son los bytes con los que **empieza** el
 * archivo, no algo que el cliente pueda elegir.
 */
const FIRMAS: readonly Firma[] = [
  { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  // WebP: "RIFF" ... "WEBP". Los cuatro bytes del medio son el tamaño.
  { type: 'image/webp', bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },
];

/** Qué es este archivo **de verdad**. `null` cuando no es ninguna de las tres. */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  for (const firma of FIRMAS) {
    const desde = firma.offset ?? 0;
    if (bytes.length < desde + firma.bytes.length) continue;

    const coincide = firma.bytes.every((byte, indice) => bytes[desde + indice] === byte);
    if (coincide) return firma.type;
  }

  return null;
}

/**
 * Acepta la foto o explica por qué no.
 *
 * El tamaño se chequea **antes** que el contenido: es lo más barato de
 * verificar, y con un archivo de 40 MB no vale la pena mirar ni el primer byte.
 */
export function assertUsableImage(bytes: Uint8Array): ImageType {
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new AppError({
      code: 'LP-ACCT-413-002',
      status: 413,
      message: `La imagen supera el máximo de ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB.`,
      action: 'Probá con una foto más chica o sacale calidad.',
      meta: { bytes: bytes.byteLength, max: MAX_IMAGE_BYTES },
    });
  }

  const tipo = sniffImageType(bytes);
  if (tipo) return tipo;

  throw new AppError({
    code: 'LP-ACCT-422-001',
    status: 422,
    message: 'El archivo tiene que ser una imagen JPG, PNG o WebP.',
    /*
     * El mensaje no dice "renombraste un archivo": quien sube un SVG por error
     * no está atacando a nadie, y quien sí lo está haciendo no necesita que le
     * confirmemos que lo detectamos.
     */
    action: 'Elegí una foto en alguno de esos formatos.',
  });
}

/** La extensión que le corresponde al tipo real, para nombrar el objeto. */
export function extensionOf(type: ImageType): string {
  return { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[type];
}

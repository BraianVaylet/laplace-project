import { describe, expect, it } from 'vitest';
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  assertUsableImage,
  extensionOf,
  sniffImageType,
} from './image.js';
import type { AppError } from '../../../http/errors.js';

/**
 * La foto de perfil (§2.1.2). Lo que importa acá es que el tipo salga de los
 * **bytes** y no de lo que diga quien sube el archivo: renombrar un SVG a
 * `.png` no cuesta nada, y un SVG servido como imagen ejecuta el script que
 * tenga adentro.
 */
const conFirma = (bytes: readonly number[], relleno = 32): Uint8Array =>
  new Uint8Array([...bytes, ...Array.from({ length: relleno }, () => 0)]);

const JPEG = conFirma([0xff, 0xd8, 0xff, 0xe0]);
const PNG = conFirma([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// "RIFF" + 4 bytes de tamaño + "WEBP".
const WEBP = conFirma([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

describe('el tipo real del archivo', () => {
  it('reconoce los tres formatos que el producto acepta', () => {
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(WEBP)).toBe('image/webp');
  });

  it('🔴 un SVG renombrado a .png NO pasa', () => {
    /*
     * Es el ataque concreto: `<svg onload=...>` servido como imagen ejecuta
     * script contra el dominio que lo sirve. La extensión y el `Content-Type`
     * los escribe quien sube el archivo; los bytes, no.
     */
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');

    expect(sniffImageType(svg)).toBeNull();
  });

  it('un archivo vacío o demasiado corto no es una imagen', () => {
    expect(sniffImageType(new Uint8Array())).toBeNull();
    expect(sniffImageType(new Uint8Array([0xff]))).toBeNull();
  });

  it('un PDF tampoco', () => {
    expect(sniffImageType(new TextEncoder().encode('%PDF-1.7'))).toBeNull();
  });

  it('los bytes correctos en el lugar equivocado no cuentan', () => {
    // La firma de PNG, pero desplazada: no es un PNG.
    const desplazado = new Uint8Array([0x00, 0x89, 0x50, 0x4e, 0x47]);

    expect(sniffImageType(desplazado)).toBeNull();
  });
});

describe('la validación completa', () => {
  it('acepta una imagen de verdad y dice qué es', () => {
    expect(assertUsableImage(PNG)).toBe('image/png');
  });

  it('🔴 rechaza lo que no es imagen con el código del diccionario', () => {
    try {
      assertUsableImage(new TextEncoder().encode('no soy una imagen'));
      throw new Error('tenía que fallar');
    } catch (error) {
      expect((error as AppError).code).toBe('LP-ACCT-422-001');
      expect((error as AppError).status).toBe(422);
    }
  });

  it('🔴 rechaza la que pesa de más, y el tamaño se mira primero', () => {
    // Con 3 MB de basura ni vale la pena leer el primer byte.
    const enorme = new Uint8Array(MAX_IMAGE_BYTES + 1);

    try {
      assertUsableImage(enorme);
      throw new Error('tenía que fallar');
    } catch (error) {
      expect((error as AppError).code).toBe('LP-ACCT-413-002');
      expect((error as AppError).message).toContain('MB');
    }
  });

  it('la de justo el tamaño máximo entra', () => {
    const alLimite = new Uint8Array(MAX_IMAGE_BYTES);
    alLimite.set([0xff, 0xd8, 0xff]);

    expect(assertUsableImage(alLimite)).toBe('image/jpeg');
  });
});

describe('la extensión del objeto guardado', () => {
  it('sale del tipo real, no del nombre que mandaron', () => {
    expect(extensionOf('image/jpeg')).toBe('jpg');
    expect(extensionOf('image/png')).toBe('png');
    expect(extensionOf('image/webp')).toBe('webp');
  });

  it('hay extensión para cada tipo permitido', () => {
    for (const tipo of ALLOWED_IMAGE_TYPES) {
      expect(extensionOf(tipo).length).toBeGreaterThan(0);
    }
  });
});

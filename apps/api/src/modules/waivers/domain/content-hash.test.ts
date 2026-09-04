import { describe, expect, it } from 'vitest';
import { hashContent } from './content-hash.js';

/**
 * El hash del texto de cada versión (§2.1.20): "hay que poder probar qué
 * firmó exactamente". No es una firma criptográfica sobre la identidad de la
 * persona — eso lo da el `userId` de la sesión — es una prueba de integridad
 * del texto: que el HTML que el socio aceptó es exactamente el que quedó
 * guardado.
 */
describe('el hash del contenido', () => {
  it('el mismo texto da siempre el mismo hash', () => {
    expect(hashContent('<p>Deslinde v1</p>')).toBe(hashContent('<p>Deslinde v1</p>'));
  });

  it('un cambio de una sola letra cambia el hash entero', () => {
    expect(hashContent('<p>Deslinde v1</p>')).not.toBe(hashContent('<p>Deslinde v2</p>'));
  });

  it('es hexadecimal de 64 caracteres (sha-256)', () => {
    expect(hashContent('cualquier texto')).toMatch(/^[0-9a-f]{64}$/);
  });
});

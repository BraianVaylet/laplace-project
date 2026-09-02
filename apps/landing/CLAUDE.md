# apps/landing — Landing page

React + Vite. Público, sin sesión. Reglas generales en el `CLAUDE.md` de la raíz.

## Alcance

Propuesta de valor · planes y precios (Basic / Pro / Max) · alta de trial · documentos legales
públicos (términos, privacidad).

## Particularidades

- **Trial sin tarjeta, 14 días.** Ya no es una decisión abierta: la cierra `docs/adr/004-open-decisions.md`.
- Precio en ARS. Formato es-AR de moneda y fecha.
- Es la única app indexable: cuidar metadatos, Open Graph y performance de carga.
- No consume endpoints autenticados. Lo único que postea es el alta de trial y el formulario de
  contacto, ambos con rate limiting del lado de la API.
- Los documentos legales se sirven versionados desde `LegalDocument`, no hardcodeados.

Puerto de dev: **5176**.

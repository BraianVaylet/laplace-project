# apps/wafm — Webapp for Members

React + Vite. La usan los miembros (MU). Reglas generales en el `CLAUDE.md` de la raíz.

## Alcance

Ver horario · reservar y cancelar · mis packs y créditos · mi QR de check-in · mis marcas y RMs.

## Particularidades

- **Mobile first, densidad baja**: uso de pie, con una mano, apurado. Targets ≥ 44×44 px.
- **Optimistic UI** en reservar y cancelar, con rollback y mensaje claro si falla.
- Los errores de crédito y cupo son los más frecuentes: `LP-BOOK-409-002` (clase completa, ofrecer
  waitlist), `LP-CTRT-402-001` (sin créditos), `LP-CTRT-402-002` (pack vencido). El mensaje siempre
  dice qué puede hacer el usuario.
- El `AthleteProfile` es del usuario, no del centro: se comparte por consentimiento explícito y
  revocable (ADR-000, regla 7).
- Health es **opcional por diseño**: nadie puede ser obligado a dar datos sensibles (Ley 25.326).
- Es el target de los E2E de `e2e/` (`playwright.config.ts` levanta esta app).

Puerto de dev: **5175**.

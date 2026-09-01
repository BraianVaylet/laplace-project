# Laplace — contexto del proyecto

SaaS multi-tenant de gestión de centros deportivos (es-AR). 4 apps + API.
**La spec manda:** `docs/spec/LAPLACE-SPEC.md`. Si algo queda fuera de spec, primero se actualiza
la spec, después se codea.

## Stack

TypeScript `strict` · React + Tanstack (Query/Router/Table/Form) · Tailwind v4 · Zustand (estado de
UI) · Nuqs (estado en URL) · Motion · Hono + Mongoose 8 + MongoDB Atlas · Better Auth (organization
plugin) · Zod · Temporal · Pino · Vitest + Playwright + MSW + mongodb-memory-server ·
pnpm + Turborepo · Railway + Backblaze B2.

Frontera de estado: **Query = servidor · Zustand = UI · Nuqs = filtros urleables.** Nunca duplicar
estado de servidor en Zustand.

## Estructura

```
apps/      api · dfsa (super admin) · dfsm (suscriptor) · wafm (miembros) · landing
packages/  schemas (Zod, fuente única) · ui · types · config
```

Backend = modular monolith: `apps/api/src/modules/<mod>/{domain,application,infrastructure}`.
Los módulos se comunican por interfaces o eventos de dominio, **nunca** importando el modelo de otro
módulo. Cada app tiene su propio `CLAUDE.md` con lo específico.

## Comandos

`pnpm dev` · `pnpm test` · `pnpm lint` · `pnpm typecheck` · `pnpm build` (Turborepo, desde la raíz)

## Reglas no negociables

1. **Tenant = `Organization`.** El `tenantId` sale de la sesión, nunca del body ni la query. Todo
   query pasa por un repositorio que lo inyecta; prohibido usar el modelo de Mongoose en un
   controller. `tenantId` primero en todo índice compuesto. → `docs/adr/000-tenancy.md`
2. **Errores:** código `LP-<MOD>-<HTTP>-<NNN>` + respuesta unificada
   `{ success:false, error:{ code, message, action, requestId, timestamp } }`. → `docs/errors.md`
3. **Logs:** Pino JSON con `ts, level, env, service, module, action, requestId, tenantId, venueId,
userId, durationMs, errorCode, msg, meta`. Nunca passwords, tokens, datos de salud ni de tarjeta.
4. **Validación:** Zod en `@laplace/schemas`, compartido front/back. Prohibido duplicar reglas.
5. **Estados:** solo por transición explícita y validada (máquina de estados). Nunca un `update`
   libre del campo. → spec §14
6. **API:** prefijo `/api/v1` · paginación cursor-based · `Idempotency-Key` en reservas, pagos,
   webhooks y check-in · soft delete por defecto.
7. **Idioma:** código, variables y commits en inglés. Documentación, UI y mensajes al usuario en
   español (es-AR).

## Prohibido

`any` · `console.log` · lógica de negocio en componentes React · secretos en el repo o en el front ·
importar el modelo de otro módulo · duplicar estado de servidor en Zustand · cambios manuales en
Atlas (usar `migrate-mongo`) · probar en prod · `skip` para paginar.

## Definition of Done

Completo en spec §15. Mínimo para dar algo por terminado: tests pasando con la cobertura de su
criticidad · **test de aislamiento de tenant** · Zod compartido · error tipado con código · logs
estructurados · estados vacío/carga/error · accesible (teclado, foco, contraste, labels) ·
responsive 360/768/1440 · dark y light · OpenAPI actualizado · entrada en `docs/BITACORA.md`.

## Decisiones ya tomadas — no re-litigar

- `docs/adr/000-tenancy.md` — tenant es la Organization, DB única con `tenantId`
- `docs/adr/001-credit-consumption.md` — el crédito se descuenta **al reservar**
- `docs/adr/002-payments.md` — solo suscripción, sin comisión; el dinero del miembro no pasa por Laplace
- `docs/adr/003-monorepo.md` — monorepo pnpm + Turborepo, modular monolith

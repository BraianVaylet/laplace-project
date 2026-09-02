# ADR-003 — Monorepo, arquitectura de backend e infraestructura

- **Estado:** Aceptada
- **Fecha:** 2026-08-31
- **Spec:** §6

## Contexto

El producto son 4 aplicaciones web (DFSA, DFSM, WAFM, Landing) más una API, con 22 módulos de
negocio y **un solo desarrollador**. Hay que elegir una topología de repositorio y de deploy que
permita compartir tipos y validaciones sin multiplicar el costo operativo.

## Opciones consideradas

1. **Repos separados por app.** Aísla, pero obliga a versionar y publicar los paquetes compartidos
   (`schemas`, `ui`) para cada cambio. Inviable con un dev.
2. **Monorepo pnpm + Turborepo.** Un cambio en `@laplace/schemas` se propaga a las 5 apps en el
   mismo commit y el mismo PR.
3. **Microservicios en el backend.** Descartado de plano: la carga operativa no tiene relación con
   el tamaño del equipo.

## Decisión

**Monorepo pnpm workspaces + Turborepo**, con backend **modular monolith + hexagonal-lite**.

```
apps/      api · dfsa · dfsm · wafm · landing
packages/  schemas (Zod) · ui · types · config
```

- Un solo deployable de backend, con módulos aislados en
  `apps/api/src/modules/<mod>/{domain,application,infrastructure}`.
- **Regla de dependencia:** los módulos se comunican por interfaces o eventos internos de dominio
  (`booking.created`, `payment.received`, `contract.expiring`…). **Nunca** importando el modelo de
  otro módulo. Es lo que permite extraer un módulo el día que haga falta.
- `@laplace/schemas` es la **fuente única** de validaciones y tipos (`z.infer`), compartida
  front/back. El OpenAPI se genera desde ahí, no se escribe a mano.
- `@laplace/ui`: componentes cross con Storybook, sin lógica de negocio adentro.
- `tsconfig` base con `strict: true`. Sin `any`.
- CI en GitHub Actions: `lint → typecheck → test → build` en cada PR, con quality gate de cobertura
  (≥ 80% global, 95% en Billing / Contracts / Booking / Entitlements / Auth).

**Infraestructura:** Railway (staging + prod) · MongoDB Atlas con **replica set** (requisito de las
transacciones del ADR-001) y PITR · Backblaze B2 con buckets privados y URLs firmadas de vida corta.
Ambientes `dev` / `staging` / `prod`; **prohibido probar en prod**.

## Consecuencias

- Un cambio de contrato de API es un único PR atómico que toca schema, back y front.
- Migraciones versionadas con `migrate-mongo`; **nunca** cambios manuales en Atlas.
- Secretos en el gestor de la plataforma, jamás en el repo. Rotación documentada.
- Health checks `/health` (liveness) y `/ready` (readiness con ping a Mongo).
- El backup se considera válido solo con **restore probado** (job `backupVerify` semanal).
  RPO ≤ 24 h, RTO ≤ 4 h.
- **Riesgo asumido:** el monorepo tienta a acoplar módulos porque el import "está ahí nomás". La
  regla de dependencia se verifica con lint (`no-restricted-imports` entre módulos), no con
  buena voluntad.
- Disparador para migrar a VPS/Coolify: costo o límite de recursos, no estética.

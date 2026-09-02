# apps/api — Backend

Hono + Mongoose 8 + Pino. Un solo deployable, **modular monolith**. Reglas generales en el
`CLAUDE.md` de la raíz.

## Estructura

```
src/
  app.ts              fábrica de la app Hono (testeable con app.request(), sin abrir puerto)
  index.ts            entrypoint: valida env, conecta Mongo, levanta el server
  config/env.ts       validación Zod del entorno — si falta una variable, no arranca
  http/               errors.ts (AppError + envelope) · error-handler.ts · request-id.ts
  observability/      logger.ts (Pino, formato §11.1)
  routes/             health.ts (/health liveness, /ready readiness con ping a Mongo)
  modules/<mod>/      domain/ · application/ · infrastructure/
```

## Reglas del módulo

- `domain/`: entidades, máquinas de estado, reglas puras. **Sin Mongoose, sin Hono.**
- `application/`: casos de uso. Orquestan repositorios y emiten eventos de dominio.
- `infrastructure/`: modelo de Mongoose, repositorio con inyección de `tenantId`, rutas Hono.
- Importar `domain/`, `application/` o `infrastructure/` de **otro** módulo está bloqueado por
  ESLint (`no-restricted-imports` en `eslint.config.js`). Usar interfaz pública o evento.

## Errores

Lanzar `AppError` con su código de `docs/errors.md`. El handler global arma el envelope y loguea
con `errorCode` + `requestId`. Un `catch` que solo loguea no cumple el DoD.

## Tests

`pnpm test`. Unit junto al código (`*.test.ts`), integración en `tests/`.
`tests/mongo.test.ts` levanta un **replica set** en memoria: las transacciones no existen sin él.
Todo endpoint nuevo necesita su test de aislamiento de tenant.

## Prohibido acá

Usar el modelo de Mongoose en un controller · leer `tenantId` del body o la query · `new Date()`
(usar Temporal) · paginar con `skip`.

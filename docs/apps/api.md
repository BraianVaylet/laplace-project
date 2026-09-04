# API — el backend

> Un solo deployable, monolito modular. Puerto de desarrollo: **3000**.

## Superficie

`/api/v1/*`, unas 140 rutas registradas. La documentación viva está en `/api/v1/docs`, generada
**desde el mismo registro de rutas** que usan los guards y la suite de aislamiento: no se escribe
aparte, así que no puede quedar desactualizada.

Fuera del prefijo: `/health` (vivo) y `/ready` (vivo **y** con Mongo respondiendo).

## Cómo se agrega un endpoint

1. Declarar sus códigos de error en [`errors.md`](../errors.md). Es Definition of Ready.
2. Escribir el test primero, incluido el de aislamiento de tenant.
3. Schema Zod en `@laplace/schemas` — el mismo que va a usar el front.
4. Dominio, caso de uso, infraestructura, en ese orden.
5. Registrar la ruta con su permiso, sus schemas, sus códigos de error **y su fixture de ataque**.
   Sin el fixture, el CI no compila la suite de aislamiento y falla.

## Reglas de la casa

- `domain/` **sin Mongoose y sin Hono**.
- Un controller **no toca el modelo de Mongoose**: pasa por el repositorio, que inyecta el
  `tenantId`.
- Importar `domain/`, `application/` o `infrastructure/` de **otro** módulo está bloqueado por
  ESLint. Se usa un puerto o un evento.
- `new Date()` está prohibido: Temporal, y el reloj se inyecta.
- Paginación por cursor. `skip` está prohibido.
- `Idempotency-Key` obligatoria en reservas, pagos, check-in y webhooks.
- Soft delete por defecto.

## Errores

`AppError` con su código de `docs/errors.md`. El handler global arma el envelope §5.0, loguea con
`errorCode` y `requestId`, y persiste el evento para el buscador de soporte del super admin.

Un `catch` que solo loguea no cumple el Definition of Done.

## Tests

Unitarios junto al código, integración en `tests/`, contra un **replica set en memoria**: las
transacciones no existen sin él. Todo endpoint nuevo necesita su test de aislamiento.

El gate de cobertura es por criticidad y lo aplica el CI: 95% de líneas donde hay plata, permisos o
cupos.

# Documento técnico — Laplace

> Stack, estructura, convenciones y cómo levantar el proyecto.
>
> **La prueba de que este documento sirve**: alguien que nunca vio el repo lo clona, sigue esta
> página y lo tiene corriendo sin preguntar nada. Si algo falla, el arreglo va acá, no en un
> mensaje.

---

## 1. Requisitos

| Herramienta | Versión                | Por qué                                                                         |
| ----------- | ---------------------- | ------------------------------------------------------------------------------- |
| Node        | 24 (`.nvmrc`)          | El proyecto declara `>=22`; CI corre la del `.nvmrc`                            |
| pnpm        | 11.7.0                 | Está fijado en `packageManager`. `corepack enable` lo resuelve solo             |
| MongoDB     | 7+ con **replica set** | Sin replica set no hay transacciones, y reservar sin transacción no es reservar |

MongoDB puede ser Atlas o local. Para desarrollo alcanza con un nodo en modo replica set; los tests
no necesitan nada instalado (levantan el suyo en memoria).

## 2. Levantarlo

```bash
corepack enable && pnpm install
```

```bash
cp .env.example .env
```

Completar en `.env` como mínimo `MONGODB_URI` y `BETTER_AUTH_SECRET` (32 bytes:
`openssl rand -base64 32`). La API valida el entorno al arrancar y **no levanta si falta algo**: es
preferible fallar en el deploy que a las 3 de la mañana con un `undefined`.

```bash
pnpm exec migrate-mongo up
```

```bash
pnpm dev
```

Levanta las cinco aplicaciones a la vez:

| App     | Puerto | Qué es                |
| ------- | ------ | --------------------- |
| api     | 3000   | Backend               |
| dfsa    | 5173   | Panel del super admin |
| dfsm    | 5174   | Escritorio del centro |
| wafm    | 5175   | App del socio         |
| landing | 5176   | Sitio público         |

La documentación de la API queda en `http://localhost:3000/api/v1/docs`.

## 3. Comandos

| Comando              | Qué hace                                                     |
| -------------------- | ------------------------------------------------------------ |
| `pnpm dev`           | Todas las apps en watch                                      |
| `pnpm test`          | Unitarios e integración de todos los paquetes                |
| `pnpm test:coverage` | Lo mismo, aplicando el gate de cobertura por criticidad      |
| `pnpm test:e2e`      | Los tres caminos críticos en Playwright, con su base efímera |
| `pnpm lint`          | ESLint con las reglas del proyecto                           |
| `pnpm typecheck`     | `tsc --noEmit` en todo, incluido `e2e/`                      |
| `pnpm build`         | Build de producción de las cinco apps                        |

Todo corre desde la raíz, con Turborepo.

## 4. Stack

**Backend**: TypeScript `strict` · Hono · Mongoose 8 · MongoDB · Better Auth (con el plugin de
organizaciones) · Zod · Temporal · Pino.

**Frontend**: React 19 · TanStack Query / Router / Table / Form · Tailwind v4 · Zustand · Nuqs ·
Motion · `vite-react-ssg` en la landing · PWA en la app del socio.

**Testing**: Vitest · Testing Library · `mongodb-memory-server` · Playwright.

**Tooling**: pnpm + Turborepo · ESLint + Prettier · husky + lint-staged · migrate-mongo.

## 5. Estructura

```
apps/
  api/        backend (modular monolith)
  dfsa/       panel del super admin
  dfsm/       escritorio del centro
  wafm/       app del socio
  landing/    sitio público
packages/
  schemas/    Zod — fuente única de validación, compartida front y back
  types/      tipos y máquinas de estado del dominio
  ui/         primitivas accesibles con tokens y tema
  client/     cliente de API, estado de UI, helpers de tiempo
  config/     tsconfig y eslint compartidos
e2e/          los tres caminos críticos (Playwright) y su arnés
migrations/   migrate-mongo — índices y datos de arranque
docs/         esta carpeta
```

Cada app tiene su propio `CLAUDE.md` con lo específico. La API además tiene el suyo con las reglas
del módulo.

## 6. Convenciones que no se negocian

### Idioma

**Código, variables, commits y mensajes de PR en inglés. Documentación, UI y mensajes al usuario en
español rioplatense.** Los comentarios del código van en español: explican por qué, y el por qué se
discute en el idioma en que se piensa.

### Estado en el front

- **TanStack Query** para el estado del servidor.
- **Zustand** para el estado de la UI.
- **Nuqs** para los filtros que van en la URL.

Nunca duplicar estado de servidor en Zustand.

### Fechas

**Temporal, siempre.** `new Date()` está prohibido por ESLint fuera de `src/persistence/bson-date.ts`,
que es el único lugar que traduce entre Temporal y lo que Mongo guarda. Las fechas se muestran en la
zona del **centro**, no en la del navegador.

El reloj se **inyecta** (`now: () => Temporal.Instant`): sin eso no se puede probar un vencimiento
sin esperar un mes. Y no se usa `createdAt` de Mongoose como fecha de negocio: lo escribe el reloj
de pared y ningún test puede moverlo.

### Dinero

**Centavos enteros, siempre.** Nunca decimales, en ningún punto del camino. El campo `currency`
existe desde el día uno aunque hoy solo se use ARS.

### Errores

Cada error tiene su código `LP-<MOD>-<HTTP>-<NNN>`, declarado en [errors.md](errors.md) **antes** de
escribirlo, y la respuesta es siempre la misma forma:

```json
{
  "success": false,
  "error": {
    "code": "LP-BOOK-409-002",
    "message": "Esta clase ya está completa.",
    "action": "Anotate en la lista de espera.",
    "requestId": "…",
    "timestamp": "…"
  }
}
```

`message` es lo que pasó, `action` es qué puede hacer el usuario. Un `catch` que solo loguea no
cumple el Definition of Done.

### Logs

Pino en JSON, con el mismo formato en todos lados: `ts, level, env, service, module, action,
requestId, tenantId, venueId, userId, durationMs, errorCode, msg, meta`.

**Nunca se loguean** contraseñas, tokens, datos de salud ni datos de tarjeta.

### Validación

Zod en `@laplace/schemas`, compartido entre el front y el back. **Prohibido duplicar una regla de
validación**: si está en dos lados, un día van a decir cosas distintas.

### Estados

Solo se cambian por transición explícita y validada. Nunca con un `update` libre del campo.

### API

Prefijo `/api/v1` · paginación por cursor (nunca `skip`) · `Idempotency-Key` obligatoria en
reservas, pagos, check-in y webhooks · soft delete por defecto.

## 7. Tests

```bash
pnpm test
```

Unitarios junto al código (`*.test.ts`), integración en `apps/api/tests/`. La integración levanta un
**replica set en memoria**: las transacciones no existen sin él.

**Los seis tests que no se negocian** (spec §Testing):

1. **Aislamiento de tenant**, una vez por endpoint. La suite recorre el registro de rutas: una ruta
   nueva sin su fixture de ataque rompe el CI.
2. **Concurrencia de reserva**: N pedidos simultáneos por un solo cupo dejan una sola reserva.
3. **Idempotencia** en reservas, pagos y check-in.
4. **Límite de plan**: el socio 61 en Basic falla con su código.
5. **La matriz completa de consumo de crédito**, los ocho casos.
6. **Vencimientos cruzando zona horaria y horario de verano.**

### Cobertura

El gate es por criticidad, no un número global: 95% de líneas en cobranza, contratos, reservas,
permisos y auth; 85% en asistencia y agenda; menos donde el riesgo es menor; ≥80% global. Está en
`apps/api/vitest.config.ts` y lo aplica el CI.

### E2E

```bash
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
```

Los tres caminos críticos, contra un Mongo **efímero** que se crea y se tira. Nunca contra staging
ni contra producción: los tres escriben.

## 8. Git y CI

Commits convencionales, con el scope de la lista de `commitlint.config.js`. El hook de pre-commit
corre Prettier y ESLint sobre lo que está en el stage.

El CI corre, en este orden: formato, lint, typecheck, build, tests con el gate de cobertura, los
E2E y `pnpm audit`. El build va **antes** de los tests a propósito: los tests de la landing
verifican el HTML prerenderizado, que solo existe después de buildear.

## 9. Base de datos

Los cambios de esquema y de índices van en `migrations/`, con `migrate-mongo`. **Prohibido tocar
Atlas a mano**: lo que se hizo a mano en un ambiente no existe en el otro.

Las migraciones corren **antes** del deploy y desde un solo lugar. Si las corriera el arranque del
proceso, dos instancias las correrían a la vez.

## 10. Dónde seguir

- [ARQUITECTURA.md](ARQUITECTURA.md) — tenancy, módulos, eventos y jobs.
- [FUNCIONAL.md](FUNCIONAL.md) — qué hace el producto.
- [errors.md](errors.md) — el diccionario de códigos de error.
- [ACTION-PLAN.md](ACTION-PLAN.md) — el backlog, con lo hecho y lo que falta.
- [BITACORA.md](BITACORA.md) — qué cambió, cuándo y por qué.
- [runbook-staging.md](runbook-staging.md) — deploy y vuelta atrás.
- [adr/](adr/) — las decisiones cerradas, que no se re-discuten.
- [apps/](apps/) — un documento por aplicación.

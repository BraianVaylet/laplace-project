# Laplace

SaaS multi-tenant de gestión de centros deportivos. Cuatro aplicaciones web y una API, en un
monorepo.

Un box de CrossFit, un estudio de pilates o un gimnasio funcional maneja hoy sus socios en una
planilla, sus reservas por WhatsApp y su cobranza de memoria. Eso funciona hasta los 40 socios.
Laplace es lo que lo reemplaza, con una meta concreta: **que más del 80% de las reservas las haga el
socio desde su celular**, no el staff desde el mostrador.

## Arrancar

```bash
corepack enable && pnpm install && cp .env.example .env
```

Completar `MONGODB_URI` y `BETTER_AUTH_SECRET` en `.env`, correr las migraciones y levantar:

```bash
pnpm exec migrate-mongo up && pnpm dev
```

| App     | Puerto | Qué es                |
| ------- | ------ | --------------------- |
| API     | 3000   | Backend               |
| DFSA    | 5173   | Panel del super admin |
| DFSM    | 5174   | Escritorio del centro |
| WAFM    | 5175   | App del socio         |
| Landing | 5176   | Sitio público         |

El detalle completo —requisitos, comandos, convenciones— está en
[docs/TECNICO.md](docs/TECNICO.md).

## Documentación

| Documento                                     | Para qué                                          |
| --------------------------------------------- | ------------------------------------------------- |
| [Funcional](docs/FUNCIONAL.md)                | Qué hace el producto, por rol y por módulo        |
| [Técnico](docs/TECNICO.md)                    | Stack, estructura, convenciones y cómo levantarlo |
| [Arquitectura](docs/ARQUITECTURA.md)          | Tenancy, módulos, eventos y jobs                  |
| [Por aplicación](docs/apps/)                  | Pantallas, roles y permisos de cada una           |
| [Errores](docs/errors.md)                     | El diccionario de códigos                         |
| [Plan de acción](docs/ACTION-PLAN.md)         | El backlog, con lo hecho y lo que falta           |
| [Bitácora](docs/BITACORA.md)                  | Qué cambió, cuándo y por qué                      |
| [ADR](docs/adr/)                              | Las decisiones cerradas                           |
| [Runbook de staging](docs/runbook-staging.md) | Deploy y vuelta atrás                             |
| [Spec](docs/spec/LAPLACE-SPEC.md)             | La fuente de verdad                               |

## Comandos

```bash
pnpm test && pnpm lint && pnpm typecheck && pnpm build
```

`pnpm test:e2e` corre los tres caminos críticos en Playwright, contra una base efímera.

## Cómo se trabaja acá

**La spec manda.** Si algo queda fuera de `docs/spec/LAPLACE-SPEC.md`, primero se actualiza la spec
y después se codea.

Cada tarea se cierra completa: tests con la cobertura de su criticidad, test de aislamiento de
tenant, error tipado con su código, logs estructurados, estados vacío/carga/error, accesible,
responsive, dark y light, OpenAPI al día y su entrada en la bitácora. El detalle está en la spec
§15.

Código, variables y commits en inglés. Documentación, UI y mensajes al usuario en español.

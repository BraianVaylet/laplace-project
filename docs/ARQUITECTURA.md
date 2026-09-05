# Documento de arquitectura — Laplace

> Cómo está armado por dentro y **por qué**. Las decisiones grandes viven en los ADR, que no se
> re-discuten: acá se explica cómo se ven en el código.

---

## 1. La forma general

```
┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐
│   DFSA    │  │   DFSM    │  │   WAFM    │  │  Landing  │
│  :5173    │  │  :5174    │  │  :5175    │  │  :5176    │
└─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘
      └──────────────┴───────┬──────┴──────────────┘
                             │  @laplace/client  (fetch + envelope §5.0)
                    ┌────────▼────────┐
                    │   API  :3000    │  Hono
                    │  /api/v1/*      │
                    └────────┬────────┘
                             │  Mongoose 8
                    ┌────────▼────────┐
                    │  MongoDB        │  replica set (transacciones)
                    └─────────────────┘
```

Un solo deployable de backend. Cinco procesos en total, uno por app más la API.

**Por qué un monolito modular y no microservicios**: lo desarrolla una persona. Un microservicio por
módulo multiplicaría el costo de operación sin resolver ningún problema que hoy exista.
→ [ADR-003](adr/003-monorepo.md)

## 2. Multi-tenancy

**El tenant es la Organization de Better Auth.** Una base, una colección por entidad, un campo
`tenantId` en cada documento de negocio. → [ADR-000](adr/000-tenancy.md)

### La regla

🔴 **El `tenantId` sale de la sesión. Nunca del body, nunca de la query, nunca de un parámetro.**

Si el cliente pudiera elegir su tenant, el aislamiento sería una sugerencia.

### Las tres capas

Ninguna alcanza sola. Las tres juntas hacen que aislar no dependa de que nadie se distraiga:

1. **El repositorio** inyecta el `tenantId` en toda consulta. Un controller no puede tocar el modelo
   de Mongoose: lo bloquea ESLint.
2. **Un plugin de Mongoose** es la red de seguridad: si una consulta llegara sin contexto de tenant,
   falla en vez de devolver datos de todos.
3. **Una suite parametrizada** recorre el **registro de rutas** y ataca cada una desde otro tenant.
   Una ruta nueva sin su fixture de ataque rompe el CI: no hay forma de agregar un endpoint y
   olvidarse del test.

Todo índice compuesto lleva `tenantId` primero.

### Cuando algo responde 404 y no 403

Pedir el recurso de otro centro da **404**. Un 403 confirmaría que ese recurso existe, que es
justamente lo que el atacante quiere saber.

### Las colecciones de plataforma

`subscriptions`, `plans`, `contactRequests`, `errorEvents`, `jobLock` y `loginAttempt` **no llevan
`tenantId`**, a propósito: no son datos _de_ un centro, son datos _sobre_ los centros. El super
admin los consulta cruzando todos, y acotarlos por tenant haría imposible su panel. Se acotan por
`organizationId` explícito, que el servicio saca de la sesión.

## 3. Los módulos

```
apps/api/src/modules/<mod>/
  domain/          entidades, máquinas de estado, reglas puras
  application/     casos de uso: orquestan repositorios y emiten eventos
  infrastructure/  modelo de Mongoose, repositorio, rutas Hono
```

`domain/` **no conoce Mongoose ni Hono**. Si una regla de negocio necesita la base para decidir, no
es una regla de dominio.

Los módulos actuales: `account`, `attendance`, `billing`, `booking`, `contracts`, `crm`, `members`,
`metrics`, `notifications`, `products`, `rooms`, `schedule`, `susc`, `venues`, `waivers`.

### Cómo se hablan entre sí

🔴 **Un módulo no importa nada de otro.** Lo bloquea ESLint (`no-restricted-imports`). Hay dos
caminos:

**Por puerto (interfaz).** El módulo declara qué necesita y el punto de composición
(`modules/index.ts`) le pasa quién lo contesta. Contracts no sabe que existe Booking: sabe que hay
alguien que cancela reservas futuras.

**Por evento de dominio.** Cuando el que emite no necesita saber quién escucha ni esperar respuesta:
`booking.created`, `booking.no_show`, `contract.expired`, `session.cancelled`. Un handler que falla
no tumba al que emitió: el bus aísla los fallos y los loguea con su código.

Los ciclos —Products y Contracts se necesitan mutuamente— se resuelven con dos interfaces y una
resolución tardía, nunca importándose.

### Por qué hay puertos que devuelven vacío

Cuando un módulo depende de otro que todavía no existe, el puerto tiene un default que contesta
"nada". Es deuda **declarada**: queda anotada en el ACTION-PLAN con la tarjeta que la va a pagar.
Preferimos un default explícito y anotado a un import que rompe la regla "por ahora".

## 4. Permisos

Recurso × acción, no rol fijo. La matriz está en `apps/api/src/auth/permissions.ts` y la aplica
Better Auth con su plugin de control de acceso.

Los roles del staff son **presets** de esa matriz: un centro puede armar el suyo.

Dos detalles que importan:

- El socio del centro se llama **`athlete`** en la matriz, no `member`: `member` está reservado por
  Better Auth para la gestión de accesos del staff. Si el socio se llamara `member`, darle
  `member.create` al mostrador para dar de alta socios le daría también permiso para invitar
  usuarios staff.
- 🔴 **Lo que un rol no puede ver, no viaja.** No alcanza con esconderlo en el front: si el dato está
  en la respuesta, está en el caché del navegador y en cualquier `curl`. El saldo de un socio sale
  `null` para quien no tiene `billing:read`, y el bloque de plata del tablero no se arma.

## 5. Entitlements

Los planes son un catálogo declarativo (`apps/api/src/entitlements/catalog.ts`): qué módulos incluye
cada uno, qué features y qué límites.

**El enforcement va en middleware del backend.** Ocultar un botón no es una restricción: el límite se
evalúa antes de escribir, y el error dice cuál es el tope y qué plan lo levanta.

Los límites cuentan lo que **ocupa cupo**, no el histórico: archivar a los socios que se fueron tiene
que liberar lugar.

## 6. Jobs

Cron in-process con **lock en Mongo**: sin Redis, sin servicio extra, sin costo. El disparador para
migrar a una cola de verdad es el volumen, no la estética. → [ADR-006](adr/006-jobs-runtime.md)

Cada job es **idempotente** y deja registro de inicio, fin, duración y error. Un job que falla en
silencio es peor que un job que no existe: las corridas fallidas alimentan el panel de salud.

Los que corren hoy:

| Job                       | Cuándo    | Qué hace                                             |
| ------------------------- | --------- | ---------------------------------------------------- |
| `materializeSessions`     | diario    | Publica la grilla de los próximos 60 días            |
| `expireContracts`         | diario    | Vence contratos y libera lo que corresponda          |
| `notifyExpiringContracts` | diario    | Avisa 7, 3 y 1 días antes del vencimiento            |
| `dunning`                 | diario    | Mora y avisos de deuda                               |
| `computeMetricsDaily`     | diario    | Precalcula los números del día por sede              |
| `expireTrials`            | diario    | Cierra las pruebas vencidas — **suspende, no borra** |
| `applyPendingPlanChanges` | diario    | Aplica las bajas de plan al terminar el ciclo        |
| `markNoShows`             | cada hora | Marca ausentes cuando cierra la ventana de check-in  |
| `expireWaitlistHolds`     | frecuente | Libera el lugar de quien no confirmó                 |
| `classReminders`          | frecuente | Recordatorios 24 h y 1 h antes                       |
| `dispatchNotifications`   | frecuente | Envía la cola de avisos, con reintentos              |

## 7. Transacciones

Reservar toma el lugar **y** descuenta el crédito en la misma transacción. Cancelar devuelve el
crédito **y** libera el lugar en la misma. A medias, el socio pierde una clase que pagó o la clase
queda con un lugar fantasma que nadie puede usar.

Por eso MongoDB tiene que ser un replica set, también en los tests.

## 8. El registro de rutas

Toda ruta se declara en un registro con su método, su path, si está acotada por tenant, su permiso,
su schema de request y response, sus códigos de error y **su fixture de ataque** para la suite de
aislamiento.

De ese mismo registro sale el OpenAPI que se publica en `/api/v1/docs`: la documentación de la API
no se escribe aparte, así que no puede quedar desactualizada.

## 9. Observabilidad

Pino en JSON con el formato de §11.1, `requestId` en cada pedido y en cada respuesta de error.

Los errores se persisten en `errorEvents`, y de ahí sale el buscador de soporte del super admin: el
socio comparte el código que vio y del otro lado se ve qué pasó. 🔴 Ese buscador devuelve el código,
el estado y la ruta — **nunca el mensaje ni el `meta`**, donde puede estar el nombre y el saldo de
una persona.

## 10. El front

Cada app es Vite + React 19, con el mismo esqueleto: `@laplace/ui` para las primitivas,
`@laplace/client` para el fetch y el estado de UI, `@laplace/schemas` para los tipos y las
validaciones — los mismos que usa el backend.

- La **landing** se prerenderiza a HTML estático con `vite-react-ssg`: una SPA sin SSR no rankea.
  → [ADR-005](adr/005-landing-rendering.md)
- La **app del socio** es PWA, con el horario cacheado: el subte no tiene señal y el horario de
  mañana no cambió.
- Todo componente que trae datos acepta un cliente inyectable, que es lo que hace que se pueda
  probar sin levantar la API.

## 11. Las decisiones cerradas

| ADR                                  | Qué cierra                                                |
| ------------------------------------ | --------------------------------------------------------- |
| [000](adr/000-tenancy.md)            | El tenant es la Organization; una base con `tenantId`     |
| [001](adr/001-credit-consumption.md) | El crédito se descuenta **al reservar**                   |
| [002](adr/002-payments.md)           | Solo suscripción; el dinero del socio no pasa por Laplace |
| [003](adr/003-monorepo.md)           | Monorepo pnpm + Turborepo, monolito modular               |
| [004](adr/004-open-decisions.md)     | Las siete decisiones que la spec dejaba abiertas          |
| [005](adr/005-landing-rendering.md)  | La landing se prerenderiza con `vite-react-ssg`           |
| [006](adr/006-jobs-runtime.md)       | Cron in-process con lock en Mongo, no BullMQ              |

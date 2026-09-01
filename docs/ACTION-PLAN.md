# Plan de acción — Laplace

> Requisito de la spec §5. **Backlog vivo:** cada tarea se marca `[x]` al cumplir el Definition of
> Done (§15). El orden es de prioridad y de dependencia: una tarea no arranca si sus `depends_on`
> no están cerradas.

- **Spec:** `docs/spec/LAPLACE-SPEC.md` v2.1
- **Tablero:** https://trello.com/b/8QrgU6Cc/laplace
- **Formato de tarea:** §5 + §5.0 (title, module, description, acceptance-criteria, example,
  story-points, depends_on, risk, test_plan, error-codes, data-model-impact)
- **Escala:** Fibonacci 1/2/3/5/8/13. Ninguna tarea supera 8: toda tarea de 13 se parte antes de
  empezar.
- **Regla de corte (§12):** ninguna fase arranca sin que la anterior esté en producción con un
  cliente real usándola.

## Estado

| Fase                    |   Tareas | Story points | Hechas |
| ----------------------- | -------: | -----------: | -----: |
| Fase 0 — Fundaciones    |       16 |           89 |     13 |
| Fase 1 — MVP vendible   |       32 |          186 |      0 |
| Fase 2 — Diferenciación | 7 épicas |         ~140 |      0 |
| Fase 3 — Profundidad    | 5 épicas |         ~110 |      0 |
| Fase 4 — Escala         | 5 épicas |          ~80 |      0 |

**Ya cerrado antes de este plan** (commit `2f009d3`): monorepo pnpm + Turborepo, CI, envelope de
error §5.0, logger Pino §11.1, `/health` y `/ready`, harness de Mongo con replica set,
`@laplace/schemas` y `@laplace/types` base, ADR 000–006.

---

# Fase 0 — Fundaciones

Bloqueante de todo lo demás. Sin esto, cada tarea de negocio arrastra decisiones de infraestructura.

## [x] F0-01 · Integrar Better Auth con MongoDB

- **module:** auth
- **description:** El backend autentica usuarios con email y contraseña, exige verificación de
  email y mantiene sesión. Es la base de la que cuelga todo el resto: sin identidad no hay tenant,
  y sin tenant no hay una sola consulta segura.
- **acceptance-criteria:**
  - Dado un email sin registrar, cuando alguien se registra, entonces se crea el `User`, se envía
    el mail de verificación y la cuenta queda sin verificar.
  - Dado un usuario sin verificar, cuando intenta reservar, entonces la API responde
    `LP-AUTH-403-004` (§2.1.1: verificación obligatoria antes de reservar).
  - Dadas credenciales incorrectas, cuando intenta entrar, entonces responde `LP-AUTH-401-001` sin
    revelar si el email existe.
  - Dada una sesión válida, cuando llama a un endpoint protegido, entonces el contexto expone
    `userId`; si no la hay, responde `LP-AUTH-401-005`.
  - Dado un email ya registrado, cuando se registra de nuevo, entonces responde `LP-AUTH-409-009`.
- **example:** Braian se registra con `braian@boxtoro.com`, recibe el mail, hace clic y queda
  verificado. Su sesión sobrevive a un reinicio de la API porque vive en Mongo, no en memoria.
- **story-points:** 5
- **depends_on:** —
- **risk:** high
- **test_plan:** Integración con `mongodb-memory-server`: registro, login, sesión, verificación,
  cada código de error. Ningún test toca la red — el envío de mail se inyecta como puerto.
- **error-codes:** `LP-AUTH-403-004`, `LP-AUTH-401-005`, `LP-AUTH-409-009`
- **data-model-impact:** Colecciones de Better Auth (`user`, `session`, `account`, `verification`).
  Migración: índice único en `user.email`.

## [x] F0-02 · Multi-tenancy con el organization plugin y matriz de permisos

- **module:** auth
- **description:** Un usuario pertenece a una o varias organizaciones con un rol y un set de
  permisos por recurso y acción. La sesión lleva la organización activa. Los sub-roles de staff
  (§1.1) salen preconfigurados pero son personalizables permiso por permiso.
- **acceptance-criteria:**
  - Dado un usuario miembro de dos organizaciones, cuando cambia la organización activa, entonces
    la sesión refleja el nuevo `activeOrganizationId` y los permisos del rol que tiene **ahí**.
  - Dado un `coach`, cuando pide las métricas de negocio, entonces responde `LP-AUTH-403-002`
    (§2.1.12: el staff no accede a métricas).
  - Dado un `front_desk`, cuando da de alta un miembro, entonces lo permite; cuando intenta editar
    una planificación, responde `LP-AUTH-403-002`.
  - Dado cualquier rol, cuando el permiso se evalúa, entonces se resuelve **en el servidor**;
    `checkRolePermission` en el cliente solo decide si se pinta el botón (§2.1.1).
  - Dada una sesión sin organización activa, cuando llama a un endpoint de negocio, entonces
    responde `LP-AUTH-403-011`.
- **example:** Lucía es `coach` en Box Toro y `member` en Gym Black, con el mismo email. En Box Toro
  toma asistencia; en Gym Black solo reserva sus clases.
- **story-points:** 8
- **depends_on:** F0-01
- **risk:** high
- **test_plan:** Matriz parametrizada rol × recurso × acción, con el resultado esperado por celda.
  Un permiso nuevo sin fila en la matriz rompe el test.
- **error-codes:** `LP-AUTH-403-011`
- **data-model-impact:** `organization`, `member`, `invitation` (Better Auth org plugin).
  `Membership` gana `venueIds[]` y `permissions[]`.

## [x] F0-03 · Endurecer Auth: rate limit, bloqueo, 2FA y magic link

- **module:** auth
- **description:** Las defensas de §9.1 sobre el flujo de autenticación: límite de intentos,
  bloqueo progresivo, segundo factor y acceso sin contraseña para el miembro en mobile.
- **acceptance-criteria:**
  - Dadas 6 peticiones de login desde la misma IP en un minuto, cuando llega la sexta, entonces
    responde `LP-AUTH-429-003` (§9.1: 5/min/IP).
  - Dados N intentos fallidos sobre la misma cuenta, cuando se supera el umbral, entonces la cuenta
    queda bloqueada de forma temporal y creciente, y responde `LP-AUTH-403-006`.
  - Dado un SAU sin 2FA configurado, cuando entra al DFSA, entonces se le exige configurarlo
    (`LP-AUTH-403-007`): para el super admin es obligatorio, para el SMU es opcional.
  - Dado un miembro, cuando pide un magic link, entonces recibe un enlace de un solo uso y vida
    corta; reutilizarlo o usarlo vencido responde `LP-AUTH-422-010`.
- **example:** Alguien prueba 20 contraseñas contra `braian@boxtoro.com`. A partir del sexto intento
  la IP recibe 429; la cuenta queda bloqueada 5 minutos y el titular recibe un aviso.
- **story-points:** 5
- **depends_on:** F0-01
- **risk:** high
- **test_plan:** Unit del contador con reloj inyectado (nada de esperas reales). Integración del
  bloqueo progresivo y del ciclo de vida del magic link. Verificar que el 429 no filtra si el email
  existe.
- **error-codes:** `LP-AUTH-403-006`, `LP-AUTH-403-007`, `LP-AUTH-401-008`, `LP-AUTH-422-010`
- **data-model-impact:** `loginAttempt { key, count, blockedUntil }` con TTL. `user.twoFactor`.

## [x] F0-04 · Contexto de tenant, repositorio base y plugin de Mongoose

- **module:** infra
- **description:** Las tres capas de aislamiento del ADR-000. Middleware que resuelve el `tenantId`
  desde la sesión, repositorio base que lo inyecta en toda consulta, y plugin de Mongoose como red
  de seguridad de segundo nivel. Es la pieza de la que depende que no haya fuga entre centros.
- **acceptance-criteria:**
  - Dado un request autenticado, cuando el middleware corre, entonces el contexto expone
    `{ tenantId, venueId?, userId, requestId }` resuelto **desde la sesión**; un `tenantId` en el
    body o la query se ignora por completo.
  - Dado un repositorio, cuando ejecuta cualquier `find`, `update` o `delete`, entonces el filtro
    lleva `tenantId` sin que el llamador tenga que acordarse.
  - Dado un `find` que por error no pasó por el repositorio, cuando el plugin intercepta, entonces
    agrega el `tenantId` del contexto o falla ruidosamente si no hay contexto.
  - Dado cualquier documento nuevo, cuando se guarda, entonces lleva `createdAt`, `updatedAt`,
    `createdBy`, `updatedBy` y `deletedAt: null` (§5.2.1).
  - Dado un listado, cuando se pagina, entonces usa cursor sobre un campo indexado y **nunca**
    `skip` (§5.0).
  - Dado un borrado, cuando se ejecuta, entonces es soft delete por default; el hard delete es una
    operación aparte y explícita.
- **example:** `memberRepository.list({ status: 'active' })` desde una sesión de Box Toro genera
  `{ tenantId: <boxToro>, status: 'active', deletedAt: null }`. El mismo código desde Gym Black
  nunca ve un miembro de Box Toro, aunque tenga su `_id`.
- **story-points:** 8
- **depends_on:** F0-02
- **risk:** high
- **test_plan:** Unit del repositorio verificando el filtro generado. Integración con dos tenants y
  datos cruzados. Test de que el plugin **falla** si se consulta sin contexto: fallar es el
  comportamiento correcto, devolver todo es la catástrofe.
- **error-codes:** `LP-SYS-500-003` (consulta sin contexto de tenant — bug, no error de usuario)
- **data-model-impact:** Plugin transversal: `tenantId`, campos de auditoría y soft delete en toda
  colección de negocio. Identificadores públicos con prefijo (`mem_`, `bkg_`, `pay_`).

## [x] F0-05 · Suite parametrizada de aislamiento de tenant

- **module:** infra
- **description:** El test que la spec declara no negociable (§Testing.1): para **cada** ruta
  registrada, el tenant A no puede leer ni escribir recursos del tenant B, ni siquiera con IDs
  válidos. Se parametriza sobre un registro de rutas para que un endpoint nuevo entre solo.
- **acceptance-criteria:**
  - Dada la app, cuando se pide su registro de rutas, entonces devuelve método, path y el permiso
    que exige cada una.
  - Dado un recurso del tenant B, cuando el tenant A lo pide por ID, entonces responde 404 — no
    403: un 403 confirma que el recurso existe.
  - Dada una ruta nueva sin fixture declarado, cuando corre la suite, entonces **falla**: sumar la
    ruta al registro sin sumarla al test no debe poder pasar el CI.
  - Dada la suite completa, cuando corre en CI, entonces cubre el 100% de las rutas de negocio.
- **example:** Box Toro pide `GET /api/v1/members/mem_deGymBlack` con un ID que existe de verdad.
  Recibe 404. En el log queda el intento con su `tenantId` y su `requestId`.
- **story-points:** 5
- **depends_on:** F0-04
- **risk:** high
- **test_plan:** Es en sí mismo el test. Se valida con un caso trampa: una ruta deliberadamente mal
  escrita (que consulta el modelo directo, sin repositorio) debe hacerla fallar.
- **error-codes:** ninguno
- **data-model-impact:** ninguno

## [x] F0-06 · Bus de eventos de dominio in-process

- **module:** infra
- **description:** Los módulos se comunican por eventos, no importándose entre sí (ADR-003).
  Notificaciones y métricas se suscriben a lo que pasa sin acoplarse al flujo principal.
- **acceptance-criteria:**
  - Dado un evento tipado (`booking.created`, `payment.received`, `contract.expiring`…), cuando se
    emite, entonces todos sus handlers reciben el payload con su tipo, sin `any`.
  - Dado un handler que lanza, cuando falla, entonces **no** rompe al emisor ni a los otros
    handlers: se loguea con su `errorCode` y el flujo principal sigue.
  - Dado un evento, cuando se emite, entonces el log lleva el `requestId` y el `tenantId` del
    contexto que lo originó, para poder trazarlo de punta a punta.
  - Dado un evento sin handlers, cuando se emite, entonces no es un error.
- **example:** Al crear una reserva se emite `booking.created`. Notifications manda la confirmación
  y Metrics incrementa el contador del día. Si el mail falla, la reserva ya está hecha igual.
- **story-points:** 3
- **depends_on:** F0-04
- **risk:** med
- **test_plan:** Unit del emisor: tipado, orden, aislamiento de fallos, propagación del contexto.
- **error-codes:** `LP-SYS-500-004` (handler de evento fallido)
- **data-model-impact:** ninguno. En Fase 2, cuando los eventos pasen a cola, la interfaz no cambia.

## [x] F0-07 · Entitlements: catálogo declarativo y enforcement

- **module:** entitlements
- **description:** Lo que hace que Basic, Pro y Max no sean texto en la landing (§2.1.22). Cada
  plan declara módulos, features y límites numéricos; el enforcement vive en un middleware del
  backend. El empaquetado es el de **§2.2.1**, no el de §2.2.
- **acceptance-criteria:**
  - Dado el catálogo, cuando se define un plan, entonces lo hace de forma declarativa: módulos
    habilitados, features y límites (`venues`, `activeMembers`, `staffUsers`, `storage`).
  - Dado un centro Basic con 60 miembros activos, cuando intenta crear el 61, entonces responde
    `LP-ENTL-403-001` con el límite, el plan y el CTA de upgrade en el `action`.
  - Dado un centro Basic, cuando llama a un endpoint del módulo Planning, entonces responde
    `LP-ENTL-403-002`: el módulo no está en su plan.
  - Dado un centro al 80% de un límite, cuando lo cruza, entonces se emite el aviso; y otra vez
    al 100%.
  - Dado un centro con 120 miembros en Pro, cuando pide bajar a Basic, entonces el downgrade se
    bloquea con `LP-ENTL-409-004` explicando **exactamente** qué excede.
  - Dado un suscriptor VIP con override, cuando se evalúa su límite, entonces manda el override.
  - Dado un cambio de plan, cuando se aplica, entonces el cache de entitlements de la sesión se
    invalida.
  - Dado el conteo de miembros, cuando se calcula, entonces cuenta **activos**, no históricos:
    archivar a los que se fueron no cuesta plata (§2.2.1).
- **example:** Box Toro está en Basic. Tiene 60 miembros activos y 4 archivados. Da de alta a
  Micaela: la API responde 403 con "Alcanzaste el máximo de 60 miembros del plan Basic" y el botón
  de upgrade. Archiva a un socio que se fue y ahora sí puede.
- **story-points:** 8
- **depends_on:** F0-04
- **risk:** high
- **test_plan:** Unit del catálogo. Integración del middleware: límite exacto, límite + 1, override
  VIP, downgrade bloqueado, invalidación del cache. Es uno de los módulos con cobertura mínima 95%.
- **error-codes:** `LP-ENTL-403-002`, `LP-ENTL-403-003`, `LP-ENTL-409-004`
- **data-model-impact:** `Organization.planId`, `Organization.planLimits` (overrides). Catálogo de
  planes versionado en código, no en base: es configuración de producto, no dato de tenant.

## [x] F0-08 · Runner de jobs con lock en Mongo

- **module:** infra
- **description:** El motor de los catorce procesos automáticos de §10, según ADR-006: cron
  in-process, lock atómico en Mongo, idempotencia, observabilidad y alerta ante fallo.
- **acceptance-criteria:**
  - Dado un job registrado con su cron, cuando llega su horario, entonces corre una sola vez aunque
    haya varias instancias de la API levantadas.
  - Dado un proceso que muere a mitad de un job, cuando vence el TTL del lock, entonces el lock se
    libera solo y la próxima corrida lo retoma.
  - Dada una corrida, cuando termina, entonces deja log con `module: 'jobs'`, `action`, `durationMs`
    y resultado; si falló, con `errorCode` y alerta.
  - Dado un job corrido dos veces sobre el mismo día, cuando termina la segunda, entonces el efecto
    es idéntico al de una sola corrida.
  - Dado `JOBS_ENABLED=false`, cuando arranca la API, entonces no se programa ningún job.
- **example:** Dos instancias en Railway a las 03:00. `computeMetricsDaily` corre una vez: la
  segunda encuentra el lock tomado, loguea que lo saltea y sigue.
- **story-points:** 5
- **depends_on:** F0-04
- **risk:** med
- **test_plan:** Test de concurrencia del lock (N adquisiciones simultáneas → 1 ganador), igual de
  obligatorio que el de reserva. Test de expiración del TTL. Test de idempotencia con un job de
  prueba. Reloj inyectado: la suite no espera en tiempo real.
- **error-codes:** `LP-SYS-500-005` (job fallido)
- **data-model-impact:** `JobLock { name, lockedAt, expiresAt, instanceId }` con índice único en
  `name`. `JobRun { name, startedAt, finishedAt, status, durationMs, error }` con TTL de retención.

## [x] F0-09 · OpenAPI generado desde los schemas Zod

- **module:** infra
- **description:** La documentación de la API sale de los schemas Zod, no se escribe a mano
  (ADR-003: escrita a mano se desactualiza siempre). Swagger UI servido por la propia API.
- **acceptance-criteria:**
  - Dada una ruta con su schema Zod de entrada y salida, cuando se registra, entonces aparece en el
    OpenAPI con sus tipos, sin duplicar la definición.
  - Dado el envelope de error §5.0, cuando se documenta, entonces figura como respuesta posible de
    toda ruta, con los códigos que esa ruta puede devolver.
  - Dado `/api/v1/docs`, cuando se abre en el navegador, entonces muestra Swagger UI navegable.
  - Dado el entorno de producción, cuando se sirve la doc, entonces requiere autenticación: el mapa
    completo de la API no es público.
- **example:** Se agrega `POST /api/v1/bookings`. Su schema Zod ya existe en `@laplace/schemas`; la
  doc aparece sola, con `LP-BOOK-409-002` entre las respuestas.
- **story-points:** 3
- **depends_on:** F0-04
- **risk:** low
- **test_plan:** Test que valida que el documento OpenAPI generado es válido y que toda ruta del
  registro (F0-05) figura en él. Una ruta indocumentada rompe el build.
- **error-codes:** ninguno
- **data-model-impact:** ninguno

## [x] F0-10 · Migraciones e índices obligatorios

- **module:** infra
- **description:** Los índices de §5.2.3 creados por migración versionada y reversible. Nunca a
  mano en Atlas (§6).
- **acceptance-criteria:**
  - Dada una base vacía, cuando se corre `migrate-mongo up`, entonces quedan creados los índices de
    §5.2.3, con `tenantId` **primero** en todo compuesto.
  - Dado el índice de `Booking`, cuando se crea, entonces es **único** sobre
    `{ tenantId, sessionId, memberId }`: es lo que impide la doble reserva.
  - Dado el índice de `Payment`, cuando se crea, entonces es único sobre
    `{ tenantId, idempotencyKey }`: es lo que hace idempotentes a los webhooks.
  - Dada una migración aplicada, cuando se corre `migrate-mongo down`, entonces revierte sin
    pérdida de datos.
  - Dada la suite de tests, cuando arranca, entonces aplica las mismas migraciones: los tests
    corren contra los índices reales, no contra una base sin restricciones.
- **example:** Dos peticiones idénticas de reserva ganan la carrera del `bookedCount`, pero la
  segunda choca contra el índice único de `Booking` y se rechaza. El índice es el último cinturón.
- **story-points:** 3
- **depends_on:** F0-04
- **risk:** med
- **test_plan:** Integración: aplicar migraciones sobre `mongodb-memory-server` y verificar que
  cada índice existe con sus llaves, su orden y su unicidad. Test de que insertar un duplicado falla.
- **error-codes:** ninguno
- **data-model-impact:** Todos los índices de §5.2.3.

## [x] F0-11 · Fundaciones de front

- **module:** infra
- **description:** El stack de las cuatro apps: Tanstack Query/Router/Form/Table, Zustand, Nuqs,
  Motion, Fontsource, cliente de API tipado, i18n es-AR y los helpers de Temporal. Con la frontera
  de estado escrita y verificable (§6): Query = servidor, Zustand = UI, Nuqs = filtros urleables.
- **acceptance-criteria:**
  - Dado el cliente de API, cuando llama a la API, entonces manda el `requestId` y, ante error,
    devuelve un error tipado con su `code`, su `message` y su `action` — nunca un string suelto.
  - Dado un error de API, cuando llega al usuario, entonces se muestra con su código y su
    `requestId` para poder compartirlos con soporte (§5).
  - Dado un filtro de listado, cuando el usuario lo cambia, entonces vive en la URL vía Nuqs: la
    página se puede compartir y recargar sin perder el filtro.
  - Dado el estado de servidor, cuando se guarda, entonces vive **solo** en Query: duplicarlo en
    Zustand rompe una regla de lint.
  - Dada una fecha, cuando se muestra, entonces se formatea con `Temporal` en la TZ del Venue y en
    formato es-AR, con lunes como primer día de semana.
  - Dado cualquier texto de UI, cuando se escribe, entonces sale del catálogo i18n: la app se
    construye con i18n desde el día 1 aunque solo tenga español (§3.1).
- **example:** El listado de miembros filtrado por `?status=active&tag=turno-manana` se comparte por
  WhatsApp y el otro lo abre con el mismo filtro aplicado.
- **story-points:** 8
- **depends_on:** F0-01
- **risk:** med
- **test_plan:** Unit del cliente de API con MSW: propagación del `requestId`, mapeo del envelope a
  error tipado, reintento. Unit de los helpers de Temporal cruzando TZ y DST. Regla de ESLint que
  prohíbe estado de servidor en Zustand, con un caso que debe fallar.
- **error-codes:** ninguno nuevo (consume los del backend)
- **data-model-impact:** ninguno

## [x] F0-12 · `@laplace/ui`: tokens, tema y primitivas accesibles

- **module:** ui
- **description:** La librería de componentes cross de §6, sin lógica de negocio adentro. Tokens de
  color y tipografía, dark/light (dark first), y las primitivas que usan las cuatro apps.
- **acceptance-criteria:**
  - Dado el set de primitivas, cuando se completa, entonces incluye Input, Select, Checkbox, Radio,
    Dialog, Toast, Table, Tabs, Skeleton, EmptyState, ErrorState, Badge, Card y FormField.
  - Dado cualquier componente, cuando se audita con axe, entonces no reporta violaciones: contraste
    ≥ 4.5:1, foco visible, navegación por teclado, labels y `aria-*` correctos (§UX/UI).
  - Dado un target táctil, cuando se mide, entonces es ≥ 44×44 px.
  - Dada una animación de Motion, cuando el usuario tiene `prefers-reduced-motion`, entonces no se
    reproduce.
  - Dado un input, cuando se renderiza en iOS, entonces su tipografía es ≥ 16 px (evita el zoom
    automático).
  - Dado un listado en carga, cuando se muestra, entonces usa skeleton, no spinner.
  - Dado un `EmptyState`, cuando se muestra, entonces incluye la acción que lo resuelve
    ("Todavía no tenés clases → Crear la primera").
  - Dado cualquier componente, cuando se abre Storybook, entonces tiene su historia en dark y light.
- **example:** El DFSM y la WAFM usan el mismo `Dialog`. En el DFSM aparece denso, en la WAFM
  espaciado; el componente es el mismo, cambia el token de densidad.
- **story-points:** 8
- **depends_on:** —
- **risk:** med
- **test_plan:** Testing Library por primitiva: roles, labels, teclado. `axe` sobre cada historia de
  Storybook, corriendo en CI. Test de contraste sobre los tokens en ambos temas.
- **error-codes:** ninguno
- **data-model-impact:** ninguno

## [ ] F0-13 · Shells de las cuatro aplicaciones

- **module:** infra
- **description:** El esqueleto navegable de DFSA, DFSM, WAFM y Landing según §5.1, con routing,
  sesión, selector de Venue y la PWA de la WAFM.
- **acceptance-criteria:**
  - Dado el DFSA, cuando entra un SAU, entonces ve header (configuración, cerrar sesión, tema,
    home), footer y panel lateral izquierdo **colapsable**; y solo entra un SAU.
  - Dado el DFSM, cuando el suscriptor tiene más de un Venue, entonces el header muestra el
    selector de Venue y el contexto activo persiste entre recargas.
  - Dada la WAFM en mobile, cuando se navega, entonces usa **bottom nav** (§5.1.3 `[+]`: el pulgar
    no llega arriba); a partir de 768 px se muestra la barra superior de §5.1.3.
  - Dada la WAFM en Chrome/Android, cuando el usuario puede instalarla, entonces se ofrece el botón
    nativo; **en iOS** se muestran las instrucciones manuales (Compartir → Agregar a inicio), porque
    `beforeinstallprompt` no existe ahí.
  - Dado el modal de instalación, cuando el usuario lo rechaza, entonces no vuelve a aparecer hasta
    dentro de 7 días, y tras 2 rechazos no vuelve más.
  - Dada una versión nueva de la WAFM, cuando el service worker la detecta, entonces aparece el
    popup de actualización bloqueante — **con escape a los 30 s** por si el SW falla.
  - Dada la WAFM sin red, cuando el usuario abre su horario y sus reservas, entonces los ve desde
    cache; las escrituras se encolan y se sincronizan al volver la red.
  - Dadas las cuatro apps, cuando se prueban a 360, 768 y 1440 px en dark y light, entonces el
    layout responde y no hay scroll horizontal.
- **example:** Un socio abre la WAFM en el subsuelo del box, sin señal. Ve el horario del día
  cacheado y su reserva. Cuando sale a la calle, la cancelación que hizo se sincroniza sola.
- **story-points:** 8
- **depends_on:** F0-11, F0-12
- **risk:** med
- **test_plan:** Test de routing y guards por rol en cada app. Test del selector de Venue y su
  persistencia. Test del gate de instalación (7 días / 2 rechazos) con reloj inyectado. Test del
  escape de 30 s del popup de actualización. E2E de instalación en Playwright.
- **error-codes:** ninguno
- **data-model-impact:** ninguno

## [ ] F0-14 · Landing a SSG

- **module:** landing
- **description:** Migrar la landing de SPA a estáticos prerenderizados con `vite-react-ssg`
  (ADR-005), con las meta tags, el sitemap y el robots que pide §5.1.4. Es el canal de adquisición:
  sin HTML servido, no rankea.
- **acceptance-criteria:**
  - Dado `pnpm build`, cuando termina, entonces emite un HTML por ruta con el contenido adentro, no
    un `div` raíz vacío.
  - Dada cualquier ruta, cuando se sirve, entonces trae `title`, `meta description` y Open Graph
    propios.
  - Dado el build, cuando termina, entonces genera `sitemap.xml` y `robots.txt`.
  - Dado el HTML generado, cuando se audita con Lighthouse, entonces el score de SEO es ≥ 95.
  - Dadas las otras tres apps, cuando se buildean, entonces siguen siendo SPA: la decisión aplica
    solo a la landing.
- **example:** Alguien busca "software gestión gimnasio Argentina". El buscador lee el HTML de la
  landing con su título y su descripción, sin ejecutar JavaScript.
- **story-points:** 5
- **depends_on:** F0-12
- **risk:** low
- **test_plan:** Test sobre el HTML **generado**, no sobre el componente: que contenga el `title`,
  la meta description y el texto de la sección principal. Lighthouse CI con umbral de SEO.
- **error-codes:** ninguno
- **data-model-impact:** ninguno

## [x] F0-15 · Gate de cobertura por criticidad en CI

- **module:** ci
- **description:** La estrategia de testing de §6: cobertura por zona según criticidad, no un 90%
  global que empuja a escribir tests triviales.
- **acceptance-criteria:**
  - Dado el config de cobertura, cuando se define, entonces exige 95% en Billing, Contracts,
    Booking, Entitlements y Auth; 85% en Attendance, Results, RMs y Planning; 70% en Notifications,
    Metrics, CRM y Feedback; 50% en UI genérica y landing; ≥ 80% global.
  - Dado un PR que baja la cobertura de una zona por debajo de su umbral, cuando corre el CI,
    entonces **falla**.
  - Dado el reporte, cuando termina el CI, entonces queda publicado como artefacto del run.
- **example:** Un PR agrega una rama sin cubrir en el cálculo de crédito. La cobertura de Contracts
  cae a 93% y el CI corta el merge.
- **story-points:** 2
- **depends_on:** —
- **risk:** low
- **test_plan:** Se verifica bajando a propósito la cobertura de una zona y comprobando que el CI
  falla.
- **error-codes:** ninguno
- **data-model-impact:** ninguno

## [ ] F0-16 · Deploy a staging con backup verificado

- **module:** infra
- **description:** El ambiente `staging` con datos sintéticos de §6, con health checks, backups
  automáticos y **el restore probado**. Un backup sin restore probado no es un backup.
- **acceptance-criteria:**
  - Dado un push a `main`, cuando pasa el CI, entonces se despliega a staging automáticamente.
  - Dado staging levantado, cuando se consulta `/health` y `/ready`, entonces responden 200 y el
    `/ready` verifica la conexión a Mongo.
  - Dado el cluster de Atlas, cuando se configura, entonces tiene replica set (requisito de las
    transacciones), backups automáticos y PITR.
  - Dado un backup, cuando se ejecuta el procedimiento de restore, entonces se restaura en una base
    aparte y se verifica el conteo de documentos. El procedimiento queda documentado con su RPO
    (≤ 24 h) y su RTO (≤ 4 h).
  - Dados los secretos, cuando se configuran, entonces viven en Railway, nunca en el repo.
  - Dada una caída del servicio, cuando el monitoreo externo la detecta, entonces alerta.
- **example:** Se corre el restore un viernes. La base restaurada tiene los mismos documentos que la
  original y la API levanta contra ella. Recién ahí el backup cuenta como backup.
- **story-points:** 5
- **depends_on:** F0-10
- **risk:** med
- **test_plan:** Smoke E2E contra staging después de cada deploy. Restore verificado a mano una vez,
  con el resultado anotado en la bitácora.
- **error-codes:** ninguno
- **data-model-impact:** ninguno

---

# Fase 1 — MVP vendible

Objetivo de §12: **un box real operando y pagando**. El orden es de dependencia; el corte natural
de revisión está al cerrar F1-16, con el corazón del producto andando de punta a punta.

## [ ] F1-01 · Módulo Venues

- **module:** rooms
- **description:** La sede: unidad de negocio con dirección, marca, zona horaria, moneda, horarios
  de atención, política de reserva propia, caja y métricas independientes (§2.1.6). El límite del
  plan cuenta Venues activos, no Rooms.
- **acceptance-criteria:**
  - Dado un SMU, cuando crea un Venue, entonces define nombre, dirección, teléfono, TZ, moneda,
    horarios de atención y política de reserva; y se crea con una Room por default (§1.1: el 90%
    tiene una sola sala y nunca debería ver el concepto).
  - Dada la política de reserva, cuando se configura, entonces incluye `bookingOpensAt`,
    `bookingClosesAt`, `cancelCutoff`, `waitlistPromotionCutoff`, `checkInWindow` y `allowDebt`,
    con los defaults de §2.1.5.c y ADR-004.
  - Dado un centro Basic con 1 Venue, cuando intenta crear el segundo, entonces responde
    `LP-ENTL-403-001`.
  - Dado un Venue archivado, cuando se cuenta el límite del plan, entonces no suma; su histórico se
    preserva (§2.1.6).
  - Dada una fecha de negocio, cuando se calcula, entonces usa la TZ del Venue, nunca la del
    servidor (§2.1.2).
- **example:** Box Toro crea la sede Centro: TZ `America/Argentina/Buenos_Aires`, moneda ARS,
  cancelación hasta 2 h antes, reservas abiertas 7 días antes. La sala "Principal" se crea sola.
- **story-points:** 5
- **depends_on:** F0-07
- **risk:** med
- **test_plan:** Integración del CRUD + aislamiento de tenant. Test del límite de plan por Venue.
  Test de la Room automática. Test de cálculo de fecha en la TZ del Venue cruzando DST.
- **error-codes:** `LP-SCHD-422-001` (política de reserva inconsistente: cierre antes que apertura)
- **data-model-impact:** `Venue` completo de §5.2.2. Índice `{ tenantId, status }`.

## [ ] F1-02 · Módulo Rooms

- **module:** rooms
- **description:** El espacio físico con capacidad y equipamiento. Es de donde hereda la capacidad
  una clase.
- **acceptance-criteria:**
  - Dado un Venue, cuando se crea una Room, entonces define nombre, capacidad y equipamiento.
  - Dada una clase, cuando se programa en una Room, entonces hereda su capacidad, con posibilidad
    de sobreescribirla por sesión (§2.1.5.b).
  - Dada una Room con sesiones futuras, cuando se intenta borrar, entonces se bloquea con
    `LP-SCHD-409-002` y se ofrece archivarla.
  - Dado un centro Pro, cuando supera las 3 sedes, entonces el límite aplica sobre Venues, no sobre
    Rooms (§1.1).
- **example:** La sede Centro tiene "Principal" (capacidad 16, 8 racks) y "Sala 2" (capacidad 10,
  para pilates). Una clase en Sala 2 arranca con cupo 10.
- **story-points:** 3
- **depends_on:** F1-01
- **risk:** low
- **test_plan:** Integración del CRUD + aislamiento. Test de herencia de capacidad. Test del
  bloqueo de borrado con sesiones futuras.
- **error-codes:** `LP-SCHD-409-002`
- **data-model-impact:** `Room` de §5.2.2. Índice `{ tenantId, venueId }`.

## [ ] F1-03 · Módulo Members

- **module:** members
- **description:** El alta y la gestión del socio, con su máquina de estados, sus etiquetas y las
  notas internas del staff. Es la entidad sobre la que gira todo el resto del producto.
- **acceptance-criteria:**
  - Dado un SMU o un `front_desk`, cuando da de alta un miembro, entonces registra nombre,
    apellido, documento, teléfono, fecha de nacimiento y contacto de emergencia.
  - Dado un miembro, cuando cambia de estado, entonces lo hace **solo por transición explícita y
    validada** (§14): `lead → trial → active → at_risk → inactive → archived`. Un salto inválido
    responde `LP-MEMB-422-002`.
  - Dados `debtor` y `suspended`, cuando se evalúan, entonces son flags transversales, no estados:
    un miembro puede estar `active` y `debtor` a la vez.
  - Dado un documento repetido dentro del mismo tenant, cuando se da de alta, entonces responde
    `LP-MEMB-409-001` (índice único sparse `{ tenantId, docId }`).
  - Dado un menor de edad, cuando se da de alta, entonces exige tutor responsable, y su
    consentimiento es obligatorio antes de poder reservar (§2.1.7).
  - Dadas las notas internas, cuando el staff las escribe, entonces quedan con autor y fecha y
    **nunca** son visibles para el miembro.
  - Dado un miembro archivado, cuando se cuenta el límite del plan, entonces no suma.
- **example:** Micaela, DNI 40.123.456, se da de alta como `trial` en Box Toro. Su contacto de
  emergencia es su hermana. Dos semanas después pasa a `active`. Nunca ve la nota del coach que
  dice "prefiere el turno de la mañana".
- **story-points:** 8
- **depends_on:** F1-01
- **risk:** high
- **test_plan:** Integración del CRUD + aislamiento. Test exhaustivo de la máquina de estados:
  toda transición válida y toda inválida. Test del único sparse por documento. Test del límite de
  plan contando solo activos. Test de que las notas no salen en la respuesta de la WAFM.
- **error-codes:** `LP-MEMB-409-001`, `LP-MEMB-422-002`, `LP-MEMB-404-003`, `LP-MEMB-422-004`
  (menor sin tutor)
- **data-model-impact:** `Member` de §5.2.2. Índices `{ tenantId, status, lastAttendanceAt }` y
  `{ tenantId, docId }` único sparse.

## [ ] F1-04 · Códigos de invitación

- **module:** members
- **description:** El código con el que un atleta asocia su cuenta de la WAFM a un centro (§2.1.7),
  con la expiración, el límite de usos y la revocación que la v1 no definía — un código filtrado
  sin vencimiento se usa para siempre.
- **acceptance-criteria:**
  - Dado un SMU, cuando genera un código por Venue, entonces define su vencimiento y su límite de
    usos.
  - Dado un código válido, cuando un usuario registrado lo usa, entonces queda asociado como
    miembro de ese Venue y el contador de usos sube.
  - Dado un código vencido, agotado o revocado, cuando alguien lo usa, entonces responde
    `LP-MEMB-422-005` sin decir cuál de los tres casos es.
  - Dado un código revocado, cuando se revoca, entonces deja de funcionar de inmediato, sin afectar
    a quienes ya lo usaron.
- **example:** Box Toro genera `TORO-2026` con 50 usos y vencimiento el 31/03. Juan se registra en
  la WAFM, lo ingresa y aparece en el listado de miembros del centro.
- **story-points:** 3
- **depends_on:** F1-03
- **risk:** med
- **test_plan:** Integración + aislamiento. Test de vencimiento con reloj inyectado, de agotamiento
  por límite de usos, de revocación y de uso concurrente del último cupo del código.
- **error-codes:** `LP-MEMB-422-005`
- **data-model-impact:** `InviteCode` de §5.2.2. Índice único `{ tenantId, code }`.

## [ ] F1-05 · Importación masiva por CSV

- **module:** members
- **description:** Migrar el padrón desde Excel o desde un competidor. §2.1.7 lo marca como la
  fricción número 1 para cambiar de plataforma: si importar duele, el centro no migra.
- **acceptance-criteria:**
  - Dado un CSV, cuando se sube, entonces se previsualiza fila por fila con su validación antes de
    escribir nada.
  - Dada una fila inválida, cuando se muestra, entonces indica la columna y el motivo en español, y
    se puede corregir o saltear sin abortar todo el archivo.
  - Dado un documento repetido, cuando se importa, entonces se detecta como duplicado y se ofrece
    actualizar o saltear.
  - Dada una importación confirmada, cuando supera el límite de miembros del plan, entonces se
    bloquea **antes** de escribir, diciendo cuántos entran y cuántos exceden.
  - Dada una importación, cuando termina, entonces deja un resumen (creados, actualizados,
    salteados, con errores) descargable.
- **example:** Box Toro sube 143 socios exportados de una planilla. 4 filas tienen el teléfono vacío
  y 1 el DNI repetido. Corrige las 4, saltea la repetida, importa 142.
- **story-points:** 5
- **depends_on:** F1-03
- **risk:** med
- **test_plan:** Unit del parser y del validador por fila. Integración: import parcial, duplicados,
  límite de plan alcanzado a mitad del archivo. Test de que un archivo con error no escribe nada.
- **error-codes:** `LP-MEMB-422-006` (CSV con formato inválido)
- **data-model-impact:** ninguno nuevo.

## [ ] F1-06 · Ficha 360 del miembro en el DFSM

- **module:** members
- **description:** Una sola pantalla con todo lo del socio (§2.1.7). Es la pantalla más usada del
  DFSM: si obliga a navegar a otras cinco, el producto se siente lento aunque la API sea rápida.
- **acceptance-criteria:**
  - Dada la ficha, cuando se abre, entonces muestra datos personales, estado de cuenta y deuda,
    contratos activos con créditos restantes, próximas reservas, asistencia de los últimos 90 días,
    waivers firmados y notas internas.
  - Dada la ficha, cuando el usuario es `coach`, entonces no ve el estado de cuenta ni la deuda
    (§2.1.12: las métricas de negocio son del manager).
  - Dada la ficha, cuando carga, entonces muestra skeletons por sección; cada sección falla de forma
    independiente sin tumbar la pantalla.
  - Dada la ficha, cuando no hay datos en una sección, entonces muestra su estado vacío con acción
    ("Sin contratos → Vender un pack").
  - Dada la ficha, cuando se prueba a 360, 768 y 1440 px en dark y light, entonces es usable en las
    seis combinaciones.
- **example:** Braian abre la ficha de Micaela desde el buscador. Ve que le quedan 3 clases que
  vencen el 15/03, que debe $12.000 y que no viene hace 9 días. Le vende un pack sin salir.
- **story-points:** 8
- **depends_on:** F1-03, F1-09, F1-12
- **risk:** med
- **test_plan:** Componentes con MSW: estados de carga, vacío y error por sección. Test de que el
  `coach` no recibe los datos de deuda **desde la API**, no solo que no los pinta. Auditoría axe.
- **error-codes:** ninguno nuevo
- **data-model-impact:** ninguno nuevo.

## [ ] F1-07 · Módulo Products

- **module:** products
- **description:** El catálogo vendible que absorbe y generaliza a Packs (§2.1.17). Sin membresía
  mensual, el gimnasio y el estudio de pilates quedan afuera del producto.
- **acceptance-criteria:**
  - Dado el catálogo, cuando se define un producto, entonces soporta los 7 tipos de §2.1.17:
    `class_pack`, `membership_unlimited`, `membership_limited`, `drop_in`, `trial`,
    `personal_training` y `event`.
  - Dado un producto, cuando se configura, entonces define precio en centavos + moneda (nunca
    float), vigencia, categorías habilitadas, franja horaria habilitada, Venues habilitados,
    visibilidad en la WAFM, auto-renovación y cupo máximo de ventas.
  - Dado un `trial`, cuando un miembro ya usó uno, entonces no puede comprar otro: es 1 sola vez
    por persona (`LP-PROD-409-002`).
  - Dado un producto con ventas, cuando se edita el precio, entonces los contratos ya vendidos
    conservan su `priceSnapshotCents`.
  - Dado un producto, cuando se archiva, entonces deja de venderse pero los contratos vivos siguen
    funcionando.
- **example:** Box Toro publica "Pack 8 clases · 30 días · $60.000" (`class_pack`), "Libre mensual ·
  $85.000" (`membership_unlimited`) y "Clase suelta · $9.000" (`drop_in`). El pack matutino solo
  vale de 6 a 12 h.
- **story-points:** 5
- **depends_on:** F1-01
- **risk:** med
- **test_plan:** Integración del CRUD + aislamiento. Test por tipo de producto. Test del trial único
  por persona. Test de que el dinero es entero en centavos en toda la ruta.
- **error-codes:** `LP-PROD-422-001`, `LP-PROD-409-002`, `LP-PROD-404-003`
- **data-model-impact:** `Product` de §5.2.2. Índice `{ tenantId, active, type }`.

## [ ] F1-08 · Módulo Contracts

- **module:** contracts
- **description:** La instancia comprada por un miembro, con su máquina de estados y sus créditos.
  Acá vive la regla más delicada del producto: el orden de consumo cuando hay varios contratos
  activos (§2.1.9).
- **acceptance-criteria:**
  - Dado un producto y un miembro, cuando el staff vende, entonces se crea el `Contract` con
    `priceSnapshotCents`, `creditsTotal`, `startsAt` y `endsAt` calculados en la TZ del Venue.
  - Dado un contrato, cuando cambia de estado, entonces lo hace solo por transición validada (§14):
    `pending_payment → active → frozen | expired | exhausted | cancelled`.
  - Dado un miembro con varios contratos activos, cuando consume un crédito, entonces se elige
    **FIFO por vencimiento más próximo**, y entre iguales, el de categoría más específica. El
    resultado es determinista y explicable al miembro.
  - Dado un contrato sin créditos, cuando se intenta consumir, entonces responde `LP-CTRT-402-001`.
  - Dado un contrato vencido, cuando se intenta consumir, entonces responde `LP-CTRT-402-002` con
    la fecha en el mensaje.
  - Dada una clase de una categoría no habilitada, cuando se intenta usar el contrato, entonces
    responde `LP-CTRT-422-003`.
  - Dado el consumo, cuando ocurre, entonces `creditsUsed <= creditsTotal` queda garantizado por el
    `findOneAndUpdate` con `$expr` de §5.2.4, **en una sola operación**, nunca en dos pasos.
  - Dado un ajuste manual del staff, cuando se aplica, entonces exige motivo y queda en `AuditLog`.
- **example:** Micaela tiene un pack de 8 que vence el 15/03 y uno de 4 que vence el 30/03. Reserva
  una clase: se descuenta del que vence el 15/03. La WAFM se lo dice explícitamente.
- **story-points:** 8
- **depends_on:** F1-07, F1-03
- **risk:** high
- **test_plan:** Unit del selector FIFO con empates y categorías. Integración del consumo atómico:
  N consumos simultáneos sobre 1 crédito → exactamente 1 gana. Máquina de estados completa.
  Aislamiento. Cobertura mínima 95%.
- **error-codes:** `LP-CTRT-422-004` (transición de estado inválida), `LP-CTRT-404-005`
- **data-model-impact:** `Contract` de §5.2.2. Índice `{ tenantId, memberId, status, endsAt }`.

## [ ] F1-09 · Congelamiento y vencimiento de contratos

- **module:** contracts
- **description:** El freeze por vacaciones o lesión (§2.1.9: muy pedida y ausente en la v1) y el
  job diario que expira, avisa y ofrece renovar. Los avisos de vencimiento son ingreso directo.
- **acceptance-criteria:**
  - Dado un contrato activo, cuando el staff lo congela, entonces la fecha de vencimiento se corre
    por la cantidad de días congelados, respetando el máximo anual configurable.
  - Dado un contrato que se congela, cuando se aplica, entonces se cancelan **todas** sus reservas
    futuras, se devuelven esos créditos y el miembro sale de las waitlists (§2.1.9).
  - Dado el job `expireContracts`, cuando corre, entonces pasa a `expired` los vencidos y libera sus
    reservas futuras.
  - Dado el job `notifyExpiring`, cuando corre, entonces avisa 7, 3 y 1 día antes con CTA de
    renovación, y no avisa dos veces por el mismo hito.
  - Dado un vencimiento a "30 días", cuando se calcula, entonces usa la TZ del Venue y sobrevive a
    un cambio de horario de verano: 30 días son 30 días, no 30×24 h.
- **example:** Micaela se va de vacaciones 10 días. El staff congela su pack: vence el 25/03 en vez
  del 15/03, sus 2 reservas de esa semana se cancelan y recupera los 2 créditos.
- **story-points:** 5
- **depends_on:** F1-08, F0-08
- **risk:** high
- **test_plan:** **Test de vencimientos cruzando TZ y DST** (§Testing.6, obligatorio). Test del
  freeze: corrimiento de fecha, cancelación de futuras, devolución de créditos, salida de waitlist.
  Test de idempotencia de ambos jobs. Test del máximo anual de días.
- **error-codes:** `LP-CTRT-422-006` (máximo de días de freeze superado)
- **data-model-impact:** `Contract.freeze { days, from, to }`, `Contract.freezeDaysUsedThisYear`.

## [ ] F1-10 · Billing: cargos, pagos manuales y estado de cuenta

- **module:** billing
- **description:** El gap más grave de la v1 (§2.1.16): el dinero entre el centro y sus socios.
  Fase 1 cubre el registro manual — efectivo, transferencia, POS — que es como cobra hoy la mayoría
  de los centros de Bahía Blanca.
- **acceptance-criteria:**
  - Dada una venta, cuando se registra, entonces genera un `Charge` con monto en centavos,
    vencimiento y estado `pending`.
  - Dado un pago, cuando el staff lo registra, entonces guarda método, monto, fecha, comprobante y
    **quién** lo registró, y salda uno o varios cargos.
  - Dado un `Idempotency-Key` repetido, cuando llega el mismo pago dos veces, entonces se registra
    una sola vez y responde `LP-BILL-409-002` (§5.0: idempotencia obligatoria en pagos).
  - Dado un miembro, cuando se abre su estado de cuenta, entonces muestra cargos, pagos, saldo y
    deuda vencida, en orden cronológico.
  - Dado un `Payment`, cuando se quiere anular, entonces **nunca se borra**: se anula con un
    `Refund` con motivo obligatorio (§5.2.4).
  - Dado un pago parcial, cuando se registra, entonces el saldo refleja la diferencia y el cargo
    sigue `pending`.
- **example:** Micaela paga $60.000 en efectivo por su pack. Braian lo registra: el cargo pasa a
  `paid`, el saldo queda en cero y la caja del día suma $60.000 en efectivo.
- **story-points:** 8
- **depends_on:** F1-08
- **risk:** high
- **test_plan:** Integración + aislamiento. **Test de idempotencia**: el mismo pago 3 veces → 1 solo
  registro (§Testing.3). Test de pago parcial y de pago que salda varios cargos. Test de que ningún
  camino borra un `Payment`. Test de que el dinero es entero en centavos de punta a punta.
  Cobertura mínima 95%.
- **error-codes:** `LP-BILL-422-003`, `LP-BILL-404-004`, `LP-BILL-409-005` (reembolso mayor al pago)
- **data-model-impact:** `Charge`, `Payment`, `Refund` de §5.2.2. Índice único
  `{ tenantId, idempotencyKey }` en `Payment`.

## [ ] F1-11 · Billing: mora, caja diaria y reembolsos

- **module:** billing
- **description:** La morosidad es el KPI número 1 del mercado argentino (§2.1.12). El pasaje a mora
  tiene que ser automático: si hay que calcularlo a mano, no se calcula.
- **acceptance-criteria:**
  - Dado un cargo vencido y no pagado, cuando corre el job `dunning`, entonces pasa a `overdue`, el
    miembro toma el flag `debtor` y se dispara el aviso configurado.
  - Dado un miembro `debtor`, cuando el Venue tiene `allowDebt: false` (default de ADR-004), entonces
    su reserva se rechaza con `LP-BOOK-403-005`; con `allowDebt: true`, se permite.
  - Dado el estado de un socio, cuando se consulta, entonces es visible en tiempo real: al día, en
    mora, inactivo o pendiente (§2.1.16).
  - Dada la caja diaria de un Venue, cuando se abre, entonces muestra ingresos del día por método de
    pago, con arqueo y exportación a CSV.
  - Dado un reembolso, cuando se registra, entonces exige motivo, nunca supera el monto del pago
    original y queda en `AuditLog`.
- **example:** El 1º de marzo vence la cuota de 12 socios. El job los pasa a `overdue`, les manda el
  aviso y los deja en el panel de deudores del DFSM. Ninguno puede reservar hasta regularizar.
- **story-points:** 5
- **depends_on:** F1-10
- **risk:** high
- **test_plan:** Test del job de mora con reloj inyectado e idempotente. Test de la interacción
  mora × reserva con `allowDebt` en ambos valores. Test del arqueo de caja contra pagos sembrados.
  Cobertura mínima 95%.
- **error-codes:** `LP-BILL-402-006` (miembro en mora, acción bloqueada)
- **data-model-impact:** `Charge.status = overdue`, `Member.flags.debtor`.

## [ ] F1-12 · Schedule: plantillas y materialización de sesiones

- **module:** schedule
- **description:** La agenda del centro (§2.1.5.a): plantillas recurrentes tipo RRULE y sesiones
  concretas materializadas por un job en una ventana de 60 días.
- **acceptance-criteria:**
  - Dada una `ClassTemplate`, cuando se crea, entonces define nombre, categoría, duración, capacidad
    por default, coach, sala, regla de recurrencia y vigencia desde/hasta.
  - Dado el job `materializeSessions`, cuando corre, entonces genera las `ClassSession` futuras
    dentro de la ventana de 60 días, **sin duplicar** las que ya existen.
  - Dada una sesión materializada, cuando se crea, entonces hereda capacidad y coach de la
    plantilla, y ambos se pueden sobreescribir por sesión.
  - Dada una recurrencia que cruza un cambio de horario de verano, cuando se materializa, entonces
    la clase de las 7:00 sigue siendo a las 7:00 locales.
  - Dadas dos sesiones en la misma sala y el mismo horario, cuando se intenta crear la segunda,
    entonces responde `LP-SCHD-409-003`.
  - Dada la agenda, cuando se consulta, entonces se puede ver por día, semana y mes, y en vista
    horizontal por sala cuando hay más de una (§2.1.5.f).
- **example:** Box Toro define "Funcional · Lunes a viernes 7:00 · Principal · 16 lugares". El job
  materializa 43 sesiones para los próximos 60 días. La del feriado se cancela aparte.
- **story-points:** 8
- **depends_on:** F1-02, F0-08
- **risk:** high
- **test_plan:** Unit del expansor de RRULE cruzando DST. Test de idempotencia del job: correrlo
  dos veces no duplica sesiones. Test de colisión de sala. Integración + aislamiento.
- **error-codes:** `LP-SCHD-422-004` (recurrencia inválida), `LP-SCHD-409-003` (sala ocupada)
- **data-model-impact:** `ClassTemplate` y `ClassSession` de §5.2.2. Índice
  `{ tenantId, venueId, startAt }`.

## [ ] F1-13 · Schedule: edición, excepciones y cancelación de clase

- **module:** schedule
- **description:** El comportamiento tipo Google Calendar de §2.1.5.a — "solo esta / esta y
  futuras" — más los feriados, los cierres y la cancelación con devolución automática.
- **acceptance-criteria:**
  - Dada una sesión, cuando se edita, entonces afecta **solo a esa sesión**.
  - Dada una plantilla, cuando se edita, entonces ofrece "solo esta" o "esta y futuras", y las
    sesiones pasadas nunca se tocan.
  - Dado un feriado o un cierre, cuando se declara, entonces las sesiones de ese rango se cancelan
    en bloque.
  - Dada una clase cancelada por el centro, cuando se confirma, entonces **en la misma transacción**
    se cancelan sus reservas, se devuelven los créditos y se notifica a todos los inscriptos
    (§2.1.9 y §5.2.4).
  - Dado un cambio de coach, cuando se aplica, entonces se notifica a los inscriptos (§2.1.5.f).
  - Dada la duplicación de una semana, cuando se ejecuta, entonces copia el horario a otra semana
    respetando feriados.
- **example:** Se corta la luz. Braian cancela las 4 clases del día: los 38 inscriptos recuperan su
  crédito y reciben el aviso, todo en una sola operación.
- **story-points:** 5
- **depends_on:** F1-12
- **risk:** high
- **test_plan:** Test transaccional de la cancelación: si falla la devolución, no se cancela nada.
  Test de "esta y futuras" verificando que las pasadas quedan intactas. Test de duplicación de
  semana con feriado en el medio.
- **error-codes:** `LP-SCHD-422-005` (cancelar una sesión ya terminada)
- **data-model-impact:** `ClassSession.status`, `VenueClosure { tenantId, venueId, from, to, reason }`.

## [ ] F1-14 · Booking: reserva atómica con descuento de crédito

- **module:** booking
- **description:** El corazón del producto y su condición de carrera clásica: dos personas tomando
  el último lugar a las 6:00 AM. La reserva y el descuento de crédito ocurren **en una sola
  operación atómica** (§2.1.5.e, ADR-001).
- **acceptance-criteria:**
  - Dada una sesión con cupo, cuando un miembro reserva, entonces el `bookedCount` sube y se
    descuenta 1 crédito **en la misma operación**; si algo falla después, se compensa.
  - Dadas N peticiones simultáneas sobre 1 solo cupo, cuando se procesan, entonces se crea
    **exactamente una** `Booking` y el resto va a waitlist. Nunca hay sobreventa.
  - Dado un miembro que ya reservó esa sesión, cuando reserva de nuevo, entonces responde
    `LP-BOOK-409-001`; el índice único `{ tenantId, sessionId, memberId }` es el último cinturón.
  - Dada una sesión completa, cuando alguien reserva, entonces responde `LP-BOOK-409-002` con el
    `action` que ofrece la lista de espera.
  - Dado un miembro sin contrato válido, cuando reserva, entonces responde `LP-CTRT-402-001` o
    `LP-CTRT-402-002` según el caso.
  - Dado un `Idempotency-Key`, cuando la misma reserva llega dos veces, entonces se crea una sola
    (§5.0).
  - Dada la reserva, cuando se confirma, entonces emite `booking.created`.
- **example:** 6:00 AM, quedan 1 lugar y 5 personas tocan "Reservar" en el mismo segundo. Una entra;
  las otras cuatro ven "La clase está completa. Podés sumarte a la lista de espera" y quedan
  primeras en la fila.
- **story-points:** 8
- **depends_on:** F1-12, F1-08
- **risk:** high
- **test_plan:** **Test de concurrencia obligatorio** (§Testing.2): 50 reservas paralelas sobre 1
  cupo → 1 booking, 49 en waitlist, `bookedCount === capacity`. Test de idempotencia. Test de
  compensación cuando la creación falla después del descuento. Aislamiento. Cobertura 95%.
- **error-codes:** `LP-BOOK-403-005` (miembro en mora, ADR-004), `LP-BOOK-404-006`
- **data-model-impact:** `Booking` de §5.2.2. Índice **único** `{ tenantId, sessionId, memberId }`.
  `ClassSession.bookedCount`.

## [ ] F1-15 · Booking: ventanas de tiempo y devolución de crédito

- **module:** booking
- **description:** Las cinco ventanas configurables de §2.1.5.c y la matriz completa de devolución
  de crédito de §2.1.9. Es donde se define si el producto se siente justo o arbitrario.
- **acceptance-criteria:**
  - Dada una sesión fuera de la ventana de apertura, cuando alguien reserva, entonces responde
    `LP-BOOK-422-003`.
  - Dada una sesión pasado el `bookingClosesAt`, cuando alguien reserva, entonces se rechaza.
  - Dada una cancelación **dentro** del plazo, cuando se ejecuta, entonces el crédito **se devuelve**
    y el cupo se libera en la misma operación atómica.
  - Dada una cancelación **fuera** de plazo (late cancel), cuando se ejecuta, entonces el crédito no
    se devuelve y responde `LP-BOOK-422-004` explicándolo.
  - Dada la política, cuando el miembro está por reservar, entonces el texto de la política de
    cancelación **se le muestra antes de confirmar** (§2.1.5.d).
  - Dadas las 8 filas de la tabla de §2.1.9, cuando se ejercitan una por una, entonces cada una da
    exactamente el efecto declarado sobre el crédito.
- **example:** Micaela reserva para las 19:00. A las 18:30, con `cancelCutoff` de 2 h, cancela: el
  crédito no vuelve y la app se lo avisó antes de que confirmara la reserva.
- **story-points:** 5
- **depends_on:** F1-14
- **risk:** high
- **test_plan:** **La matriz completa de consumo de crédito** (§Testing.5), un test por fila:
  reserva, cancel en plazo, late cancel, no-show, clase cancelada, freeze, walk-in, ajuste manual.
  Test de las 5 ventanas con reloj inyectado y TZ del Venue.
- **error-codes:** ninguno nuevo
- **data-model-impact:** `Booking.creditConsumed`, `Booking.cancelledAt`.

## [ ] F1-16 · Waitlist con promoción automática

- **module:** booking
- **description:** La lista de espera de §2.1.5.b: FIFO, con ventana de confirmación y promoción
  **automática**, sin que nadie del staff tenga que intervenir.
- **acceptance-criteria:**
  - Dada una sesión completa, cuando alguien se anota en espera, entonces recibe una posición FIFO;
    la lista tiene tamaño máximo.
  - Dada una cancelación que libera cupo, cuando ocurre, entonces se promueve al primero de la
    lista de forma automática y se le notifica.
  - Dado un promovido, cuando no confirma dentro de la ventana (ej: 15 min), entonces pasa al
    siguiente; el job `expireWaitlistHolds` corre cada minuto.
  - Dado el `waitlistPromotionCutoff`, cuando falta menos que eso para el inicio, entonces ya no se
    promueve a nadie.
  - Dado un promovido que confirma, cuando confirma, entonces se le descuenta el crédito igual que
    en una reserva normal.
  - Dado un miembro en espera, cuando congela su contrato o se da de baja, entonces sale de todas
    las listas.
  - Dada la conversión de waitlist, cuando se calcula, entonces queda como métrica: indica si falta
    oferta en ese horario.
- **example:** Se libera un lugar a las 18:10 para la clase de las 19:00. Juan, primero en la lista,
  recibe el aviso y tiene 15 minutos. No contesta: a las 18:25 pasa a Lucía, que confirma.
- **story-points:** 8
- **depends_on:** F1-14
- **risk:** high
- **test_plan:** Test de orden FIFO estricto. Test de la ventana de confirmación con reloj
  inyectado. Test de promoción concurrente (2 cancelaciones simultáneas no promueven a la misma
  persona dos veces). Test del cutoff. Cobertura 95%.
- **error-codes:** `LP-BOOK-409-007` (ya está en la lista), `LP-BOOK-422-008` (lista llena),
  `LP-BOOK-422-009` (confirmación vencida)
- **data-model-impact:** `Booking.status = waitlisted`, `Booking.waitlistPosition`,
  `Booking.holdExpiresAt`. `ClassSession.waitlistCount`.

## [ ] F1-17 · No-show y política de penalización

- **module:** booking
- **description:** El job que marca no-show pasada la ventana de check-in y aplica la penalización
  configurable (§2.1.5.d), que es la práctica estándar del sector.
- **acceptance-criteria:**
  - Dada una reserva sin check-in, cuando pasa la ventana y corre el job `markNoShows`, entonces
    queda en `no_show` y el crédito **no** se devuelve.
  - Dados N no-shows en el período configurado, cuando se supera el umbral, entonces el miembro
    queda con reservas bloqueadas por el tiempo configurado.
  - Dado un miembro bloqueado por no-shows, cuando intenta reservar, entonces responde
    `LP-BOOK-403-010` diciendo hasta cuándo.
  - Dado el job, cuando corre dos veces sobre la misma hora, entonces no marca dos veces ni
    duplica penalizaciones.
  - Dada la política, cuando el centro la desactiva, entonces se marca el no-show igual pero no se
    penaliza: la métrica se mide siempre.
- **example:** Juan reserva y no va, tres veces en un mes. Box Toro tiene la política en 3 no-shows
  → 48 h sin reservar. Al tercero queda bloqueado hasta el jueves y se le explica por qué.
- **story-points:** 3
- **depends_on:** F1-14, F0-08
- **risk:** med
- **test_plan:** Test del job idempotente con reloj inyectado. Test del umbral: N-1 no penaliza, N
  sí. Test con la política desactivada.
- **error-codes:** `LP-BOOK-403-010`
- **data-model-impact:** `Member.noShowCount`, `Member.bookingBlockedUntil`.

## [ ] F1-18 · Attendance: check-in manual y lista de clase del coach

- **module:** attendance
- **description:** La pantalla que el coach usa de pie, con una mano, en el piso del box (§5.1.2).
  Si no funciona perfecto en un teléfono, no se usa.
- **acceptance-criteria:**
  - Dada una sesión, cuando el coach abre su lista, entonces ve inscriptos, presentes, lista de
    espera y las alertas que le corresponden.
  - Dado un inscripto, cuando el coach lo marca presente, entonces se registra `checkedInAt`,
    `method: 'staff'` y quién lo hizo.
  - Dada la lista, cuando el coach quiere, entonces puede marcar a todos presentes de un toque.
  - Dado un check-in, cuando se valida, entonces exige contrato vigente, crédito disponible, waiver
    firmado y, si el Venue lo pide, estar sin deuda (§2.1.18).
  - Dado un check-in fuera de la `checkInWindow`, cuando se intenta, entonces responde
    `LP-ATTD-422-002`.
  - Dada la pantalla en un teléfono de 360 px, cuando se usa, entonces cada acción es alcanzable
    con el pulgar y los targets son ≥ 44 px.
- **example:** 7:00, clase de Funcional. Lucía abre la lista en su teléfono, ve 14 inscriptos, toca
  "Todos presentes" y corrige los 2 que faltaron. Tardó 8 segundos.
- **story-points:** 5
- **depends_on:** F1-14
- **risk:** med
- **test_plan:** Integración de las 4 validaciones de check-in, cada una por separado. Test de la
  ventana de check-in. Test del marcado masivo. Aislamiento. Auditoría axe y prueba a 360 px.
- **error-codes:** `LP-ATTD-409-001` (ya tiene check-in), `LP-ATTD-422-002` (fuera de ventana),
  `LP-ATTD-403-003` (waiver faltante)
- **data-model-impact:** `Booking.checkedInAt`, `Booking.checkInMethod`, `Booking.checkedInBy`.

## [ ] F1-19 · Attendance: QR con token rotativo y walk-in

- **module:** attendance
- **description:** El QR de la WAFM que abre la puerta (§2.1.18), con token de vida corta para que
  una captura de pantalla compartida no sirva. Más el walk-in: el único camino donde el crédito se
  consume en el check-in y no al reservar (ADR-001).
- **acceptance-criteria:**
  - Dado un miembro, cuando abre "Mi QR", entonces ve un código con token rotativo de vida corta,
    accesible **en 1 tap** desde el home de la WAFM.
  - Dado un token vencido o ya usado, cuando se escanea, entonces responde `LP-ATTD-422-004`.
  - Dado un escaneo válido dentro de la ventana, cuando se procesa, entonces registra el check-in
    con `method: 'self'` y las mismas 4 validaciones de F1-18.
  - Dado un walk-in sin reserva, cuando el staff lo registra, entonces **se descuenta el crédito en
    el check-in**, no antes.
  - Dado un `Idempotency-Key`, cuando el mismo check-in llega dos veces, entonces se registra una
    sola vez (§5.0).
  - Dado el kiosko sin red, cuando se hace un check-in, entonces se encola local y se sincroniza al
    volver la conexión.
- **example:** Micaela llega, abre la WAFM, toca "Mi QR" y lo pasa por la tablet de la puerta. El
  token vale 30 segundos: la captura que le mandó a su amiga por WhatsApp no sirve.
- **story-points:** 5
- **depends_on:** F1-18
- **risk:** high
- **test_plan:** Test del ciclo de vida del token: válido, vencido, reusado. Test de idempotencia
  del check-in. **Test del walk-in descontando en el check-in** (fila 7 de la matriz de §2.1.9).
  Test de la cola offline y su sincronización.
- **error-codes:** `LP-ATTD-422-004` (token inválido o vencido), `LP-ATTD-404-005`
- **data-model-impact:** `CheckInToken { userId, tokenHash, expiresAt, usedAt }` con TTL.

## [ ] F1-20 · Módulo Waivers

- **module:** waivers
- **description:** Deslindes y consentimientos versionados con firma trazable (§2.1.20). Es riesgo
  legal, no una funcionalidad opcional.
- **acceptance-criteria:**
  - Dado un documento legal, cuando se publica, entonces queda versionado con su contenido, su
    fecha y si es obligatorio.
  - Dada una aceptación, cuando ocurre, entonces se guarda timestamp, IP, user agent y **hash del
    texto de esa versión**: hay que poder probar qué firmó exactamente.
  - Dada una versión nueva de un documento obligatorio, cuando se publica, entonces se pide
    re-aceptación a todos.
  - Dado un miembro sin el waiver obligatorio, cuando intenta hacer check-in, entonces se bloquea
    con `LP-ATTD-403-003` — configurable por Venue (§2.1.20).
  - Dado el panel de cumplimiento, cuando se abre, entonces muestra quién firmó qué y cuándo, y se
    exporta.
  - Dado un menor, cuando se registra, entonces el consentimiento del tutor es un documento propio
    y obligatorio.
- **example:** Box Toro publica la v2 de su deslinde. Los 143 socios ven el texto al entrar a la
  WAFM y lo aceptan. Del que no lo acepte queda registro de que sigue en la v1, y no puede hacer
  check-in.
- **story-points:** 5
- **depends_on:** F1-03
- **risk:** high
- **test_plan:** Test de que el hash del contenido se guarda y se puede verificar contra el texto.
  Test de re-aceptación al publicar versión nueva. Test del bloqueo de check-in con el flag en
  ambos valores. Aislamiento (los documentos globales son de solo lectura para el tenant).
- **error-codes:** `LP-HLTH-403-002` (documento obligatorio sin aceptar)
- **data-model-impact:** `LegalDocument` y `Consent` de §5.2.2.

## [ ] F1-21 · Notifications: motor in-app y email transaccional

- **module:** notifications
- **description:** El motor de §2.1.14 para los canales de Fase 1: in-app y email. Con cola,
  reintentos, deduplicación, ventana horaria y registro de entregas — "no me llegó el aviso" tiene
  que ser una pregunta contestable.
- **acceptance-criteria:**
  - Dado un evento de dominio, cuando se emite, entonces Notifications se suscribe y encola el
    envío, **sin acoplarse** al flujo que lo originó.
  - Dado un envío fallido, cuando falla, entonces se reintenta con backoff y, agotados los intentos,
    queda en la cola de fallidos, visible para soporte.
  - Dada una notificación duplicada, cuando se encola, entonces se deduplica por clave de evento.
  - Dada la ventana horaria, cuando el envío caería a las 3 AM, entonces se difiere hasta la ventana
    permitida.
  - Dadas las preferencias del usuario, cuando se respeta el opt-out por canal, entonces no se
    envía — salvo avisos críticos de facturación (§2.1.14).
  - Dada una plantilla, cuando el SMU la edita, entonces puede usar variables (`{{nombre}}`,
    `{{clase}}`, `{{hora}}`) y la vista previa las resuelve.
  - Dado un envío, cuando ocurre, entonces queda registrado con su estado para soporte.
- **example:** Micaela reserva. `booking.created` encola su confirmación por email e in-app. El
  proveedor de mail está caído: se reintenta a los 30 s, a los 2 min y a los 10 min. Entra al
  segundo intento.
- **story-points:** 8
- **depends_on:** F0-06, F0-08
- **risk:** med
- **test_plan:** Test de la cola: reintento con backoff, dedupe, ventana horaria, cola de fallidos.
  Test de que un fallo de envío nunca rompe el flujo que lo originó. Test de opt-out y de la
  excepción de facturación. El proveedor de mail se inyecta como puerto: ningún test manda un mail.
- **error-codes:** `LP-NOTF-500-001` (envío fallido tras reintentos), `LP-NOTF-422-002`
- **data-model-impact:** `Notification` de §5.2.2, `NotificationTemplate`,
  `NotificationPreference { userId, channel, eventType, enabled }`.

## [ ] F1-22 · Las notificaciones transaccionales del MVP

- **module:** notifications
- **description:** Las automáticas de §2.1.14 que cubre Fase 1. Sin estas, el motor no le sirve a
  nadie.
- **acceptance-criteria:**
  - Dado el flujo de reserva, cuando se confirma, entonces sale la confirmación.
  - Dado el job `classReminders`, cuando corre, entonces manda el recordatorio 24 h y 1 h antes,
    una sola vez por hito.
  - Dada una promoción desde waitlist, cuando ocurre, entonces avisa con el plazo de confirmación.
  - Dada una clase cancelada o un cambio de coach, cuando pasa, entonces avisa a los inscriptos.
  - Dado un pack por vencer, cuando faltan 7, 3 o 1 días, entonces avisa con CTA de renovación.
  - Dado un pago recibido o una deuda vencida, cuando ocurre, entonces avisa.
  - Dada cualquiera de estas, cuando se dispara, entonces respeta las preferencias y la ventana
    horaria de F1-21.
- **example:** 18:00. A los 14 inscriptos de la clase de las 19:00 les llega "Tu clase de Funcional
  es en 1 hora". A los que la desactivaron, no.
- **story-points:** 5
- **depends_on:** F1-21, F1-14
- **risk:** low
- **test_plan:** Un test por notificación: que se dispare con el evento correcto, una sola vez, con
  las variables resueltas. Test de idempotencia de `classReminders`.
- **error-codes:** ninguno nuevo
- **data-model-impact:** ninguno nuevo.

## [ ] F1-23 · MetricsDaily y KPIs básicos

- **module:** metrics
- **description:** Los agregados diarios precalculados de §2.1.12. Calcular KPIs con agregaciones en
  vivo sobre colecciones grandes es la causa número 1 de dashboards lentos.
- **acceptance-criteria:**
  - Dado el job `computeMetricsDaily` a las 03:00, cuando corre, entonces precalcula por
    `(tenantId, venueId, fecha)`: miembros activos, asistencias, utilización de clase, tasa de
    no-show, ingresos del día y morosidad.
  - Dado el job, cuando se corre dos veces sobre el mismo día, entonces sobreescribe sin duplicar
    (índice único `{ tenantId, venueId, date }`).
  - Dado un panel de métricas, cuando se consulta, entonces lee de `MetricsDaily`, no agrega en
    vivo.
  - Dado un `coach`, cuando pide métricas de negocio, entonces responde `LP-AUTH-403-002`.
  - Dado un recálculo, cuando se pide para una fecha pasada, entonces se puede reprocesar.
- **example:** El 2 de marzo a las 03:00 el job calcula que el 1º Box Toro tuvo 87 asistencias, 72%
  de utilización, 6% de no-show y $340.000 de ingreso. El panel del DFSM abre al instante.
- **story-points:** 5
- **depends_on:** F0-08
- **risk:** med
- **test_plan:** Test de cada KPI con datos sembrados y resultado esperado calculado a mano. Test
  de idempotencia del job. Test de que el panel no ejecuta agregaciones en vivo. Aislamiento.
- **error-codes:** ninguno nuevo
- **data-model-impact:** `MetricsDaily` de §5.2.2. Índice único `{ tenantId, venueId, date }`.

## [ ] F1-24 · DFSM Home: tablero operativo del día

- **module:** metrics
- **description:** El home del DFSM es un tablero, no un menú (§5.1.2). Y el panel de alertas
  accionables de §2.1.12, que vale más que cualquier gráfico.
- **acceptance-criteria:**
  - Dado el home, cuando se abre, entonces muestra las clases de hoy con su ocupación, los check-ins
    en vivo, los cobros del día y el panel de alertas.
  - Dadas las alertas, cuando se calculan, entonces incluyen: miembros sin asistir hace 14 días,
    contratos que vencen en 7 días, deudores, clases con baja ocupación esta semana y atletas sin
    waiver firmado.
  - Dada una alerta, cuando se toca, entonces lleva a la acción que la resuelve en un click
    (contactar, cobrar, renovar).
  - Dadas las acciones rápidas, cuando se usan, entonces permiten cobrar, agregar miembro, vender
    pack y marcar asistencia sin salir del home.
  - Dado el buscador global, cuando se usa, entonces encuentra un miembro por nombre, documento o
    teléfono, con atajo de teclado.
  - Dado un `coach`, cuando abre el home, entonces ve el tablero operativo **sin** los cobros ni la
    morosidad.
- **example:** Braian abre el DFSM a las 8:00. Ve 6 clases hoy (una con 3 de 16), 4 deudores, 2
  packs que vencen esta semana y 5 socios que no vienen hace dos semanas. Toca el primero y le
  manda un WhatsApp.
- **story-points:** 8
- **depends_on:** F1-23, F1-14
- **risk:** med
- **test_plan:** Componentes con MSW: carga, vacío y error por panel. Test de que la API no devuelve
  datos de cobro a un `coach`. Test del buscador. Auditoría axe, prueba a 360/768/1440 en dark y
  light.
- **error-codes:** ninguno nuevo
- **data-model-impact:** ninguno nuevo.

## [ ] F1-25 · Suscriptors y Suscriptions: signup self-service y planes

- **module:** susc
- **description:** El alta del suscriptor desde la landing con trial de 14 días sin tarjeta
  (ADR-004), y los planes con precio versionado. El alta manual del SAU queda como excepción, no
  como camino principal (§2.1.3).
- **acceptance-criteria:**
  - Dado un visitante de la landing, cuando se registra, entonces crea su `Organization` en estado
    `trial` con `trialEndsAt` a 14 días, sin pedir tarjeta.
  - Dado un trial vencido sin plan pago, cuando corre el job, entonces la organización pasa a
    `suspended` con los datos **preservados**: nunca se borra por falta de pago (§2.1.3).
  - Dado el estado del suscriptor, cuando cambia, entonces lo hace por transición validada (§14):
    `trial | active | past_due | suspended | cancelled | blocked`.
  - Dado un plan, cuando el SAU cambia su precio, entonces los suscriptores existentes conservan su
    `priceSnapshotCents` (grandfathering, §2.1.4).
  - Dado un upgrade, cuando se aplica, entonces es inmediato con prorrateo; el downgrade es al fin
    del ciclo y valida límites antes (F0-07).
  - Dados los datos fiscales, cuando se cargan, entonces incluyen CUIT, razón social y condición de
    IVA.
  - Dada una impersonación del SAU, cuando ocurre, entonces exige motivo, es temporal, queda en
    `AuditLog` y se le notifica al SMU (§2.1.3, ADR-004).
- **example:** El dueño de un box entra a la landing, se registra y a los 3 minutos está creando su
  primera clase. A los 14 días, si no eligió plan, su cuenta se suspende pero sus 40 socios y su
  agenda siguen ahí.
- **story-points:** 8
- **depends_on:** F0-07
- **risk:** high
- **test_plan:** Máquina de estados completa del suscriptor. Test del cálculo de `trialEndsAt`
  cruzando TZ. Test del grandfathering: cambiar el precio del plan no cambia lo que paga un
  suscriptor existente. Test de la impersonación auditada. Cobertura 95%.
- **error-codes:** `LP-SUSC-422-001`, `LP-SUSC-409-002`, `LP-SUBS-422-001` (cambio de plan
  inválido), `LP-SUSC-403-003` (impersonación sin motivo)
- **data-model-impact:** `Organization` completa de §5.2.2, `Plan`, `Subscription` con
  `priceSnapshotCents`.

## [ ] F1-26 · Landing completa

- **module:** landing
- **description:** Las nueve secciones de §5.1.4 más lo que agrega el `[+]`: CTA de prueba gratis,
  comparativa contra Excel + WhatsApp (el competidor real), sección de seguridad y privacidad, y
  las páginas legales.
- **acceptance-criteria:**
  - Dada la landing, cuando se recorre, entonces tiene banner, descripción, funcionalidades,
    testimonios en carousel, imágenes de las interfaces, precios, FAQ, redes y formulario de
    contacto.
  - Dado el header, cuando se usa, entonces navega a las secciones y da acceso al DFSM y a la WAFM.
  - Dado el scroll, cuando el usuario baja, entonces el botón de volver arriba está visible siempre
    y hace scroll suave.
  - Dado el CTA principal, cuando se toca, entonces arranca la **prueba gratis de 14 días sin
    tarjeta** y conecta con F1-25.
  - Dado el formulario de contacto, cuando se envía, entonces valida con el Zod compartido, se
    protege contra bots y crea el `Lead`.
  - Dadas las páginas legales, cuando se publican, entonces incluyen términos, privacidad y el
    acuerdo de tratamiento de datos (§9.3).
  - Dada la landing, cuando se audita, entonces cumple WCAG 2.2 AA y funciona a 360/768/1440 px en
    dark y light.
- **example:** Alguien llega desde una búsqueda, lee los precios en pesos, compara contra "gestionar
  con Excel y WhatsApp", y arranca el trial sin sacar la tarjeta.
- **story-points:** 8
- **depends_on:** F0-14, F1-25
- **risk:** low
- **test_plan:** Test del HTML generado por sección. Test del formulario con el schema compartido.
  Lighthouse CI (SEO ≥ 95, accesibilidad ≥ 95). Auditoría axe.
- **error-codes:** `LP-CRM-422-001` (formulario inválido)
- **data-model-impact:** `Lead` de §5.2.2 (solo la captura; el pipeline completo es Fase 4).

## [ ] F1-27 · DFSA mínimo

- **module:** susc
- **description:** Lo que el SAU necesita para operar el SaaS en Fase 1 (§5.1.1): suscriptores,
  planes, salud del sistema y el buscador de soporte que la spec pide en §11.3.
- **acceptance-criteria:**
  - Dado el DFSA, cuando entra el SAU, entonces ve el listado de suscriptores con su plan, su estado
    y su uso contra los límites.
  - Dado un suscriptor, cuando el SAU cambia su estado, entonces lo hace por transición validada y
    queda en `AuditLog`.
  - Dados los planes, cuando el SAU los edita, entonces cambia nombre, precio, descripción y qué
    incluye, sin afectar retroactivamente a los suscriptores existentes.
  - Dado el panel de salud, cuando se abre, entonces muestra errores por código, jobs fallidos y
    webhooks pendientes.
  - Dado un `requestId` o un `errorCode`, cuando el SAU lo busca, entonces ve qué pasó — que es
    exactamente lo que pide §5 cuando dice que el usuario comparta el código con soporte.
  - Dado el SAU, cuando busca, entonces **no** puede ver datos de miembros de un centro (ADR-004,
    decisión 7): solo por impersonación auditada.
- **example:** Un socio de Box Toro le pasa a Braian el código `LP-BOOK-409-002` y el `requestId`.
  Braian lo pega en el DFSA y ve en 5 segundos que la clase estaba llena.
- **story-points:** 5
- **depends_on:** F1-25
- **risk:** med
- **test_plan:** Test de que los endpoints del DFSA no exponen colecciones con `tenantId`. Test del
  buscador por `requestId` y `errorCode`. Test de la auditoría del cambio de estado.
- **error-codes:** ninguno nuevo
- **data-model-impact:** `AuditLog` de §5.2.2. Índice `{ tenantId, at }` + TTL de retención.

## [ ] F1-28 · WAFM: horario, reservar y cancelar

- **module:** schedule
- **description:** Lo que el socio abre todos los días. La meta de §2.0 es que más del 80% de las
  reservas las haga el miembro, no el staff: es exactamente el ahorro de tiempo que se vende.
- **acceptance-criteria:**
  - Dado un miembro, cuando abre la WAFM, entonces ve el horario del centro por día y semana, con
    el cupo disponible de cada clase.
  - Dado un miembro con varios centros, cuando entra, entonces elige cuál con el selector de Venue.
  - Dada una clase con lugar, cuando reserva, entonces la UI responde de forma optimista y, si la
    API falla, revierte con el mensaje del error tipado.
  - Dado el modal de confirmación, cuando se abre, entonces muestra **la política de cancelación**
    antes de que confirme (§2.1.5.d).
  - Dada una clase completa, cuando toca reservar, entonces se le ofrece la lista de espera con su
    posición.
  - Dada una cancelación, cuando la hace, entonces se le dice con claridad si recupera el crédito o
    no, **antes** de confirmar.
  - Dada la WAFM sin red, cuando abre el horario, entonces lo ve cacheado (§5.1.3).
- **example:** Micaela, en el colectivo, abre la WAFM, ve que la de las 19:00 tiene 2 lugares y
  reserva. El botón responde al instante; la confirmación llega por email 3 segundos después.
- **story-points:** 8
- **depends_on:** F1-14, F0-13
- **risk:** med
- **test_plan:** Componentes con MSW: reserva optimista con éxito y con rollback. Test del texto de
  política en el modal. Test del flujo de waitlist. E2E de reservar y cancelar. Auditoría axe,
  prueba a 360 px.
- **error-codes:** ninguno nuevo
- **data-model-impact:** ninguno nuevo.

## [ ] F1-29 · WAFM: mis packs, mi QR y mi perfil

- **module:** contracts
- **description:** Lo que el socio consulta: cuántas clases le quedan, cuándo vencen, su QR de
  acceso y sus datos.
- **acceptance-criteria:**
  - Dado un miembro, cuando abre "Mis packs", entonces ve cada contrato activo con créditos
    restantes, fecha de vencimiento y en qué clases lo puede usar.
  - Dado un pack por vencer, cuando quedan pocos días, entonces se destaca con el aviso y el CTA de
    renovación.
  - Dado el home, cuando se abre, entonces "Mi QR" está a **1 tap** (§5.1.3).
  - Dado el perfil, cuando lo edita, entonces cambia sus datos, su foto, su contacto de emergencia
    y sus preferencias de notificación.
  - Dada la foto, cuando la sube, entonces se valida el mime **real** (no la extensión), se limita
    el tamaño y se guarda en Backblaze con URL firmada de vida corta — nunca una URL pública
    permanente de la foto de una persona (§2.1.2).
  - Dado el titular de los datos, cuando lo pide, entonces puede exportar sus datos en JSON y
    solicitar la baja (§9.2, derechos ARCO).
- **example:** Micaela ve "Te quedan 3 clases · vencen el 15/03" y el botón de renovar. Toca "Mi QR"
  y lo pasa por la tablet sin cerrar la app.
- **story-points:** 5
- **depends_on:** F1-08, F1-19
- **risk:** med
- **test_plan:** Test de validación de mime real con un archivo renombrado. Test de que la URL de la
  foto es firmada y vence. Test del export de datos. Auditoría axe.
- **error-codes:** `LP-ACCT-422-001` (archivo inválido), `LP-ACCT-413-002` (archivo muy grande)
- **data-model-impact:** `User.avatarUrl` como clave de objeto, no como URL pública.

## [ ] F1-30 · Onboarding guiado del SMU

- **module:** susc
- **description:** El asistente de §2.1.3. La métrica de éxito de §2.0 es
  **time-to-first-class < 30 min**: el onboarding es donde se pierde el SaaS.
- **acceptance-criteria:**
  - Dado un suscriptor nuevo, cuando entra por primera vez, entonces el asistente lo lleva por:
    crear Venue → horarios → primera clase → primer producto → invitar miembros.
  - Dada la barra de progreso, cuando el usuario se va y vuelve, entonces el progreso persiste.
  - Dado cualquier paso, cuando el usuario quiere, entonces puede saltearlo y volver después.
  - Dado el asistente completo, cuando termina, entonces el centro tiene al menos una clase
    publicada y un producto vendible.
  - Dado el tiempo total, cuando se mide en una prueba real, entonces el camino de registro a
    primera clase publicada se hace en menos de 30 minutos.
- **example:** El dueño de un box se registra un martes a las 21:00. A las 21:22 tiene su sede
  cargada, el horario de la semana, el pack de 8 clases publicado y el código de invitación listo
  para mandar al grupo de WhatsApp.
- **story-points:** 5
- **depends_on:** F1-12, F1-07
- **risk:** low
- **test_plan:** E2E del camino completo, midiendo los pasos. Test de persistencia del progreso.
  Test de que cada paso se puede saltear.
- **error-codes:** ninguno nuevo
- **data-model-impact:** `Organization.onboarding { step, completedSteps[], completedAt }`.

## [ ] F1-31 · E2E de los tres caminos críticos

- **module:** ci
- **description:** Los tres flujos que §Testing.7 declara obligatorios, en Playwright, corriendo en
  CI. Los navegadores todavía no están instalados en el proyecto.
- **acceptance-criteria:**
  - Dado el primer camino, cuando corre, entonces cubre: alta de suscriptor desde la landing →
    onboarding → primera clase publicada.
  - Dado el segundo, cuando corre, entonces cubre: el staff vende un pack → el miembro reserva →
    cancela dentro de plazo → recupera el crédito.
  - Dado el tercero, cuando corre, entonces cubre: el coach abre la lista de clase → toma asistencia
    → el no-show queda marcado por el job.
  - Dados los tres, cuando corren en CI, entonces lo hacen contra una base efímera con datos
    sembrados, nunca contra staging ni prod.
  - Dado un fallo, cuando ocurre, entonces deja captura y trace como artefacto del run.
- **example:** Un PR rompe la devolución de crédito al cancelar. El segundo E2E falla con la captura
  de la pantalla donde el saldo quedó en 2 en vez de 3.
- **story-points:** 5
- **depends_on:** todas las de Fase 1
- **risk:** med
- **test_plan:** Es el test. Se valida rompiendo a propósito cada camino y comprobando que el E2E
  correspondiente falla.
- **error-codes:** ninguno
- **data-model-impact:** ninguno

## [ ] F1-32 · Documentación del producto

- **module:** docs
- **description:** Los cuatro documentos que pide §5: funcional, técnico, de arquitectura y uno por
  aplicativo. Más el OpenAPI al día y la bitácora completa.
- **acceptance-criteria:**
  - Dado el documento funcional, cuando se escribe, entonces describe qué hace el producto por rol
    y por módulo, en español, sin implementación.
  - Dado el técnico, cuando se escribe, entonces cubre stack, estructura, convenciones, errores,
    logs y cómo levantar el proyecto.
  - Dado el de arquitectura, cuando se escribe, entonces explica la tenancy, los módulos, los
    eventos y los jobs, con los diagramas que hagan falta, y remite a los ADR.
  - Dado cada aplicativo, cuando se documenta, entonces tiene su documento con sus pantallas, sus
    roles y sus permisos.
  - Dado el OpenAPI, cuando se publica, entonces refleja todas las rutas de Fase 1.
  - Dada la bitácora, cuando se revisa, entonces tiene una entrada por bloque de trabajo con su
    commit y su tarjeta de Trello.
- **example:** Un dev nuevo (o una sesión de IA sin contexto) clona el repo, lee el técnico y
  levanta el proyecto entero sin preguntar nada.
- **story-points:** 5
- **depends_on:** todas las de Fase 1
- **risk:** low
- **test_plan:** Verificación manual: seguir el documento técnico desde cero en una máquina limpia y
  que el proyecto levante. Link check automático en CI.
- **error-codes:** ninguno
- **data-model-impact:** ninguno

---

# Fase 2 — Diferenciación

> No arranca hasta que la Fase 1 esté en producción con un cliente real usándola (§12). Se detallan
> con el formato §5.0 recién cuando la fase se abre: redactar hoy el detalle de lo que se va a
> construir dentro de seis meses es trabajo que se tira.

## [ ] F2-A · Mercado Pago: cobro online del centro a sus socios

Cada centro conecta **su propia cuenta** por OAuth; el dinero del socio nunca pasa por Laplace
(ADR-002). Checkout Pro para pago único, `preapproval` para la cuota mensual con débito automático.
Webhooks idempotentes por `payment.id`, cola de fallidos y conciliación diaria. Habilita la venta
self-service en la WAFM (ADR-004, decisión 8). **~34 SP · riesgo alto.**

## [ ] F2-B · Training: librería de ejercicios

Taxonomía obligatoria (categoría, patrón de movimiento, equipamiento, modalidad, unidad,
`isBenchmarkable`), media bajo demanda, escalados y sustituciones, herencia global → organización,
y siembra desde un dataset abierto. **~21 SP · riesgo medio.**

## [ ] F2-C · Planning por bloques

`Planning → Block[] → Item[]` con tipo de scoring y formato por bloque, publicación programada,
plantillas y ciclos, analítica de programación en vivo, y drag and drop **con equivalente por
teclado** (sin eso se rompe WCAG). **~34 SP · riesgo alto.**

## [ ] F2-D · Results / Whiteboard

Los ocho tipos de score, niveles Rx/scaled/foundations con leaderboard separado, PR automático con
notificación, comentarios entre atletas y privacidad del resultado. **~26 SP · riesgo medio.**

## [ ] F2-E · Web Push y WhatsApp

Web Push con VAPID, permiso pedido en el momento correcto (después de la primera reserva, no al
abrir), y WhatsApp por proveedor oficial con plantillas aprobadas. **~13 SP · riesgo medio.**

## [ ] F2-F · Métricas avanzadas

MRR, ARPM, churn, retención a 90 días, LTV, utilización, cohortes de alta y los benchmarks de
industria de §2.1.12. Panel de MRR del SaaS para el SAU. **~13 SP · riesgo medio.**

## [ ] F2-G · Feedback

Puntaje entero 1–5 con `thumbsDown` como flag aparte, anonimato opcional, agregados por
planificación, coach y categoría, feedback post-clase automático y moderación auditada.
**~13 SP · riesgo bajo.**

---

# Fase 3 — Profundidad

## [ ] F3-A · RMs y porcentajes de carga

Basado en el modelo ya validado de BV Cross (§4.1). RM estimado desde submáximos (Epley/Brzycki),
`tested` vs `estimated` nunca mezclados en el mismo gráfico, redondeo al disco disponible del
centro, historial con PR. **~26 SP · riesgo medio.**

## [ ] F3-B · Puente Planning ↔ RMs

"5 × 3 @ 80%" resuelto al peso concreto de cada atleta. Es el mayor diferencial funcional del
producto (§2.1.10). **~13 SP · riesgo medio.**

## [ ] F3-C · Health con consentimiento y cifrado

Los diez requisitos legales de §2.1.13: consentimiento versionado, opcionalidad real, granularidad
revocable por Venue, minimización a limitación funcional por ejercicio, cifrado a nivel campo con
clave separada, acceso restringido con lectura auditada, retención y borrado, apto médico con
alerta de vencimiento y disclaimer. **Si se hace, se hace completo.** **~34 SP · riesgo alto.**

## [ ] F3-D · Multi-Venue completo y roles por sede

`AthleteProfile` global del atleta compartido por consentimiento explícito y revocable (ADR-000
regla 7), staff con alcance limitado por sede, métricas y caja independientes.
**~21 SP · riesgo alto.**

## [ ] F3-E · Benchmarks y modo TV

Benchmarks nombrados (Fran, Murph, Cindy, Grace) como entidad propia con comparación histórica —
la feature que sostiene el engagement a largo plazo — y la vista de pizarra en pantalla grande.
**~21 SP · riesgo bajo.**

---

# Fase 4 — Escala

## [ ] F4-A · CRM / Leads

Pipeline de prospectos, asignación con recordatorio y alerta de leads sin contactar en 15 minutos:
la conversión cae fuerte pasados los primeros minutos. **~21 SP · riesgo bajo.**

## [ ] F4-B · Marca propia del centro en la WAFM

Logo, colores y dominio por centro (feature de plan Max). **~13 SP · riesgo bajo.**

## [ ] F4-C · Reportes exportables y API pública

Exportación para el contador, reportes por producto/Venue/período y API pública versionada con
claves por tenant. **~21 SP · riesgo medio.**

## [ ] F4-D · Facturación electrónica AFIP/ARCA

Fuera de alcance de V1 (§3.1). Se evalúa acá con asesoramiento contable. **~21 SP · riesgo alto.**

## [ ] F4-E · Integración con hardware de acceso

Molinetes y biometría. La API de Attendance se deja preparada desde Fase 1 (§2.1.18).
**~13 SP · riesgo medio.**

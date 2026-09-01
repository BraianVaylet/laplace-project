# Bitácora del proyecto

Registro cronológico de cada cambio significativo. **Más nuevo arriba.**
Escribir la entrada es parte del Definition of Done (spec §15).

Se registra: features, fixes, decisiones, cambios de spec, incidentes y cambios de infra.
No se registra: refactors internos sin impacto observable ni cambios de formato.

## Formato de entrada

```markdown
## YYYY-MM-DD — <título en imperativo>

- **Módulo:** <módulo o `infra` / `spec` / `docs`>
- **Tipo:** feature | fix | decisión | spec | infra | incidente
- **Commit/PR:** <sha corto o enlace al PR>
- **Trello:** <enlace a la o las tarjetas>
- **Qué cambió:** 1-3 líneas, en resultado observable, no en implementación.
- **Por qué:** el motivo, no la descripción del diff.
- **Impacto:** modelo de datos / API / migración / códigos de error nuevos / ninguno.
- **Pendiente:** lo que quedó afuera y por qué.
```

---

## 2026-09-01 — F0-06: bus de eventos de dominio

- **Módulo:** `infra`
- **Tipo:** feature
- **Commit/PR:** rama `feat/action-plan-and-phase-0`
- **Trello:** https://trello.com/c/WOIiZu6L (F0-06)
- **Qué cambió:** los módulos ya tienen por dónde hablarse sin importarse entre sí. Hay un catálogo
  tipado con los ocho eventos de §6 (`booking.created`, `payment.received`, `contract.expiring`…) y
  un bus in-process que los entrega.
- **Por qué:** ADR-003. Es lo que permite que Notifications y Metrics reaccionen a una reserva sin
  que Booking sepa que existen, y lo que hace posible extraer un módulo el día que haga falta.
- **Impacto:** ninguno sobre el modelo de datos. En Fase 2, cuando los eventos pasen a una cola, la
  interfaz no cambia: `emit` pasa a encolar.
- **Decisiones que vale la pena registrar:**
  - **Dos garantías que importan más que la entrega:** un handler que falla no rompe al emisor, y
    tampoco impide que corran los demás. Se usa `allSettled`, no `all`. Si el mail de confirmación
    no sale, la reserva ya está hecha igual — y al revés sería mucho peor.
  - **El fallo se loguea con `LP-SYS-500-004`, nunca se traga.** Con el `requestId` y el `tenantId`
    del contexto que lo originó, que es lo que permite trazarlo de punta a punta cuando alguien
    reporta que no le llegó un aviso.
  - **El payload lleva IDs, no documentos.** Quien reacciona consulta lo que necesita con su propio
    repositorio, ya acotado a su tenant. Pasar el documento entero invitaría a que un handler opere
    sobre datos que no volvió a verificar.
  - **El contexto de tenant atraviesa el bus** porque vive en `AsyncLocalStorage`: el handler
    consulta con el mismo tenant que el emisor sin que nadie lo pase a mano.

## 2026-09-01 — F0-05: suite parametrizada de aislamiento de tenant

- **Módulo:** `infra`
- **Tipo:** feature
- **Commit/PR:** rama `feat/action-plan-and-phase-0`
- **Trello:** https://trello.com/c/018wiwXF (F0-05)
- **Qué cambió:** existe un registro de rutas de negocio y una suite que lo recorre entero
  atacando cada ruta desde otro centro. Una ruta bajo `/api/v1` que no esté registrada rompe el CI,
  y una registrada como `tenantScoped` sin su fixture de ataque también.
- **Por qué:** §Testing lo declara no negociable, y §9.1 dice que el ataque real acá es IDOR:
  cambiar un ID en la URL. El olvido típico no es escribir mal el aislamiento, es agregar un
  endpoint y no testearlo. Por eso la suite se parametriza sobre el registro en vez de listar rutas
  a mano.
- **Impacto:** ninguno sobre el modelo de datos. A partir de ahora, cada ruta de negocio que se
  agregue tiene que declararse en `src/http/route-registry.ts` con su fixture.
- **Decisiones que vale la pena registrar:**
  - **Responde 404, no 403.** Un 403 sobre el recurso de otro centro confirma que ese recurso
    existe, que es justo lo que el atacante quería averiguar.
  - 🔴 **Hay un caso trampa que verifica que la suite pueda fallar.** `/api/v1/trap/:id` consulta el
    driver crudo, sin repositorio ni plugin, y el test comprueba que **sí filtra** los datos del
    otro centro. Sin ese test, una suite que pasara siempre sería indistinguible de una suite rota,
    y nos daría una falsa sensación de cobertura.
  - **Hay un chequeo contra la app real, no solo contra la de prueba.** Hoy pasa solo porque no hay
    rutas de negocio todavía; el día que alguien agregue `POST /api/v1/members` sin registrarla, ese
    test la caza.
- **Pendiente:** la suite recorre lo que hay registrado, que hoy son las rutas de prueba. Se llena
  sola a medida que entren los módulos de Fase 1.

## 2026-09-01 — F0-04: las tres capas de aislamiento de tenant

- **Módulo:** `infra`
- **Tipo:** feature
- **Commit/PR:** rama `feat/action-plan-and-phase-0`
- **Trello:** https://trello.com/c/ZdQ14r8m (F0-04)
- **Qué cambió:** ya existe la maquinaria que hace que un centro no pueda ver los datos de otro.
  Middleware que abre el contexto desde la sesión, repositorio base que inyecta el `tenantId` en
  toda consulta, y plugin de Mongoose que lo vuelve a inyectar por su cuenta. Más soft delete por
  defecto, campos de auditoría, identificadores públicos con prefijo y paginación por cursor.
- **Por qué:** es la regla 1 del ADR-000 y el riesgo crítico de §13.1. Todo lo que venga después
  —miembros, contratos, reservas, plata— se apoya en esto.
- **Impacto:** transversal. Toda colección de negocio va a llevar `tenantId`, `publicId`,
  `createdBy`, `updatedBy`, `deletedAt` y timestamps. Código en uso: `LP-SYS-500-003`. La
  paginación consume `LP-SYS-422-006` cuando el cursor viene manipulado.
- **Decisiones que vale la pena registrar:**
  - **El contexto viaja en `AsyncLocalStorage`, no como parámetro.** El plugin de Mongoose corre
    adentro del driver, lejos del handler de Hono, y necesita ver el tenant para poder ser la
    segunda red. Pasarlo a mano por cada capa sería exactamente el tipo de disciplina que no
    queremos que sea lo único que separa a un centro de los datos de otro.
  - 🔴 **Sin contexto, la consulta falla.** No devuelve todo, no devuelve vacío: lanza
    `LP-SYS-500-003`. Es la decisión más importante del archivo. Un `find` sin `tenantId` que igual
    responde es una fuga; un 500 con su código es un bug que se arregla.
  - 🔴 **Pedir explícitamente el tenant de otro también lanza.** La primera versión reescribía el
    filtro en silencio, y el test lo cazó: devolvía los datos del centro propio cuando el código
    había pedido los de otro. Eso esconde el error hasta que aparece en producción. Ahora es un
    incidente ruidoso.
  - **El hook de estampado va en `pre('validate')`, no en `pre('save')`.** El ADR-000 dice `save`,
    pero Mongoose valida antes de guardar: con el hook en `save`, el `required: true` de `tenantId`
    ganaba de mano y el error que salía era un ValidationError sin código, no nuestro `AppError`.
    El efecto es el mismo y el error correcto.
  - **`aggregate` también se cubre.** No pasa por los hooks de query: sin un `$match` antepuesto,
    la primera agregación de métricas leería la colección entera, de todos los centros.
  - **La paginación es keyset, nunca `skip`.** Se pide un documento de más para saber si hay página
    siguiente sin contar el total, y el `_id` va como desempate: sin él, dos documentos con el mismo
    valor de orden se pierden o se repiten entre páginas. El límite tiene techo de 100.
  - **Los IDs públicos usan el alfabeto de Crockford en minúscula**, sin `i`, `l`, `o` ni `u`: un
    socio le dicta el ID a la recepcionista por teléfono y `l` contra `1` no puede ser un problema
    dos veces.
  - **`includeDeleted` tuvo que viajar como opción de query hasta el plugin.** El repositorio lo
    omitía del filtro pero el plugin lo volvía a agregar, así que la opción no hacía nada. Otro que
    encontró el test.
- **Pendiente:** los índices (incluido el compuesto con `tenantId` primero) los crea F0-10. La suite
  parametrizada de aislamiento sobre todas las rutas es F0-05, que es la que convierte esto en una
  garantía verificada endpoint por endpoint.

## 2026-09-01 — F0-03: rate limit, bloqueo progresivo, 2FA y magic link

- **Módulo:** `auth`
- **Tipo:** feature
- **Commit/PR:** rama `feat/action-plan-and-phase-0`
- **Trello:** https://trello.com/c/pwaPjW8n (F0-03)
- **Qué cambió:** el login dejó de ser gratis de atacar. Hay límite de 5 intentos por minuto y por
  IP, bloqueo progresivo por cuenta (1 min → 5 → 15 → 60, con techo), TOTP obligatorio para el super
  admin, y magic link de un solo uso para el socio.
- **Por qué:** §9.1 lo pide explícitamente y es lo primero que se prueba contra un SaaS que expone
  un formulario de login público.
- **Impacto:** colección `loginAttempt` (con `expiresAt` para TTL) y `rateLimit` (la crea Better
  Auth). Campo `user.isSuperAdmin`. Códigos en uso: `LP-AUTH-403-006`, `LP-AUTH-403-007`,
  `LP-AUTH-401-008`, `LP-AUTH-422-010`, más los de 2FA en el traductor.
- **Decisiones que vale la pena registrar:**
  - **El rate limit por IP y el bloqueo por cuenta son dos defensas distintas y hacen falta las
    dos.** La IP se rota barato; la cuenta no. El límite por IP frena la ráfaga desde un origen; el
    bloqueo por cuenta frena el ataque distribuido y lento contra un email concreto.
  - **El bloqueo también rechaza la contraseña correcta.** Si dejara entrar al acertar, no
    protegería de nada: el atacante seguiría probando hasta dar.
  - **El rate limit se persiste en Mongo, no en memoria.** En memoria, reiniciar la API es la forma
    más fácil de saltearlo, y con más de una instancia cada una llevaría su propia cuenta.
  - **`isSuperAdmin` se declara con `input: false`.** Si fuera escribible, cualquiera se haría super
    admin mandando el campo en su propio registro. Hay un test que lo intenta.
  - **2FA obligatorio solo para el SAU.** El super admin ve el SaaS entero: una sola contraseña
    filtrada comprometería a todos los centros. Para el SMU queda opcional, como pide §2.1.1.
  - 🔴 **`magic-link/verify` responde 302 incluso cuando falla**, porque es un endpoint que abre el
    navegador: redirige a la app o a una URL de error. No pasa por el traductor de errores (que solo
    actúa sobre 4xx y 5xx) y eso está bien. El test correspondiente verifica lo que de verdad
    importa — que no cree sesión — y no el status.
  - **`Date` quedó acorralado en un solo archivo.** El lint prohíbe `Date` (spec §6: Temporal), pero
    el driver de Mongo persiste fechas como BSON Date y los índices TTL solo funcionan sobre ese
    tipo. En vez de repartir excepciones, `src/persistence/bson-date.ts` es la única frontera de
    conversión, con la regla desactivada ahí y el motivo escrito. En cualquier otro archivo el lint
    sigue cortando, que es lo que queremos.
- **Pendiente:** el índice TTL de `loginAttempt` sobre `expiresAt` se crea en F0-10, junto con el
  resto de los índices; hasta entonces los documentos vencidos quedan, sin afectar el
  comportamiento. La UI de alta de 2FA y el aviso al titular cuando su cuenta se bloquea son de las
  tareas de front (F0-13) y de Notifications (F1-21).

## 2026-09-01 — F0-02: organizaciones y matriz de permisos por recurso y acción

- **Módulo:** `auth`
- **Tipo:** feature
- **Commit/PR:** rama `feat/action-plan-and-phase-0`
- **Trello:** https://trello.com/c/PSLTVMa4 (F0-02)
- **Qué cambió:** un usuario ya puede pertenecer a varios centros con un rol distinto en cada uno.
  La sesión lleva el centro activo y los permisos que valen son los de **ese** centro. Hay seis
  roles (`owner`, `manager_assistant`, `head_coach`, `coach`, `front_desk`, `member`) definidos por
  permiso sobre recurso y acción, no como bloques fijos, y dos guards que los aplican:
  `requireOrganization` y `requirePermission`.
- **Por qué:** §1.1 marca que un solo rol `staff` obliga a elegir entre dar de más (recepcionista
  viendo ingresos) o de menos (coach que no puede tomar asistencia). Y el `organizationId` de acá es
  el `tenantId` del que va a colgar todo el aislamiento en F0-04 (ADR-000).
- **Impacto:** colecciones `organization`, `member` e `invitation`, creadas por el plugin. Código de
  error nuevo en uso: `LP-AUTH-403-011`. Se sumaron al traductor de errores los códigos propios del
  plugin de organizaciones.
- **Decisiones que vale la pena registrar:**
  - 🔴 **El socio del centro se llama `athlete` en la matriz de permisos, no `member`.** Better Auth
    **reserva** `member` para la pertenencia de un usuario a la organización, y sus propios
    endpoints chequean `member.create` para invitar staff. Si le hubiéramos puesto `member` al
    socio, darle `member.create` a un recepcionista para que dé de alta socios le habría dado
    también permiso para invitar usuarios staff: una escalada de privilegios silenciosa. El modelo
    de datos sigue llamándose `Member` (§5.2.2); el nombre distinto vive solo en el statement de
    permisos, con el comentario que lo explica.
  - **Los permisos se testean como datos.** `src/auth/permissions.test.ts` declara la matriz
    completa y genera un test por celda: 363 tests. Dos de ellos son de cobertura y son los que
    hacen que la suite se rompa si alguien agrega un permiso al statement sin decidir quién puede
    ejercerlo. Escribir la matriz ya encontró un error: tenía al `manager_assistant` con acceso a
    facturación, y §1.1 dice "todo salvo métricas de negocio **y facturación**".
  - **El evaluador falla cerrado.** Un rol desconocido no autoriza y no lanza. Con varios roles
    alcanza con que uno lo permita, y se exigen todas las acciones pedidas, no una.
  - **El reembolso es del owner**, no del mostrador: `front_desk` cobra y ve el estado de cuenta
    para poder cobrar, pero no revierte plata.
- **Pendiente:** los permisos por miembro (`Membership.permissions[]`, §1.1: "personalizables por
  permiso") y el alcance por Venue son de F3-D; hoy el rol es lo único que decide. El endurecimiento
  de auth es F0-03.

## 2026-09-01 — F0-01: identidad con Better Auth y MongoDB

- **Módulo:** `auth`
- **Tipo:** feature
- **Commit/PR:** rama `feat/action-plan-and-phase-0`
- **Trello:** https://trello.com/c/Fx2XFiJo (F0-01)
- **Qué cambió:** la API autentica. Un usuario se registra con email y contraseña, recibe el mail de
  verificación, entra y su sesión sobrevive a un reinicio porque vive en Mongo. Las rutas protegidas
  resuelven el usuario desde la sesión con el guard `requireSession`, y las que exigen email
  verificado, con `requireVerifiedEmail`.
- **Por qué:** es la base de la que cuelga todo el resto. Sin identidad no hay tenant, y sin tenant
  no hay una sola consulta segura (ADR-000).
- **Impacto:** colecciones de Better Auth (`user`, `session`, `account`, `verification`), creadas
  por su propio adaptador. Dos variables de entorno nuevas y obligatorias: `BETTER_AUTH_SECRET` y
  `BETTER_AUTH_URL` — ya estaban en `.env.example`, ahora la API no arranca sin ellas. Se agregó
  `mongodb` como dependencia directa de la API: se importa su tipo `Db`, así que declararla es
  honesto. Códigos de error nuevos en uso: `LP-AUTH-403-004`, `LP-AUTH-401-005`, `LP-AUTH-409-009`.
- **Decisiones que vale la pena registrar:**
  - **El login no exige email verificado.** La spec §2.1.1 pide la verificación antes de
    **reservar**, no antes de entrar. Bloquear el login habría dejado al usuario afuera de su propia
    cuenta por un mail que no llegó. El corte lo hace un guard sobre las rutas que lo necesitan.
  - **Los errores de Better Auth se traducen en el borde.** Responde en inglés y con su propio
    formato; la spec §5.0 exige el envelope unificado en es-AR. `src/auth/error-mapping.ts` es esa
    tabla, y un código que no esté mapeado cae en `LP-SYS-500-001` en vez de inventar uno que no
    existe en `docs/errors.md`.
  - **"Email inexistente" y "contraseña incorrecta" devuelven exactamente lo mismo**, código y
    mensaje. Distinguirlos convierte el login en un oráculo de qué emails están registrados (§9.1).
    Hay un test que lo verifica en las dos capas, unitaria e integración.
  - **Se reutiliza la conexión de Mongoose** (`mongoose.connection.db`) en vez de abrir un segundo
    cliente: una sola pool.
  - `LP-AUTH-422-010` pasa de "magic link inválido" a "enlace inválido o vencido": cubre también el
    de verificación. Para quien lo recibe son el mismo problema y la misma salida.
- **Pendiente:** el envío real de mail es un `EmailSender` inyectado que hoy solo loguea el enlace;
  el proveedor entra con Notifications (F1-21). El rate limit, el bloqueo progresivo, el 2FA y el
  magic link son F0-03. El OpenAPI de estas rutas queda para F0-09, que es la tarea que lo genera.

## 2026-09-01 — Traducir la spec a un backlog ejecutable y cerrar las decisiones abiertas

- **Módulo:** `docs`
- **Tipo:** decisión
- **Commit/PR:** `528e2f0` (rama `feat/action-plan-and-phase-0`)
- **Trello:** las 65 tarjetas de https://trello.com/b/8QrgU6Cc/laplace, lista "Sin iniciar"
- **Qué cambió:** la spec pasa a tener un plan de acción ejecutable en `docs/ACTION-PLAN.md`: 16
  tareas de Fase 0 y 32 de Fase 1 con el formato ampliado de §5.0 (criterios Given/When/Then,
  ejemplo, story points, dependencias, riesgo, test plan, códigos de error e impacto en el modelo),
  más 17 épicas para las Fases 2 a 4. Las mismas tareas quedaron cargadas en Trello. Los ADR 004 a
  006 cierran las decisiones que faltaban y `docs/errors.md` declara los 52 códigos nuevos.
- **Por qué:** la spec define qué construir pero no en qué orden ni con qué criterio de terminado.
  Sin eso, cada sesión de trabajo elige su propia prioridad y las tareas arrancan sin cumplir el
  Definition of Ready (§15): sin criterios verificables y sin códigos de error declarados. Y seis
  tareas de Fase 1 estaban directamente bloqueadas por las decisiones abiertas de §13.2.
- **Impacto:** ninguno sobre el modelo de datos todavía. Se agregaron 52 códigos de error
  (`AUTH-004` a `011`, todo `ACCT`, `SUSC`, `SUBS`, `SCHD`, `MEMB`, `PROD`, `ATTD`, `CRM`, y las
  ampliaciones de `BOOK`, `CTRT`, `BILL`, `ENTL`, `HLTH`, `NOTF`, `SYS`). La tabla "Semilla del
  diccionario" se reemplazó por un diccionario por módulo, para que no haya dos listas que se
  desincronicen.
- **Decisiones cerradas (ADR-004, con las propuestas de la propia spec):** reservar con deuda
  configurable por Venue con default `no` · trial de 14 días sin tarjeta · precios en ARS con ajuste
  programado y aviso de 30 días · el SAU no ve datos de miembros salvo impersonación auditada · la
  WAFM no vende hasta Fase 2 · retención de 90 días tras la baja. Queda abierta a propósito la 9
  (nombre comercial): es de negocio y no bloquea código.
- **Decisiones técnicas nuevas:** ADR-005 elige `vite-react-ssg` para la landing, que hoy es una SPA
  y §5.1.4 exige SSG para rankear. ADR-006 elige cron in-process con lock en Mongo para los jobs, en
  vez de BullMQ + Redis: sin servicio extra ni costo, con el volumen de Fase 0 y 1.
- **Conflictos de spec resueltos por la propia spec, anotados para no re-litigarlos:** manda el
  empaquetado de planes de §2.2.1 (no el de §2.2) · bottom nav en la WAFM mobile · modal de
  instalación PWA máximo 1 cada 7 días · popup de actualización con escape a los 30 s.
- **Pendiente:** todo el código de Fase 0 (F0-01 a F0-16) y de Fase 1. El corte de numeración de
  códigos de error se corrigió sobre la marcha: el `NNN` es correlativo **por módulo**, así que los
  códigos nuevos de `SYS` arrancan en `003`, no en `002`.

## 2026-08-31 — Unificar ESLint en un solo config de la raiz

- **Módulo:** `infra`
- **Tipo:** fix
- **Commit/PR:** —
- **Trello:** —
- **Qué cambió:** ESLint pasa a tener un único config en la raíz, con las reglas de React y la de
  fronteras de módulo aplicadas por `files`. Se eliminaron los 8 config por paquete y la raíz
  declara `@laplace/config` como dependencia.
- **Por qué:** el hook de pre-commit falló con `Cannot find package '@laplace/config'`. La raíz
  usaba el paquete sin declararlo, así que pnpm no lo linkeaba ahí; `pnpm lint` no lo detectaba
  porque turbo corre dentro de cada paquete. Además flat config no busca el config más cercano por
  archivo: lint-staged corre desde la raíz y habría aplicado el config base a las apps, salteando
  las reglas de React y la de fronteras de módulo.
- **Impacto:** ninguno sobre el modelo de datos. `pnpm lint` y el pre-commit ahora aplican
  exactamente el mismo set de reglas.
- **Pendiente:** ninguno.

## 2026-08-31 — Levantar el monorepo, el pipeline de CI y el harness de tests

- **Módulo:** `infra`
- **Tipo:** infra
- **Commit/PR:** —
- **Trello:** —
- **Qué cambió:** el repo ya corre `pnpm lint / typecheck / test / build` en verde sobre las 5 apps
  y los 4 packages. La API levanta con `/health` y `/ready`, valida su entorno al arrancar y
  responde todo error con el envelope de la spec §5.0. Las 4 apps web compilan con Tailwind v4 y
  el tema dark/light de `@laplace/ui`.
- **Por qué:** sin scaffold ni CI, cada tarea de negocio arrastra decisiones de infra y no hay forma
  de verificar el DoD. Es el bloqueante de la Fase 0.
- **Impacto:** ninguno sobre el modelo de datos. Se agregó el código de error `LP-SYS-404-002`
  (ruta inexistente) a `docs/errors.md`, y se corrigió el patrón de código de error de
  `[A-Z]{3,4}` a `[A-Z]{2,4}`: el módulo `RM` tiene 2 letras y el test lo detectó.
- **Pendiente:** Better Auth, contexto de tenant, repositorios y plugin de Mongoose (Fase 0). Los
  navegadores de Playwright no están instalados y el e2e todavía no corre en CI.

## 2026-08-31 — Crear la capa de contexto del repo

- **Módulo:** `docs`
- **Tipo:** decisión
- **Commit/PR:** —
- **Trello:** —
- **Qué cambió:** la spec pasa a vivir en `docs/spec/LAPLACE-SPEC.md` dentro del repo. Se agregan
  los ADR 000 a 003, el diccionario de errores, esta bitácora, `CLAUDE.md` y el directorio
  `.claude/` con subagentes, comandos y hooks.
- **Por qué:** sin convenciones escritas, cada sesión de IA inventa las suyas — razonables pero
  distintas entre sí — y el tiempo se va en corregir en vez de construir.
- **Impacto:** ninguno sobre el modelo de datos. Es capa de contexto, no de ejecución.
- **Pendiente:** scaffold del monorepo, CI y `.env.example` (Fase 0).

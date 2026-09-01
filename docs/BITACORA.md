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

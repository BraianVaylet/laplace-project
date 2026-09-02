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

## 2026-09-02 — F1-04: códigos de invitación

- **Módulo:** `members`
- **Tipo:** feature
- **Commit/PR:** `COMMIT_SHA` (rama `feat/phase-1-mvp`)
- **Trello:** https://trello.com/c/fRal7oGI (F1-04) — movida a **Completadas**
- **Qué cambió:** el centro genera códigos con vencimiento y límite de usos, y los revoca. Un
  atleta registrado en la WAFM canjea el código y queda como socio de ese centro. La v1 no definía
  ni vencimiento ni límite: un código filtrado se usaba para siempre.
- **Por qué:** es la puerta de entrada del socio al producto, y la única parte del sistema que
  atraviesa la frontera de tenant por diseño.
- **Impacto:** colección `inviteCodes` · cuatro rutas nuevas · **migración nueva**
  (`20260902100000-invite-code-global-unique.cjs`) · salida explícita `skipTenantScope` en el
  plugin de tenancy · prefijo de id `inv`.
- **Pendiente:** nada de esta tarea.

**Decisiones:**

- **El código lo genera el sistema.** Si el centro pudiera escribirlo, dos centros elegirían
  "VERANO2026" y el canje no sabría a cuál de los dos asociar a la persona. Son 8 caracteres de un
  alfabeto sin `O`, `0`, `I`, `1` ni `L`, que son las cinco que la gente confunde al dictarlo.
- **Índice único GLOBAL sobre `code`, y es la única excepción a "tenantId primero".** El canje
  ocurre antes de que la persona pertenezca a ningún centro: el tenant sale del código, que es el
  único dato que hay. Con el `{ tenantId, code }` solo, la unicidad sería por centro y la búsqueda
  global sería ambigua. El índice hace que el choque sea imposible en vez de improbable.
- **`skipTenantScope`: una salida explícita en el plugin, en vez de esquivarlo con el driver.** La
  alternativa era consultar `db.collection('inviteCodes')` directo, que es exactamente la "ruta
  trampa" que la suite de F0-05 existe para cazar. Una opción con nombre es greppable, testeable y
  justificable en la revisión. Tiene cuatro tests propios, incluido el que documenta que **dentro**
  de un contexto de tenant sigue devolviendo datos de otros centros: por eso el filtro tiene que
  acotar por sí mismo.
- **El consumo del uso es atómico.** `findOneAndUpdate` con `$expr` sobre `usedCount < maxUses`:
  el filtro y el `$inc` suceden en la misma operación. Con un read y después un write, cinco
  atletas contra el último cupo leerían `usedCount: 0` y pasarían los cinco. Hay un test que lanza
  exactamente eso y verifica que gane uno solo.
- **Un solo error para vencido, agotado, revocado e inexistente.** §11.2 lo pide así a propósito:
  distinguirlos le diría a quien prueba códigos al azar cuáles existen.
- **Revocar no toca a quienes ya lo usaron.** Son socios del centro por derecho propio;
  desasociarlos por revocar un código sería un efecto que nadie pidió.
- **El canje pide nombre y apellido.** Partir el nombre de la cuenta ("Juan Pérez" → nombre +
  apellido) falla con un apellido compuesto y con quien se registró con un solo nombre, y deja la
  ficha del socio mal desde el día uno.
- **Compensación en vez de transacción.** Si el canje falla después de consumir el uso, se devuelve
  con un `$inc: -1`. F1-14 (reserva) es donde las transacciones se vuelven obligatorias y donde se
  va a introducir esa plumbing; acá el peor caso de que la compensación también falle es un cupo de
  menos, no un dato inconsistente.

**Verificación:** 1152 tests verdes (796 en la API), `lint`, `typecheck`, `build` y `format:check`
en verde, gate de cobertura por criticidad cumplido.

---

## 2026-09-01 — F1-03: módulo Members, la ficha del socio

- **Módulo:** `members`
- **Tipo:** feature
- **Commit/PR:** `4a792a5` (rama `feat/phase-1-mvp`)
- **Trello:** https://trello.com/c/B66fpRsh (F1-03) — movida a **Completadas**
- **Qué cambió:** el staff da de alta y gestiona socios desde `/api/v1/members`, con máquina de
  estados, etiquetas, flags de mora y sanción, y notas internas. El límite del plan se aplica de
  verdad: el socio que excede el cupo recibe `LP-ENTL-403-001`, y archivar libera lugar.
- **Por qué:** es la entidad sobre la que gira el resto del producto — contratos, reservas,
  asistencia y cobranza cuelgan de acá.
- **Impacto:** colección `members` · diez rutas nuevas en el registro de F0-05, todas con su fixture
  de ataque · dos eventos nuevos (`member.created`, `member.status_changed`) · prefijo de id `mnt`
  para las notas.
- **Pendiente:** el consentimiento del tutor de un menor bloquea la **reserva**, no el alta. Eso
  entra con Waivers (F1-20).

**Decisiones:**

- **La respuesta de la API es una lista blanca, no un `delete doc.notes`.** Las notas internas del
  staff nunca son visibles para el miembro (§2.1.7). Filtrar por sustracción obliga a acordarse cada
  vez que se agrega un campo; con lista blanca, el campo sensible que se sume mañana no sale por
  defecto. Hay un test que pide la ficha y el listado y verifica que el texto de la nota no aparezca
  en ninguno de los dos.
- **`debtor` y `suspended` son flags, no estados.** Un socio puede estar `active` y `debtor` a la
  vez, y es el caso más común del negocio. Modelarlos como estados obligaría a elegir uno.
- **El documento se normaliza y el vacío se convierte en ausente.** "40.123.456" y "40123456" son la
  misma persona; sin normalizar, el único por documento no detecta el duplicado y el centro termina
  con dos fichas. Y dos cadenas vacías chocarían entre sí en el índice.
- **El E11000 se traduce a `LP-MEMB-409-001`.** El chequeo previo del documento existe para dar un
  error con nombre, pero entre el `findOne` y el `create` hay una ventana. La cierra el índice — y
  además hay un caso real que el chequeo previo nunca ve: un socio borrado lógicamente sigue
  reservando su documento, porque el índice no sabe de borrado lógico. Sin traducir el error, eso
  sería un 500 y el staff no entendería por qué no puede cargar a esa persona.
- **El corte del tutor se re-evalúa en el PATCH.** Si solo se validara en el alta, cargar la fecha de
  nacimiento después sería la forma trivial de saltearlo.
- **El índice único es PARCIAL, no sparse.** Es la misma trampa que encontró F0-10: en un índice
  compuesto, `sparse` solo omite el documento si faltan _todos_ los campos indexados, y `tenantId`
  siempre está. Con `sparse`, dos socios sin documento colisionarían en `null`. El test corre la
  migración de verdad para probarlo contra el índice que va a existir en producción.

**Verificación:** 1110 tests verdes (765 en la API), `lint`, `typecheck`, `build` y `format:check`
en verde, gate de cobertura por criticidad cumplido.

---

## 2026-09-01 — F1-02: módulo Rooms y la sala que se crea sola

- **Módulo:** `rooms`
- **Tipo:** feature
- **Commit/PR:** `fb06692` (rama `feat/phase-1-mvp`)
- **Trello:** https://trello.com/c/ltW4BpEP (F1-02) — movida a **Completadas**
- **Qué cambió:** el SMU administra salas por sede desde `/api/v1/rooms`, con capacidad y
  equipamiento. Al crear una sede se crea sola la sala "Principal": el 90% de los centros tiene una
  y no debería ver nunca el concepto (§1.1). Borrar una sala con clases programadas se bloquea y
  ofrece archivarla.
- **Por qué:** es de donde hereda la capacidad una clase, así que sin Rooms no hay agenda (F1-12) ni
  reservas (F1-14).
- **Impacto:** colección `rooms` · siete rutas nuevas en el registro de F0-05, todas con su fixture
  de ataque · códigos nuevos `LP-SCHD-404-008` y `LP-SCHD-422-007`.
- **Pendiente:** el contador real de sesiones futuras. Ver abajo.

**Decisiones:**

- **La sala por default se crea por evento, no por llamada directa.** Venues emite `venue.created`
  y Rooms lo escucha. La alternativa era que Venues creara el modelo de Rooms, que es exactamente lo
  que ADR-003 prohíbe. El handler es idempotente: si la sede ya tiene salas no hace nada, porque un
  segundo "Principal" sería peor que ninguno.
- **Un fallo de la sala automática no tumba el alta de la sede.** El bus aísla los errores de los
  handlers a propósito. Que no se pueda dar de alta una sede porque su sala automática falló sería
  peor que una sede sin sala, que el SMU resuelve con un click.
- **Rooms pregunta por interfaz, no importa a Venues.** El puerto `VenueLookup` tiene un solo
  método, `exists`. El punto de composición lo conecta con el servicio de Venues. Lo mismo con
  `FutureSessionCounter`, que hoy contesta 0 y mañana contesta Schedule.
- **El límite del plan no cuenta salas.** §1.1 es explícito: cuenta Venues activos. Hay un test que
  crea cinco salas en un centro Basic justamente para que nadie "arregle" esto más adelante.
- **El override de cupo por sesión puede bajar pero no subir.** La sala es el techo físico: 20
  personas no entran donde entran 16, y dejarlo pasar convierte la lista de espera en una promesa
  que no se cumple.
- **La sede de una sala no se edita.** Mover una sala de Venue dejaría sesiones pasadas apuntando a
  una sede donde nunca ocurrieron, y las métricas por sede quedarían mal para siempre.
- **`DELETE` usa el permiso de archivar.** La matriz de F0-02 no tiene `delete` para Room, y el
  borrado es lógico: vive en el mismo permiso destructivo.

**Deuda declarada:** el bloqueo de borrado está implementado y testeado contra el puerto, pero hasta
F1-12 nadie cuenta sesiones de verdad. Anotado en la tarea F1-12, que es la que lo conecta.

**Verificación:** 1023 tests verdes (705 en la API), `lint`, `typecheck`, `build` y `format:check`
en verde, gate de cobertura por criticidad cumplido.

---

## 2026-09-01 — F1-01: módulo Venues, la primera ruta de negocio

- **Módulo:** `venues`
- **Tipo:** feature
- **Commit/PR:** `2f4b745` + `992993c` (rama `feat/phase-1-mvp`)
- **Trello:** https://trello.com/c/vZBLxUY1 (F1-01) — movida a **Completadas**
- **Qué cambió:** el SMU crea, edita, lista, archiva y reactiva sedes desde `/api/v1/venues`, cada
  una con su zona horaria, moneda, horarios de atención y política de reserva propia. El límite de
  sedes del plan se aplica de verdad: el centro Basic no puede crear la segunda.
- **Por qué:** es la unidad de negocio de la que cuelga todo lo demás (§2.1.6) y la tarea que fija
  el patrón `domain` / `application` / `infrastructure` para las 31 que faltan de la fase.
- **Impacto:** colección `venues` · seis rutas nuevas en el registro de F0-05, todas con su fixture
  de ataque · códigos nuevos `LP-SCHD-422-006` y `LP-ENTL-500-005` · umbral de cobertura nuevo para
  `src/modules/**` (85%).
- **Pendiente:** la Room por default. `venue.created` ya se emite; el suscriptor que crea la sala
  entra con F1-02, que es donde vive Rooms. Adelantarlo acá habría obligado a Venues a importar el
  modelo de otro módulo (ADR-003).

**Decisiones:**

- **El límite del plan se evalúa antes de escribir.** Crear y después borrar deja huecos en la
  numeración y ruido en el historial. El contador cuenta sedes **activas**: archivar libera el cupo,
  porque cerrar una sede no puede seguir costando plata (§2.2.1).
- **404 y no 403 sobre el recurso de otro centro.** Un 403 confirma que el recurso existe.
- **Dos códigos de error mal asignados, corregidos.** El Venue es del módulo `SCHD`, no de `SUSC`:
  la transición inválida pasó a `LP-SCHD-422-006`. Y el "centro sin plan" del loader de entitlements
  usaba `LP-SUSC-422-001` ("transición de estado inválida"), que no describe lo que pasó: ahora es
  `LP-ENTL-500-005`, con 500 porque el pedido está bien y el problema es nuestro.
- **La política de reserva incoherente tiene su propio código.** `validated()` aprendió a mapear
  issues de Zod a códigos de módulo: es el único error de configuración que el SMU puede cometer en
  esta pantalla, y merece un mensaje que diga qué arreglar en vez de un "payload inválido".
- **El plan de un centro se lee por una interfaz, no por una consulta.** Hoy sale del `metadata` de
  la organización de Better Auth; con F1-25 pasa a ser el documento de suscripción y nada más se
  entera. Un plan inventado o un JSON roto caen al plan del trial, que es el más restrictivo.
- **`pnpm format` sobre todo el repo.** 79 archivos nunca habían pasado por Prettier, y el CI corre
  `format:check` antes que nada: hoy el pipeline habría fallado antes de compilar. Solo reformateo.

**Verificación:** 979 tests verdes (678 en la API), `lint`, `typecheck`, `build` y `format:check` en
verde, gate de cobertura por criticidad cumplido.

---

## 2026-09-01 — F0-16: infraestructura de staging escrita, aprovisionamiento pendiente

- **Módulo:** `infra`
- **Tipo:** infra
- **Commit/PR:** `980c6c5` (rama `feat/action-plan-and-phase-0`)
- **Trello:** https://trello.com/c/6RAcU5Rt (F0-16) — movida a **Bloqueadas**
- **Qué cambió:** cada app tiene su `railway.json`, el CI tiene un job `deploy-staging` que corre
  solo desde `main` y con el pipeline en verde, y `docs/runbook-staging.md` documenta variables,
  rotación de secretos, migraciones, el procedimiento de restore con su RPO/RTO y el monitoreo.
- **Por qué queda bloqueada:** el resto crea recursos que cuestan plata en la cuenta del dueño y
  necesita servicios que no se aprovisionan desde acá (MongoDB Atlas, Backblaze B2). Se consultó y
  la decisión fue dejarlo para el dueño de la cuenta y seguir con Fase 1.
- **Lo que falta, en orden:** crear el proyecto en Railway con los cinco servicios · cluster de Atlas
  **con replica set**, backups y PITR · bucket privado en B2 · cargar secretos en Railway y las
  variables del CI (`RAILWAY_TOKEN`, `STAGING_MONGODB_URI`, `STAGING_MONGODB_DB_NAME`,
  `STAGING_API_URL`, `STAGING_LANDING_URL`) · correr el restore de verificación y anotarlo acá.
- **Decisiones que vale la pena registrar:**
  - **El health check apunta a `/ready`, no a `/health`.** `/health` responde 200 mientras el proceso
    viva, aunque Mongo esté caído; un servicio que responde pero no puede leer nada no está listo
    para recibir tráfico y Railway no debería mandárselo.
  - **Las migraciones corren antes del deploy y desde un solo lugar.** Si las corriera el arranque
    del proceso, dos instancias las correrían a la vez.
  - **La rotación de secretos se documenta como solapamiento de dos claves.** Rotar
    `BETTER_AUTH_SECRET` de golpe invalida todas las sesiones activas: en un centro, a las 7 de la
    mañana, son cuarenta personas que no pueden hacer check-in.
  - 🔴 **El replica set de Atlas no es opcional.** Las transacciones de la cancelación de clase
    —cancelar reservas y devolver créditos en una sola operación— no existen sin él (ADR-001,
    §5.2.4), y un cluster standalone hace fallar esos flujos en runtime, no en el build.
  - **El monitoreo de uptime va afuera.** Si el servicio se cae, un monitor que vive adentro se cae
    con él.

---

## 2026-09-01 — Cierre de Fase 0

- **Módulo:** `infra`
- **Tipo:** decisión
- **Commit/PR:** 19 commits en `feat/action-plan-and-phase-0`
- **Trello:** 15 tarjetas en Completadas, 1 en Bloqueadas
- **Estado:** **15 de 16 tareas cerradas, 910 tests en verde**, con lint, typecheck, build y el gate
  de cobertura por criticidad pasando en los 9 paquetes. La única pendiente es F0-16, bloqueada por
  aprovisionamiento.
- **Lo que quedó construido:** identidad con Better Auth y organizaciones · matriz de permisos por
  recurso y acción, testeada celda por celda · endurecimiento del login · las tres capas de
  aislamiento de tenant y la suite parametrizada que las verifica · bus de eventos · entitlements con
  enforcement en el backend · runner de jobs con lock en Mongo · OpenAPI generado desde Zod ·
  migraciones e índices · las fundaciones de front y `@laplace/client` · la librería de componentes
  con accesibilidad verificada · los shells de las cuatro apps con la PWA · la landing prerenderizada.
- **Lo que encontraron los tests, y que es el argumento de por qué se escribieron primero:** el
  índice único compuesto que necesitaba ser parcial y no sparse · el `publicId` que faltaba en el alta
  masiva · tres colores de la paleta que no llegaban a AA · el middleware de tenant al 0% de
  cobertura · el filtro con `tenantId` ajeno que se reescribía en silencio · el hook de Mongoose en
  `save` en vez de `validate` · el `<header>` de `Card` que producía dos banners.
- **Pendiente para Fase 1:** las 32 tareas del MVP vendible, empezando por Venues (F1-01).

## 2026-09-01 — F0-14: la landing pasa a HTML prerenderizado

- **Módulo:** `landing`
- **Tipo:** feature
- **Commit/PR:** rama `feat/action-plan-and-phase-0`
- **Trello:** https://trello.com/c/3R50AoVN (F0-14)
- **Qué cambió:** la landing dejó de ser una SPA. `pnpm build` emite tres HTML servibles —
  `index.html`, `terminos.html`, `privacidad.html` — con el contenido, el título, la meta
  description y las Open Graph adentro, más `sitemap.xml` y `robots.txt`.
- **Por qué:** ADR-005. §5.1.4 lo dice sin vueltas: la landing es el canal de adquisición y una SPA
  sin SSR no rankea. Antes servía un `<div id="root">` vacío.
- **Impacto:** solo la landing. Las otras tres apps siguen siendo SPA, que es lo correcto: están
  detrás de login y no hay nada que indexar.
- **Decisiones que vale la pena registrar:**
  - **Los tests verifican el HTML generado, no el componente.** Es la diferencia que importa: un test
    de componente pasa igual aunque el prerender esté roto, y entonces la landing se ve bien en el
    navegador mientras el buscador recibe una página en blanco. Hay además tests de componente, pero
    verifican otra cosa —estructura y roles, que es lo que ve un lector de pantalla— así que no
    duplican.
  - 🔴 **El build corre ANTES de los tests en el CI.** Las aserciones sobre el HTML necesitan `dist/`;
    con el orden anterior se salteaban en silencio y el SSG quedaba sin cubrir. Un test que no corre
    y no avisa es peor que no tenerlo.
  - **Los metadatos viven como datos, no dentro de cada página.** El sitemap se deriva de la misma
    lista, así que no puede quedar apuntando a una página que ya no existe. Y una ruta sin SEO
    declarado hace fallar el build en vez de publicarse sin título.
  - **Se sacó el `<title>` estático de `index.html`.** El `<Head>` del prerender agrega el suyo, así
    que quedaban dos en el HTML servido.
  - **Las páginas legales no van al sitemap.** No aportan al posicionamiento y diluyen.
  - **`react-router-dom` quedó en v6, no v7.** `vite-react-ssg@0.8` importa
    `react-router-dom/server.js`, que existe en v6 y desapareció en v7 al fusionarse con
    `react-router`. Con v7 el build falla en el prerender.
- **Pendiente:** las nueve secciones completas de §5.1.4 —testimonios, imágenes de las interfaces,
  precios reales, formulario de contacto— son F1-26, igual que el texto legal de verdad, que se sirve
  versionado desde `LegalDocument` y no hardcodeado. Lighthouse en CI queda para cuando haya una URL
  de staging (F0-16).

## 2026-09-01 — F0-13: los shells de las cuatro aplicaciones

- **Módulo:** `infra`
- **Tipo:** feature
- **Commit/PR:** rama `feat/action-plan-and-phase-0`
- **Trello:** https://trello.com/c/3UKJYLVJ (F0-13)
- **Qué cambió:** las cuatro apps dejaron de ser un "hola mundo". DFSA y DFSM tienen header, panel
  lateral colapsable y footer; el DFSM además el selector de centro. La WAFM tiene su shell mobile
  con bottom nav y la PWA completa: manifest, service worker, offline del horario, ofrecimiento de
  instalación y popup de actualización. La landing tiene su header con las secciones de §5.1.4.
- **Por qué:** es el esqueleto sobre el que se cuelgan todas las pantallas de Fase 1.
- **Impacto:** ninguno sobre el modelo de datos. `@laplace/config` gana un export nuevo
  (`testing/jsdom-dialog`) y `@laplace/ui` los dos shells.
- **Decisiones que vale la pena registrar:**
  - **La WAFM tiene las dos navegaciones en el DOM y decide CSS.** §5.1.3 pide barra superior; su
    `[+]` recomienda bottom nav porque el pulgar no llega arriba en un teléfono grande. Se cumplen
    las dos: abajo en mobile, arriba desde 768 px. No hubo que elegir.
  - 🔴 **En iOS se muestran instrucciones, no un botón.** `beforeinstallprompt` no existe en Safari,
    así que un botón "Instalar" ahí no hace absolutamente nada — en la mitad de los usuarios. Hay un
    test que verifica que en iOS aparecen los pasos de "Compartir → Agregar a inicio" y que el botón
    nativo **no** está.
  - 🔴 **El popup de actualización es bloqueante pero tiene escape a los 30 segundos.** Se cierra
    cuando el service worker nuevo toma control, y los service workers fallan. Sin el escape, un bug
    de SW deja al socio encerrado en un cartel, sin poder reservar y sin entender por qué. Con él,
    ese bug se convierte en una molestia de treinta segundos.
  - **El modal de instalación no se muestra en cada visita.** La v1 lo pedía así; mostrarlo siempre
    es la forma más rápida de que lo cierren sin leerlo. Máximo una vez cada 7 días, nunca más tras
    dos rechazos.
  - **El service worker se registra en modo `prompt`, no `autoUpdate`.** La app no se cambia abajo
    de los pies de alguien que está reservando.
  - **`Card` usa un `div` y no un `<header>` para su encabezado.** Dentro de un `<section>` el
    `<header>` no es un `banner` según la spec de HTML, pero más de una implementación de roles lo
    trata como si lo fuera, y la página terminaba con dos banners. Lo encontró un test.
  - **El patch de `<dialog>` para jsdom vive en `@laplace/config`, compartido.** jsdom no implementa
    `showModal()`, así que sin él un modal renderiza pero nunca queda `open` y ningún test lo
    encuentra. Se completa en el entorno de test en vez de cambiar la implementación: en el navegador
    `showModal()` es justamente lo que da el foco atrapado.
  - **El cliente de API salió de `providers.tsx` a su propio archivo.** No es un componente, y
    mezclarlos rompía Fast Refresh además de mezclar responsabilidades.
- **Pendiente:** los íconos de la PWA (`icon-192.png`, `icon-512.png`) son placeholders del manifest
  y hay que generarlos con la identidad visual. El routing real con Tanstack Router entra con las
  pantallas de Fase 1 — hoy cada app tiene una sola vista. El SSG de la landing es F0-14.

## 2026-09-01 — F0-11: fundaciones de front y el paquete `@laplace/client`

- **Módulo:** `infra`
- **Tipo:** feature
- **Commit/PR:** rama `feat/action-plan-and-phase-0`
- **Trello:** https://trello.com/c/cWVGBQKo (F0-11)
- **Qué cambió:** las cuatro apps tienen su stack: Tanstack Query/Router/Form/Table, Zustand, Nuqs,
  Motion y Fontsource instalados, y un paquete nuevo `@laplace/client` con lo que comparten — el
  cliente de API tipado, los defaults de Query, el catálogo i18n es-AR, los helpers de fecha y
  dinero, y el store de UI. 72 tests, 98% de cobertura.
- **Por qué:** sin esto, cada app resuelve por su cuenta cómo llama a la API, cómo muestra una fecha
  y dónde guarda el Venue activo, y las cuatro lo resuelven un poco distinto.
- **Impacto:** un paquete nuevo. ADR-003 lista `schemas · ui · types · config`; `client` es una
  extensión de esa lista para el runtime del front. La alternativa era meterlo en `@laplace/ui`, que
  por definición no puede tener lógica de negocio ni saber de la API.
- **Decisiones que vale la pena registrar:**
  - **El cliente manda un `requestId` en cada pedido y lo devuelve en el error.** Es la mitad del
    circuito de §11.3: el backend ya lo loguea, y sin que el front lo mande y lo muestre, soporte no
    puede encontrar nada.
  - **El envelope de error se traduce a un error tipado en un solo lugar.** Sin eso cada pantalla
    parsea el JSON a mano, y alguna lo parsea mal justo el día que falla algo. Si la respuesta ni
    siquiera trae el envelope — un 502 del proxy, un HTML de error — igual sale un `ApiRequestError`
    con código genérico: la pantalla no tiene por qué distinguir esos casos.
  - **Un abort no es un fallo de red.** Lo pidió el propio cliente al cambiar de pantalla, así que
    no dispara el `onError` global ni le muestra un cartel a nadie.
  - 🔴 **Las mutaciones no se reintentan solas.** Un reintento automático puede duplicar una reserva
    o un cobro. El reintento es decisión de quien la llama, con su `Idempotency-Key`.
  - **Las queries no reintentan un 409 ni un 403.** La clase va a seguir llena la segunda vez y los
    permisos no cambian por insistir: reintentar solo hace esperar al usuario para el mismo error.
    Un 500, un 429 y un corte de red sí se reintentan.
  - **Las fechas se calculan en la TZ del Venue y en días de calendario.** Hay un test que cruza el
    cambio de horario de verano y muestra que contar en horas fijas da una hora distinta — lo
    suficiente para que un pack venza el día equivocado. Es el test que §Testing.6 declara
    obligatorio, ahora también del lado del front.
  - **La semana arranca el lunes.** El default de `es-AR` en algunos runtimes es domingo, y una
    agenda de gimnasio que empieza el domingo se lee mal.
  - **La frontera de estado la aplica el lint, no la buena voluntad:** un archivo bajo `state/` no
    puede importar `@tanstack/react-query`. Es la forma concreta en que el estado de servidor se
    filtra a Zustand y genera dos fuentes de verdad para el mismo dato.
  - **i18n desde el día 1 sin traer una librería de i18n.** Agregarlo después obliga a revisar cada
    string de las cuatro apps; traer una librería completa para un solo idioma es la otra
    exageración. Una clave que falta devuelve la clave: un texto feo se ve y se arregla, una pantalla
    en blanco no.

## 2026-09-01 — F0-12: la librería de componentes, con la accesibilidad verificada

- **Módulo:** `ui`
- **Tipo:** feature
- **Commit/PR:** rama `feat/action-plan-and-phase-0`
- **Trello:** https://trello.com/c/QIe4bU1b (F0-12)
- **Qué cambió:** `@laplace/ui` pasó de un botón a la librería que van a usar las cuatro apps:
  tokens con dark/light, FormField, Input, Textarea, Select, Checkbox, Radio, RadioGroup, Dialog,
  Toast, Table, Tabs, Skeleton, EmptyState, ErrorState, Badge, Card y el ThemeProvider. Más
  Storybook como catálogo visual. 81 tests.
- **Por qué:** es la base de todo lo que se vea en pantalla, y §6 pide WCAG 2.2 AA como objetivo
  **verificable**, no como intención.
- **Impacto:** ninguno sobre el modelo de datos. La regla de lint `react-refresh` se ajustó para
  `packages/ui`: se permiten por nombre `useTheme`, `resolveTheme`, `useToast` y `useFieldProps`, en
  vez de apagarla, así sigue avisando si alguien exporta algo por accidente.
- 🔴 **El test de contraste encontró tres fallas reales en la paleta**, que es exactamente para lo
  que se escribió:
  - `brand-600` daba **3.95:1** con texto blanco encima, en los dos temas: el botón primario del
    producto no llegaba a AA. Corregido a `oklch(0.56 …)`, que da 4.63:1.
  - `success-600` daba **3.16:1** con blanco. Corregido a `oklch(0.545 …)`.
  - El anillo de foco (`brand-500`) sobre el fondo casi blanco del tema claro daba **2.79:1** y
    prácticamente no se veía. Se oscurece solo en light, porque en dark contrasta 6.65:1 y está bien.
- **Decisiones que vale la pena registrar:**
  - **El contraste se calcula, no se mide con axe.** axe necesita canvas para leer el color realmente
    pintado y jsdom no lo implementa: ahí la regla `color-contrast` no corre y **pasa siempre**, que
    es peor que no tenerla porque da una falsa sensación de cobertura. El test lee `styles.css`,
    convierte oklch a sRGB lineal y aplica la fórmula de WCAG. Es exacto, es determinista, y falla si
    alguien toca un token sin mirar el contraste.
  - **El Dialog usa el `<dialog>` nativo.** `showModal()` da foco atrapado, cierre con Escape, fondo
    inerte y restauración del foco — las cuatro cosas que un modal hecho a mano suele resolver mal —
    y sin una sola dependencia. Lo único que hubo que agregar es el cierre por backdrop.
  - **Las Tabs usan roving tabindex.** Con seis pestañas, el comportamiento ingenuo obliga a apretar
    Tab seis veces solo para pasar de largo.
  - **`FormField` existe porque el cableado de accesibilidad es lo que todos olvidan.** Sin
    `aria-describedby` el lector de pantalla nunca lee el mensaje de error; sin `aria-invalid` ni
    siquiera sabe que el campo está mal. Cada formulario que lo resuelve por su cuenta lo resuelve un
    poco distinto, y alguno lo resuelve mal.
  - **`EmptyState` exige la acción**, no la acepta como opcional: §6 dice que los estados vacíos con
    acción son el 80% del onboarding percibido, y uno sin acción deja al usuario mirando una pantalla
    que no le dice qué hacer.
  - **El error muestra el código y el `requestId`**, en `ErrorState` y en el Toast: es lo que §5 pide
    para que el usuario pueda pasárselos a soporte.
  - **`system` es un tercer estado de tema real**, no un sinónimo de dark, y sigue al sistema en vivo.
- **Pendiente:** Storybook queda como catálogo visual y no corre en CI — el rigor automático (axe y
  contraste) vive en vitest, que es rápido y no necesita navegador. Los shells que consumen esto son
  F0-13.

## 2026-09-01 — F0-15: gate de cobertura por criticidad

- **Módulo:** `ci`
- **Tipo:** infra
- **Commit/PR:** rama `feat/action-plan-and-phase-0`
- **Trello:** https://trello.com/c/tOXKVaOx (F0-15)
- **Qué cambió:** `pnpm test:coverage` corre en los 8 paquetes y falla si la cobertura de una zona
  baja de su umbral. El CI lo ejecuta en lugar de `pnpm test` y publica el `lcov` como artefacto.
- **Por qué:** §6 lo dice sin vueltas — perseguir 90% en todo el código lleva a escribir tests
  triviales de getters para levantar el número mientras la lógica de reserva concurrente queda sin
  cubrir. Los umbrales van por criticidad: 95% donde hay permisos, plata y cupos.
- **Impacto:** ninguno sobre el modelo de datos. `AppEnv` pasa a declarar también el contexto de
  organización, porque una ruta puede montar cualquier combinación de guards y el tipo tiene que
  dejar componerlos sin castear.
- **Lo que encontró el gate al ponerlo** (que es exactamente para lo que sirve):
  - 🔴 **`tenancy/middleware.ts` estaba al 0%.** Es la pieza que resuelve el `tenantId` desde la
    sesión, la más sensible del backend, y no tenía un solo test. Ahora tiene once, incluidos los
    que verifican que un `tenantId` en el body, en la query o en un header **se ignora**.
  - 🔴 **`insertMany` sobre el modelo no generaba `publicId`**, que es obligatorio, así que un alta
    masiva fallaba con un ValidationError. Importa porque F1-05 tiene que meter 143 socios de un
    CSV. Se agregó `createMany` al repositorio, que sí lo genera.
  - **`config/env.ts` estaba al 0%.** Es lo que impide que la API levante sin sus variables; ahora
    hay trece tests, incluido uno que verifica que el mensaje nombra **todas** las que faltan y no
    solo la primera.
  - **`@laplace/schemas` estaba al 45%.** Es la fuente única de validaciones: lo que se escribe ahí
    decide qué entra al sistema. `pagination.ts` y `tenant.ts` no tenían ningún test.
  - `jobs/lock.ts` al 60% (faltaba `heldBy`, que es lo que va a mostrar el panel de salud del DFSA)
    y varios caminos defensivos de los guards.
- **Decisión sobre los umbrales:** los de rama van unos 10 puntos por debajo de los de línea, a
  propósito. Exigir 95% de ramas obliga a testear cada `??` defensivo, que es ruido y no cobertura.
  Lo que importa es que la línea se ejecute y que el caso de error esté probado.
- **La verificación del gate no fue teórica:** falló cinco veces durante esta tarea, una por cada
  hueco de arriba, y recién pasó cuando se cubrieron. Cobertura final de la API: 96% statements,
  97% líneas, 634 tests.

## 2026-09-01 — F0-10: migraciones e índices obligatorios

- **Módulo:** `infra`
- **Tipo:** infra
- **Commit/PR:** rama `feat/action-plan-and-phase-0`
- **Trello:** https://trello.com/c/yQOG1Nw9 (F0-10)
- **Qué cambió:** los índices de §5.2.3 se crean por migración versionada y reversible, nunca a mano
  en Atlas. Se agregan también los de la infraestructura de Fase 0 (`loginAttempt`, `jobLock`,
  `jobRun`) y los TTL de retención. Hay un archivo con los nombres canónicos de colección para que
  modelos y migraciones no se desincronicen.
- **Por qué:** §6 lo exige, y un índice mal puesto no se nota hasta que la colección crece — momento
  en el que ya es tarde y caro.
- **Impacto:** 40 índices sobre 25 colecciones. El único de `bookings` sobre
  `{ tenantId, sessionId, memberId }` y el de `payments` sobre `{ tenantId, idempotencyKey }` son
  los que sostienen la no-sobreventa y la idempotencia de los webhooks.
- **Decisiones que vale la pena registrar:**
  - 🔴 **Los únicos compuestos son PARCIALES, no sparse.** Escribir el test destapó un error real:
    en un índice compuesto, `sparse` solo omite el documento si faltan **todos** los campos
    indexados. Como `tenantId` siempre está, un socio sin DNI igual se indexaba con `docId: null`, y
    el segundo socio sin DNI chocaba contra el primero. Con `partialFilterExpression:
{ docId: { $type: 'string' } }` el índice solo mira a los que efectivamente cargaron documento.
    Lo mismo para `idempotencyKey`, donde el caso "pago manual sin clave" es el más común de todos.
    Sin esto, el segundo cobro en efectivo del día habría fallado.
  - **El único de `publicId` sí es sparse** y alcanza, porque es de un solo campo.
  - **`tenantId` va primero en todo índice compuesto de negocio**, y hay un test que lo recorre y lo
    verifica índice por índice. Si va segundo, Mongo no puede acotar por tenant con el índice y
    termina leyendo documentos de otros centros para después descartarlos.
  - **Los índices se declaran como datos, no como llamadas sueltas.** Eso permite que el test los
    recorra y verifique que cada uno existe de verdad en Mongo, con sus llaves y su unicidad.
  - **`down` no borra datos y se puede correr dos veces.** Revertir un índice no puede costar
    información, y `dropIndex` sobre un índice que no existe tira error.
  - **Los nombres de colección viven en un solo archivo**, con un test que verifica que la migración
    y el código digan lo mismo. Un índice creado sobre `classsessions` mientras el modelo escribe en
    `classSessions` no protege nada y no da ningún síntoma.

## 2026-09-01 — F0-09: OpenAPI generado desde los schemas Zod

- **Módulo:** `infra`
- **Tipo:** feature
- **Commit/PR:** rama `feat/action-plan-and-phase-0`
- **Trello:** https://trello.com/c/Qmqy7tcA (F0-09)
- **Qué cambió:** la API documenta sola lo que expone. `/api/v1/openapi.json` genera el documento
  desde el registro de rutas y sus schemas Zod, y `/api/v1/docs` sirve Swagger UI.
- **Por qué:** ADR-003 lo pide explícitamente: la doc se genera, no se escribe a mano. Escrita a
  mano se desactualiza siempre, y una doc que miente es peor que no tener doc.
- **Impacto:** ninguno sobre el modelo de datos. `RouteSpec` gana los campos de documentación
  (`summary`, `tags`, `request`, `response`, `errorCodes`), así que el registro que ya existía para
  el aislamiento pasa a ser también la fuente de la doc: un solo lugar donde declarar cada ruta.
- **Decisiones que vale la pena registrar:**
  - **No hizo falta ninguna dependencia para el schema.** Zod 4 trae `z.toJSONSchema()` con target
    `openapi-3.0`. Se evaluó `@hono/zod-openapi`, que habría obligado a reescribir cómo se declaran
    las rutas y a mantener un segundo registro en paralelo al de F0-05.
  - **El envelope de error figura como respuesta posible de toda ruta**, con los códigos concretos
    que esa ruta puede devolver escritos en la descripción. Es lo que le permite a alguien de
    soporte saber qué esperar sin leer el código.
  - **El documento se genera en cada pedido, no al arrancar.** Así refleja lo que la app tiene
    montado ahora. Hay un test que registra una ruta con la app ya levantada y comprueba que
    aparece.
  - **En producción la doc pide sesión.** El mapa completo de la API, con cada parámetro y cada
    código de error, es material de reconocimiento; en dev se sirve libre porque pedirla ahí solo
    estorba.
- **Pendiente:** hoy el documento tiene solo las rutas de prueba. Se llena solo con los módulos de
  Fase 1, porque cada uno declara su `RouteSpec` con sus schemas.

## 2026-09-01 — F0-08: runner de jobs con lock en Mongo

- **Módulo:** `infra`
- **Tipo:** feature
- **Commit/PR:** rama `feat/action-plan-and-phase-0`
- **Trello:** https://trello.com/c/pMBvhDUL (F0-08)
- **Qué cambió:** existe el motor de los catorce procesos automáticos de §10. Cron in-process, lock
  atómico en Mongo, registro de cada corrida con su duración y su resultado, y `JOBS_ENABLED` para
  apagarlos en local.
- **Por qué:** materializar sesiones, promover la waitlist, marcar no-shows, expirar contratos,
  avisar de mora y calcular métricas son todas cosas que tienen que pasar sin que nadie apriete
  nada. Y según ADR-006, sin Redis: el volumen de Fase 0 y 1 no lo justifica.
- **Impacto:** colecciones `jobLock` y `jobRun`. Código en uso: `LP-SYS-500-005`. Variable de
  entorno nueva: `JOBS_ENABLED`.
- **Decisiones que vale la pena registrar:**
  - **El lock se toma con el mismo patrón atómico que el cupo de una clase**: un
    `findOneAndUpdate` condicionado por `expiresAt`. La garantía la da Mongo, no la disciplina del
    código. Hay un test de 20 adquisiciones simultáneas donde gana exactamente una — la misma
    exigencia que le pone la spec a la reserva concurrente.
  - **Con `upsert`, el lock tomado se manifiesta como un error de clave duplicada.** Si el lock
    existe y sigue vigente, el filtro no matchea, Mongo intenta insertar y choca contra el `_id`.
    Ese `E11000` **es** el caso "está tomado", no un fallo, y hay que tratarlo así explícitamente.
  - **El TTL importa tanto como el lock.** Si el proceso muere a mitad de un job, el lock se libera
    solo y la próxima corrida lo retoma. Sin TTL, un crash deja el job colgado para siempre — y
    nadie se entera hasta que alguien pregunta por qué hace tres días no se marcan los no-shows.
  - **El lock se libera aunque el job falle** (`finally`). Si no, el fallo de hoy bloquearía la
    corrida de mañana, que es cuando el problema se vuelve grave.
  - **Una instancia no puede liberar el lock de otra**: el `delete` filtra por `instanceId`.
  - **La idempotencia es responsabilidad del handler, no del runner.** El runner garantiza que dos
    instancias no corran a la vez; no garantiza que un job no corra dos veces. Está escrito en el
    tipo y hay un test que lo demuestra con un `upsert`.
- **Pendiente:** los jobs concretos se registran en sus módulos, con Fase 1. El índice TTL de
  `jobRun` y la alerta externa ante fallo son de F0-10 y F0-16.

## 2026-09-01 — F0-07: entitlements con enforcement en el backend

- **Módulo:** `entitlements`
- **Tipo:** feature
- **Commit/PR:** rama `feat/action-plan-and-phase-0`
- **Trello:** https://trello.com/c/GO6UQi5J (F0-07)
- **Qué cambió:** Basic, Pro y Max dejaron de ser texto en la landing. Hay un catálogo declarativo
  con sus módulos, features y límites, y tres guards que los aplican: `requireModule`,
  `requireFeature` y `requireWithinLimit`. Más la validación de downgrade y el aviso al 80%.
- **Por qué:** §2.1.22 lo dice sin vueltas — sin esto los planes son decorativos, y el enforcement
  tiene que estar en el backend porque ocultar un botón no es una restricción.
- **Impacto:** `Organization.planId` y `planLimits` (overrides). Códigos en uso: `LP-ENTL-403-001`,
  `LP-ENTL-403-002`, `LP-ENTL-403-003`. El catálogo vive en código, no en base: es configuración de
  producto, no dato de tenant.
- **Decisiones que vale la pena registrar:**
  - **Manda el empaquetado de §2.2.1, no el de §2.2.** La spec revisa el suyo y explica por qué: sin
    Members ni Billing, Basic es inutilizable y Pro pasa a ser el piso real. Así que Basic incluye
    gestión de miembros y cobro manual, y su límite de staff baja de 10 a 3 — un centro de 60 socios
    no tiene 10 empleados. Hay un test por cada fila de esa tabla.
  - **Se distingue módulo de feature.** Basic ve la librería de ejercicios (módulo `training`) pero
    no la edita (feature `training.write`), y hace check-in básico pero sin QR. Sin esa distinción,
    las filas de la tabla que dicen "solo lectura" o "básico" no se podían modelar.
  - **El mensaje del límite dice qué excede y por cuánto.** "Alcanzaste el máximo de 60 miembros
    activos de tu plan Basic" y no "límite alcanzado": sin el número, el usuario tiene que adivinar
    qué borrar.
  - **El downgrade lista TODAS las violaciones, no solo la primera.** Si un centro excede miembros,
    sedes y staff a la vez, verlas de a una es tres viajes para el mismo problema.
  - **El contador de uso se inyecta y tiene que contar activos, no históricos.** Archivar a los
    socios que se fueron no puede costar plata (§2.2.1). El guard no cuenta: exige el contador y lo
    documenta.
  - **Los entitlements se cachean por organización** con invalidación explícita al cambiar de plan.
    Sin cache serían una consulta extra por request; sin invalidación, el centro seguiría con el
    plan anterior después de pagar el upgrade.
- **Pendiente:** conectar los guards a rutas reales, que llega con los módulos de Fase 1. El
  prorrateo del upgrade y el cambio al fin del ciclo son de F1-25.

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

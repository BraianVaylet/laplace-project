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

## 2026-09-05 — F1-36: el padrón y los códigos de invitación

- **Módulo:** `members`
- **Tipo:** feature
- **Commit/PR:** —
- **Trello:** https://trello.com/c/zsl1KwES (F1-36) — movida a **Completadas**
- **Qué cambió:** el DFSM tiene `/miembros`: el padrón con filtro por estado, el alta desde el
  mostrador y los códigos de invitación con su generación y su revocación. Cada nombre enlaza a la
  ficha 360.
- **Por qué:** cuarta de las cinco tarjetas de deuda de UI, y el último paso del asistente de
  primeros pasos.
- **Impacto:** ninguno sobre la API ni sobre el modelo. La columna de saldo aparece solo si la API
  mandó saldos: desde F1-06 llegan en `null` para quien no puede ver plata, y pintar un "$0" sería
  inventar un dato equivocado.
- **Pendiente:** F1-37 (vender y cobrar) **cambió de alcance**: vender son cuatro llamadas y hoy
  ninguna las junta, así que encadenarlas desde el navegador dejaría contratos sin cargo o cargos
  pagados con el contrato inactivo. Necesita un caso de uso atómico en la API antes que la pantalla.

## 2026-09-05 — F1-35: la agenda se arma por pantalla, y los diálogos dejan de compartir id

- **Módulo:** `schedule`
- **Tipo:** feature
- **Commit/PR:** `93ce381` (rama `feat/phase-1-ui-debt`)
- **Trello:** https://trello.com/c/kiYLhCsp (F1-35) — movida a **Completadas**
- **Qué cambió:** el DFSM tiene `/horario`: la grilla semanal por sede, el alta de plantillas, la
  edición eligiendo "solo esta" o "esta y las que siguen", y la cancelación con motivo y con el
  número de inscriptos a la vista. El E2E del camino 1 ya carga sede, producto y clase por pantalla.
- **Por qué:** tercera de las cinco tarjetas de deuda de UI, y la más usada de las cinco: es donde
  el SMU pasa el tiempo cuando arma la semana.
- **Impacto:** ninguno sobre la API ni sobre el modelo. **Fix de accesibilidad en `@laplace/ui`:**
  `Dialog` escribía `id="dialog-title"` a mano, así que con dos diálogos en pantalla el id se
  duplicaba y `aria-labelledby` apuntaba al título del otro — el lector anunciaba el modal
  equivocado. Ahora se generan con `useId`.
- **Pendiente:** las dos pantallas que faltan — socios y la venta desde el mostrador (F1-36 y
  F1-37).

## 2026-09-05 — F1-34: el catálogo se carga por pantalla, y el rate limit se puede apagar solo en dev

- **Módulo:** `products`
- **Tipo:** feature
- **Commit/PR:** `5041ba4` (rama `feat/phase-1-ui-debt`)
- **Trello:** https://trello.com/c/tCLskxpw (F1-34) — movida a **Completadas**
- **Qué cambió:** el DFSM tiene `/productos`: el listado y el alta de los siete tipos de §2.1.17,
  con el formulario siguiendo al tipo elegido. El E2E del camino 1 ya crea la sede y el producto por
  pantalla.
- **Por qué:** segunda de las cinco tarjetas de deuda de UI. Sin producto no hay contrato, y sin
  contrato nadie puede reservar.
- **Impacto:** ninguno sobre el modelo de datos. **Sí sobre el entorno:** aparece `AUTH_RATE_LIMIT`,
  que solo se puede poner en `off` con `APP_ENV=dev` — el arranque lo rechaza en staging y en prod,
  con su test. Lo destapó el arnés de E2E, que crea decenas de cuentas desde una sola IP y chocaba
  contra el rate limit de §9.1. La suite de E2E pasó a correr **en serie**: comparte una sola base
  efímera, y el paralelismo solo agregaba fallos que dependían de quién llegaba primero.
- **Pendiente:** las tres pantallas que faltan — agenda, socios y la venta desde el mostrador
  (F1-35 a F1-37).

## 2026-09-04 — F1-33: las sedes ya se cargan por pantalla

- **Módulo:** `venues`
- **Tipo:** feature
- **Commit/PR:** `3a57eeb` (rama `feat/phase-1-ui-debt`)
- **Trello:** https://trello.com/c/fsFloQOI (F1-33) — movida a **Completadas**
- **Qué cambió:** el DFSM tiene `/sedes` y `/sedes/:venueId`: crear la sede, cargar sus horarios,
  configurar su política de reserva, agregar salas y archivarla. La entrada del menú ya existía
  desde F0-13 y no llevaba a ningún lado.
- **Por qué:** es la primera de las cinco tarjetas de deuda de UI que dejó la Fase 1. Sin esta
  pantalla, el centro no se puede armar sin `curl`, y el asistente de primeros pasos mandaba a una
  ruta inexistente.
- **Impacto:** ninguno sobre la API ni sobre el modelo de datos: todo el backend ya estaba. El E2E
  del camino 1 ahora crea la sede **por pantalla** en vez de por API, que era la deuda que F1-31
  había anotado.
- **Pendiente:** las otras cuatro pantallas — productos, agenda, socios y la venta desde el
  mostrador (F1-34 a F1-37).

## 2026-09-04 — F1-32: la documentación del producto, y con eso la Fase 1 cerrada

- **Módulo:** `docs`
- **Tipo:** docs
- **Commit/PR:** `7727b83` (rama `feat/phase-1-mvp`)
- **Trello:** https://trello.com/c/KOoe9EOR (F1-32) — movida a **Completadas**
- **Qué cambió:** el repo tiene `README.md` —que no existía— y los cuatro documentos que pide §5:
  funcional, técnico, de arquitectura y uno por aplicativo. Se sumó `pnpm docs:links`, que corre en
  CI y falla si un enlace relativo de la documentación apunta a algo que no existe.
- **Por qué:** era la última tarjeta de Fase 1, y su criterio es concreto: alguien que nunca vio el
  repo lo clona, lee el técnico y lo levanta sin preguntar nada.
- **Impacto:** ninguno sobre el código ni sobre el modelo de datos. El OpenAPI no hizo falta
  tocarlo: sale del mismo registro de rutas que usan los guards, y ya tenía su test de que ninguna
  ruta queda sin documentar. Las tres entradas de esta bitácora que estaban sin commit —las
  anteriores al plan— quedaron completas.
- **Pendiente:** la prueba de clonar en una máquina limpia es manual y queda para cuando haya una.
  Se verificó que cada comando, puerto y ruta del documento técnico existe tal como está escrito.

## 2026-09-04 — F1-06: la ficha 360 del socio, y la deuda que se le escapaba al coach

- **Módulo:** `members`
- **Tipo:** feature
- **Commit/PR:** `442d7f3` (rama `feat/phase-1-mvp`)
- **Trello:** https://trello.com/c/gWV6GOZC (F1-06) — movida a **Completadas**
- **Qué cambió:** el DFSM tiene la pantalla que más se usa: abrís un socio desde el buscador y ves
  sus datos, su estado de cuenta, sus packs con lo que le queda, lo que tiene reservado, su
  asistencia de los últimos 90 días, lo que firmó y las notas internas. Ruta nueva
  `GET /api/v1/members/:id/overview` y pantalla `/miembros/:memberId`.
- **Por qué:** era la tarjeta que quedaba de Fase 1 con todas sus dependencias cerradas, y §2.1.7
  la describe como la pantalla más usada del producto: si obliga a navegar a otras cinco, se siente
  lento aunque la API conteste rápido.
- **Impacto:** ninguno sobre el modelo de datos. **Fix de seguridad:** `balanceCents` viajaba en
  toda respuesta de socio, y esas rutas solo piden `athlete:read` — el permiso del coach. La deuda
  de cada socio se le escapaba sin que nadie la pidiera, contra §2.1.12. Ahora sale `null` para
  quien no tiene `billing:read`, decidido en el servidor. También se arregló `Skeleton`, que
  descartaba en silencio el `aria-label` que le pasaban seis pantallas.
- **Pendiente:** el botón "Venderle un pack" del estado vacío no lleva a ningún lado: la pantalla de
  venta del DFSM sigue sin existir, igual que las altas que arrastran F1-30 y F1-31.

## 2026-09-04 — F1-31: los tres caminos críticos, en Playwright y en CI

- **Módulo:** `ci`
- **Tipo:** infra
- **Commit/PR:** `62c7b8d` (rama `feat/phase-1-mvp`)
- **Trello:** https://trello.com/c/3aLdhhHu (F1-31) — movida a **Completadas**
- **Qué cambió:** `pnpm test:e2e` recorre los tres caminos que §Testing.7 no negocia —alta y primera
  clase publicada, reservar/cancelar/recuperar el crédito, y asistencia con el no-show que marca el
  job— en Chrome de escritorio y en mobile. El CI los corre en su propio job y publica capturas y
  traces cuando algo falla; `deploy-staging` ahora depende de que pasen.
- **Por qué:** eran el requisito de §Testing.7 y los navegadores no estaban ni instalados. Sin esto,
  romper la devolución de crédito al cancelar no lo detectaba nadie hasta que lo dijera un socio.
- **Impacto:** ninguno sobre el modelo de datos ni sobre la API. El arnés (`e2e/support/`) levanta un
  Mongo **efímero** en memoria, corre las migraciones y arranca el entrypoint real de la API: nunca
  staging ni producción. El disparador de jobs vive solo en `e2e/` — agregarle a la API una ruta
  para correr jobs sería abrir en producción una puerta que solo necesita el test. `pnpm typecheck`
  ahora incluye `e2e/`, que hasta hoy no miraba nadie.
- **Pendiente:** lo que los caminos hacen por API es lo que todavía no tiene pantalla (altas del
  DFSM y venta de packs, deuda de F1-06 y F1-30). La medición real del time-to-first-class de §2.0
  sigue siendo una prueba manual.

## 2026-09-04 — F1-30: el asistente de primeros pasos

- **Módulo:** `susc`
- **Tipo:** feature
- **Commit/PR:** `2801f3c` (rama `feat/phase-1-mvp`)
- **Trello:** https://trello.com/c/N3mXndHu (F1-30) — movida a **Completadas**
- **Qué cambió:** el SMU que recién se registró abre el DFSM y encuentra el camino: crear la sede,
  cargar los horarios, publicar la primera clase, crear un producto e invitar socios, con barra de
  progreso, la opción de dejar cualquier paso para después y la de retomarlo. Tres rutas nuevas bajo
  `/api/v1/subscription/onboarding`.
- **Por qué:** la métrica de §2.0 es time-to-first-class menor a 30 minutos, y el home del primer
  día era un "elegí un centro" sin salida: el que acaba de registrarse no tiene ninguna sede.
- **Impacto:** `Subscription` suma `signedUpAt` y `onboarding { skippedSteps, completedAt,
firstClassPublishedAt }`. **No** guarda `step` ni `completedSteps[]` como decía la tarjeta: el
  progreso se cuenta del estado real del centro en cada consulta, porque un checklist
  auto-declarado marca "clase publicada" sin que exista una clase. Saltear un paso lo deja
  pendiente, nunca hecho. Ningún código de error nuevo: el paso inventado en la URL contesta
  `LP-SYS-422-006`, que ya es el de validación en el borde.
- **Pendiente:** las pantallas de alta de sede, clase, producto y códigos del DFSM no existen
  todavía, así que el asistente marca el camino pero no lleva hasta el formulario. La prueba real
  de los 30 minutos es del E2E de F1-31.

## 2026-09-04 — F1-29: lo del socio sobre lo suyo

- **Módulo:** `account`
- **Tipo:** feature
- **Commit/PR:** `68d290d` (rama `feat/phase-1-mvp`)
- **Trello:** https://trello.com/c/L0822vqC (F1-29) — movida a **Completadas**
- **Qué cambió:** el socio abre la WAFM y ve sus packs —cuántas clases le quedan, hasta cuándo y en
  qué clases valen—, edita su perfil y su contacto de emergencia, cambia su foto, se descarga todos
  sus datos en JSON y puede pedir la baja. Seis rutas nuevas bajo `/api/v1/my/*`.
- **Por qué:** son las dos preguntas que hoy el socio manda por WhatsApp al centro (§2.1.2), y los
  derechos de acceso y supresión de la Ley 25.326 (§9.2), que escondidos detrás de un mail a soporte
  no se cumplen.
- **Impacto:** `Member` suma `avatarKey`, `deletionRequestedAt` y `deletionReason`. Ninguna ruta de
  `/my/*` acepta un `memberId`: sale de la sesión. El tipo de la foto se decide por los **bytes**,
  no por la extensión ni el `Content-Type` —los dos los escribe quien sube el archivo, y un SVG
  renombrado a `.png` ejecutaría script contra el dominio que lo sirve—, con tope de 2 MB y enlace
  firmado que vence a los 15 minutos. Códigos nuevos: `LP-ACCT-422-001` y `LP-ACCT-413-002`. Se
  arregló además el cliente de API compartido, que serializaba todo cuerpo con `JSON.stringify` y
  convertía cualquier archivo en `{}`.
- **Pendiente:** Backblaze B2 no está aprovisionado (F0-16 sigue bloqueada): el almacenamiento va en
  memoria con el mismo contrato y la misma firma HMAC, así que se reemplaza sin tocar el servicio.
  Las preferencias de notificación quedan en la pantalla de F1-21.

## 2026-09-04 — Fix: los entitlements leían la organización por un campo que no existe

- **Módulo:** `entitlements`
- **Tipo:** fix
- **Commit/PR:** `597b5ea` (rama `feat/phase-1-mvp`)
- **Trello:** —
- **Qué cambió:** `createOrganizationPlanReader` consultaba la organización de Better Auth por un
  campo `id` que el adaptador de Mongo **no guarda** — la guarda con `_id`, y además como
  `ObjectId`. La consulta no encontraba nunca la fila, así que todo centro caía al plan del trial:
  un cliente de Max operando como Basic, sin que nada fallara ni se logueara.
- **Por qué:** apareció escribiendo F1-25, cuando un test contra la colección real devolvió `null`
  donde tenía que haber una organización. El test unitario del lector no lo veía porque su doble de
  la base tenía la forma equivocada — el mismo error, copiado a los dos lados.
- **Impacto:** ninguno sobre el modelo de datos. El lector ahora consulta por `_id`, aceptando el
  `ObjectId` y el texto. Se corrigió también el doble de la base del test unitario, y se agregó un
  test de integración contra una organización real: un doble no puede probar la forma de lo real.
- **Pendiente:** ninguno.

## 2026-09-04 — Fix: un socio podía leer las reservas de un compañero

- **Módulo:** `booking`
- **Tipo:** fix
- **Commit/PR:** `5a8ca45` (rama `feat/phase-1-mvp`)
- **Trello:** —
- **Qué cambió:** `GET /api/v1/bookings` aceptaba `?memberId=` sin chequear permiso. Como
  `booking.read` lo tiene también el socio — lo necesita para ver las suyas —, cualquiera podía
  pedir `/api/v1/bookings?memberId=mem_otro` y leer las reservas de un compañero de su mismo
  centro. Ahora el parámetro solo lo honra quien puede reservar por otro
  (`booking.createForOther`), que es el mostrador.
- **Por qué:** apareció escribiendo F1-28, al cablear la pantalla que consume ese endpoint. La
  suite de aislamiento no lo veía porque prueba **entre tenants**, y acá atacante y víctima son del
  mismo.
- **Impacto:** ninguno sobre el modelo de datos. Dos tests nuevos: que el socio no vea las ajenas y
  que el mostrador sí.
- **Pendiente:** vale revisar si hay otros endpoints que acepten un identificador de otro por query
  con un permiso que el socio también tiene. Es el mismo patrón.

## 2026-09-04 — F1-28: el horario y la reserva del socio

- **Módulo:** `wafm` · `booking` · `auth`
- **Tipo:** feature
- **Commit/PR:** `5a8ca45` (rama `feat/phase-1-mvp`)
- **Trello:** https://trello.com/c/Vfq9bsed (F1-28) — movida a **Completadas**
- **Qué cambió:** el socio abre la WAFM, ve el horario de la semana con el cupo de cada clase,
  reserva y cancela. El botón responde **al instante** y se revierte con el mensaje del error si la
  API dice que no. Antes de confirmar ve la política de cancelación, y antes de cancelar sabe si
  recupera el crédito. La clase llena ofrece la lista de espera con su posición.
- **Por qué:** §2.1.5 y §5.1.3. La meta de §2.0 es que más del 80% de las reservas las haga el
  socio y no el staff: es exactamente el ahorro de tiempo que se vende.
- **Impacto:** ninguna colección ni código de error nuevos · el rol `member` gana `venue.read` para
  poder elegir sede · el botón del modal pasó a decir "Confirmar reserva": decía lo mismo que el de
  la fila, y dos botones con el mismo nombre son ambiguos también para un lector de pantalla.
- **Pendiente:** el E2E de reservar y cancelar y la prueba real de modo avión van con F1-31.

## 2026-09-04 — F1-27: el panel del super admin y el buscador de soporte

- **Módulo:** `susc` · `observability` · `http` · `dfsa`
- **Tipo:** feature
- **Commit/PR:** `5cc155d` (rama `feat/phase-1-mvp`)
- **Trello:** https://trello.com/c/Qbem5GRG (F1-27) — movida a **Completadas**
- **Qué cambió:** el SAU ve los suscriptores con su plan, su estado y su uso contra los límites;
  cambia estados y edita planes; tiene panel de salud con errores por código y jobs fallidos; y
  puede pegar un `requestId` o un código de error y ver qué pasó. Todo `/api/v1/admin` exige ahora
  super admin **y** segundo factor — hasta acá solo pedía sesión.
- **Por qué:** §5.1.1 y §11.3. El producto le dice al usuario "compartí el código con soporte" en
  cada error: sin este panel, del otro lado no había dónde pegarlo.
- **Impacto:** colección `errorEvents` de plataforma, con TTL de 30 días · 5 endpoints nuevos bajo
  `/api/v1/admin` · el handler global de errores escribe el registro sin poder romper la respuesta ·
  ningún código de error nuevo · las tres pantallas del DFSA (suscriptores, salud y buscador).
- **Decisión de privacidad:** el registro guarda el **código** del error, no su contenido. En el
  `meta` puede estar el nombre y el saldo de un socio, y ADR-004 decisión 7 dice que el SAU no ve
  datos de miembros. Hay tests de los dos lados: que el listado no traiga nombres y que el buscador
  no devuelva el mensaje.
- **Pendiente:** la pantalla de planes del DFSA (la API está entera) y la de textos legales. Los
  webhooks pendientes informan cero hasta Fase 2, que es cuando existen.

## 2026-09-04 — F1-26: la landing completa y el formulario de contacto

- **Módulo:** `landing` · `crm` (nuevo) · `schemas`
- **Tipo:** feature
- **Commit/PR:** `e068be8` (rama `feat/phase-1-mvp`)
- **Trello:** https://trello.com/c/vyoqqQsK (F1-26) — movida a **Completadas**
- **Qué cambió:** la landing tiene las nueve secciones de §5.1.4 más la comparativa contra "Excel y
  WhatsApp" y la de seguridad y privacidad. Los precios se **prerenderizan**: están en el HTML que
  lee el buscador, no detrás de un `fetch`. El formulario de contacto valida con el Zod compartido,
  se defiende de bots con un campo trampa en vez de un captcha, y guarda la consulta. Hay página de
  acuerdo de tratamiento de datos y botón de volver arriba que respeta `prefers-reduced-motion`.
- **Por qué:** §5.1.4. La landing es el canal de adquisición: si el precio no está en el HTML, no lo
  ve ni el buscador ni el visitante apurado.
- **Impacto:** colección `contactRequests`, de plataforma (sin `tenantId`) · 1 endpoint público
  nuevo (`POST /api/v1/contact`) con `LP-CRM-422-001` · página `/tratamiento-de-datos` · el catálogo
  de precios de la landing vive en `@laplace/schemas` y un test lo compara contra lo que siembra la
  migración: son dos representaciones en dos lenguajes que no pueden compartir código.
- **Pendiente:** los testimonios reales (la sección está, inventarlos sería publicar reseñas
  falsas), los textos legales vinculantes (necesitan abogado; están la estructura y los hechos), las
  capturas de pantalla reales (hoy son maquetas de CSS que lo dicen) y Lighthouse CI, que va con el
  pipeline de F1-31.

## 2026-09-04 — F1-25: alta self-service, trial de 14 días y planes

- **Módulo:** `susc` (nuevo) · `entitlements` · `notifications` · `events`
- **Tipo:** feature
- **Commit/PR:** `597b5ea` (rama `feat/phase-1-mvp`)
- **Trello:** https://trello.com/c/qhzF6UVa (F1-25) — movida a **Completadas**
- **Qué cambió:** el dueño de un centro se registra desde la landing y en dos pedidos tiene su
  cuenta operativa, con trial de 14 días **sin tarjeta**. A los 14 días, si no eligió plan, la
  cuenta se suspende y **no se borra nada**: sus socios y su agenda siguen ahí. Subir de plan es
  inmediato con prorrateo, bajar es al fin del ciclo y valida antes que lo que ya tiene entre.
  Cambiar el precio de un plan no cambia lo que paga quien ya estaba. El SAU puede entrar a una
  cuenta para dar soporte con motivo obligatorio, y al dueño le llega el aviso.
- **Por qué:** §2.1.3, §2.1.4 y ADR-004. Es el módulo del que depende que el producto cobre.
- **Impacto:** colecciones `subscriptions` y `plans`, **de plataforma** (sin `tenantId`: son datos
  sobre los centros, no de uno) · **migración** (`20260906090000`) con sus únicos y el catálogo de
  planes sembrado · 8 endpoints nuevos, 2 de ellos públicos (`GET /api/v1/plans` y el alta) ·
  3 eventos de dominio nuevos · aviso `organization.impersonated`, crítico y no apagable · 2 jobs
  (`expireTrials`, `applyPendingPlanChanges`) · umbral de cobertura del módulo al 95%.
- **Pendiente:** el cobro recurrente con Mercado Pago, los webhooks, el dunning y los cupones son
  Fase 2. Los precios sembrados son valores iniciales que el SAU cambia desde su panel. La
  autorización de `/api/v1/admin` la cierra F1-27, que trae el rol de SAU.

## 2026-09-04 — F1-24: el home del DFSM es un tablero

- **Módulo:** `metrics` · `members` · `waivers` · `dfsm` · `ui` · `http`
- **Tipo:** feature
- **Commit/PR:** `79b4ef9` (rama `feat/phase-1-mvp`)
- **Trello:** https://trello.com/c/h0C4rOia (F1-24) — movida a **Completadas**
- **Qué cambió:** el DFSM abre en un tablero y no en un menú: las clases de hoy con su ocupación,
  cuánta gente entró, la caja del día y el panel de alertas de §2.1.12 — quién no viene hace dos
  semanas, qué packs vencen esta semana, quién debe, qué clases están flojas y a quién le falta
  firmar. Cada alerta trae los ítems con los que se resuelve, no solo un número. Y hay buscador
  global de socios, con Ctrl+K, por nombre, documento o teléfono.
- **Por qué:** §5.1.2 y §2.1.12. El panel de alertas accionables vale más que cualquier gráfico, y
  el motivo es concreto: un gráfico se mira, una alerta se toca.
- **Impacto:** 2 endpoints nuevos (`GET /api/v1/dashboard`, `GET /api/v1/members/search`) · ninguna
  colección ni código de error nuevos · ninguna migración · el `Input` de `@laplace/ui` acepta
  `ref`, que en React 19 es una prop normal · helper `parseQuery` en `http/validate.ts`.
- **Pendiente:** las acciones rápidas (cobrar, vender pack, agregar miembro) entran con las
  pantallas que las van a contener — Cobranza, Productos y Miembros. Encontrado de paso y **no
  arreglado acá**: las rutas que validan la query con `schema.parse()` devuelven 500 en vez de 422;
  el helper que lo arregla ya existe y falta aplicarlo al resto de los módulos.

## 2026-09-04 — F1-23: MetricsDaily y los KPIs del centro

- **Módulo:** `metrics` (nuevo) · `venues` · `schedule` · `booking` · `members` · `billing`
- **Tipo:** feature
- **Commit/PR:** `8c981df` (rama `feat/phase-1-mvp`)
- **Trello:** https://trello.com/c/HWDINRZV (F1-23) — movida a **Completadas**
- **Qué cambió:** el job `computeMetricsDaily` corre a las 03:00 y deja precalculados, por sede y
  por día, los seis KPIs de Fase 1: socios activos, asistencias, utilización, tasa de no-show,
  ingresos y deuda vencida. El panel del DFSM los lee ya calculados. Un día pasado se puede
  reprocesar a mano cuando aparecen datos tarde.
- **Por qué:** §2.1.12. Calcular KPIs con agregaciones en vivo sobre colecciones que crecen es la
  causa número uno de dashboards lentos, y el dashboard lento es el que nadie abre.
- **Impacto:** colección `metricsDaily` estrena dueño (el único `{ tenantId, venueId, date }` ya
  venía de F0-10, sin migración nueva) · 2 endpoints nuevos bajo `/api/v1/metrics`, los dos con
  permiso `businessMetrics.read` — el staff no ve métricas de negocio (§2.1.12) · job
  `computeMetricsDaily` · cinco puertos de lectura nuevos en Venues, Schedule, Booking, Members y
  Billing, todos de conteo · ningún código de error nuevo.
- **Pendiente:** MRR, churn, ARPM, LTV, retención a 90 días, conversión de waitlist, utilización de
  coach y cohortes son Fase 2: necesitan Suscriptions (F1-25) o series más largas que las que hay.
  El panel visual del DFSM y las alertas accionables son F1-24.

## 2026-09-03 — F1-22: los avisos transaccionales del MVP

- **Módulo:** `notifications` · `booking` · `schedule` · `contracts` · `billing`
- **Tipo:** feature
- **Commit/PR:** `909b156` (rama `feat/phase-1-mvp`)
- **Trello:** https://trello.com/c/4aS5u66G (F1-22) — movida a **Completadas**
- **Qué cambió:** los ocho avisos automáticos de §2.1.14 ya salen solos. Cancelar una reserva,
  entrar desde la lista de espera, que se caiga la clase o cambie el coach, que el pack esté por
  vencer o se venza, que una cuota entre en mora o que se registre un pago: cada uno avisa por la
  campana y por mail. Los recordatorios de clase (24 h y 1 h antes) los manda el job
  `classReminders`, una sola vez por hito aunque el job corra veinte veces.
- **Por qué:** sin estas, el motor de F1-21 no le sirve a nadie. Son las que hacen que el socio no
  tenga que abrir la app para enterarse de lo que le pasa a su plata y a sus clases.
- **Impacto:** ningún código de error ni colección nueva · el evento `session.cancelled` suma
  `releasedMemberIds` (y `releaseSession` de Booking devuelve esa lista en vez de un número):
  cuando Notifications reacciona, las reservas ya se cancelaron y la clase no tiene inscriptos, así
  que a quién avisarle solo lo sabe el que canceló · job `classReminders` nuevo (cada 5 min) ·
  tres puertos de lectura nuevos, en Contracts (`notificationContextOf`) y Billing
  (`chargeContextOf`, `paymentContextOf`), todos devolviendo `null` en vez de tirar.
- **Pendiente:** el aviso de pack por vencer trae el CTA en el texto y no como botón — la pantalla
  de "mis packs" a la que llevaría es F1-29. El de cambio de coach no dice a quién: un directorio
  de staff no existe todavía. Web Push y WhatsApp son Fase 2.

## 2026-09-03 — F1-21: motor de notificaciones in-app y email

- **Módulo:** `notifications` (nuevo) · `members` · `venues` · `auth` · `client` · `wafm`
- **Tipo:** feature
- **Commit/PR:** `7898f61` (rama `feat/phase-1-mvp`)
- **Trello:** https://trello.com/c/2Gs04wwb (F1-21) — movida a **Completadas**
- **Qué cambió:** los avisos del producto ya tienen motor. Un evento de dominio encola el aviso por
  los canales que correspondan (campana y mail), un job los manda con reintentos a los 30 s, 2 min
  y 10 min, y lo que no sale queda en la cola de fallidos con su error, visible para soporte. El
  socio elige qué recibir y por dónde desde la WAFM; el SMU edita las plantillas con variables y
  ve la vista previa antes de que salgan. La primera enganchada es la confirmación de reserva.
- **Por qué:** §2.1.14. "No me llegó el aviso" tiene que ser una pregunta contestable, y un
  proveedor de mail caído no puede hacer fallar una reserva que ya está hecha.
- **Impacto:** colecciones `notificationTemplates` y `notificationPreferences` nuevas; `notifications`
  estrena dueño · **migración** (`20260905090000`) con el único de deduplicación
  `{tenantId, dedupeKey}`, el índice del reclamo `{tenantId, status, nextAttemptAt}` y los únicos
  de plantillas y preferencias · 9 endpoints nuevos bajo `/api/v1/notification*` · recurso
  `notification` en la matriz de permisos (`read`, `manageTemplates`, `viewDeliveryLog`) · job
  `dispatchNotifications` · `LP-NOTF-500-001` y `LP-NOTF-422-002` ya estaban declarados, sin
  códigos nuevos · el `ApiClient` de `@laplace/client` gana `put`, que la API ahora usa.
- **Pendiente:** el motor queda enganchado a un solo evento (`booking.created`). Los otros siete
  avisos transaccionales y el job `classReminders` son F1-22, que ya no toca el motor: solo se
  suscribe. La pantalla de plantillas del DFSM entra en F1-24 — la API está entera. Web Push y
  WhatsApp son Fase 2: el enum de canales crece, el resto del motor no cambia.

## 2026-09-03 — F1-20: módulo Waivers, deslindes y consentimientos

- **Módulo:** `waivers` (nuevo) · `attendance` · `members` · `wafm`
- **Tipo:** feature
- **Commit/PR:** `2cdd481` (rama `feat/phase-1-mvp`)
- **Trello:** https://trello.com/c/QXxTpx5h (F1-20) — movida a **Completadas**
- **Qué cambió:** el centro publica deslindes, consentimientos y demás documentos legales,
  versionados; el socio los ve y los firma desde la WAFM, con hash del texto, IP, user agent y
  fecha guardados. Si el Venue lo exige (`enforceWaivers`, apagado por default), el check-in queda
  bloqueado mientras falte algo obligatorio — y al menor de edad, el consentimiento del tutor
  siempre le aplica. Hay un panel de cumplimiento por documento, exportable a CSV.
- **Por qué:** es riesgo legal, no una funcionalidad opcional (§2.1.20). Un centro tiene que poder
  probar exactamente qué firmó cada socio, no solo que "aceptó algo".
- **Impacto:** colecciones `legalDocuments` y `consents` (ya declaradas desde Fase 0, sin dueño
  hasta ahora) · **migración** (`20260904090000`) que corrige el único de `consents` heredado de la
  migración base — estaba copiado del de `RmRecord` (`userId` primero, sin `unique`), pero un
  consentimiento es del centro y no del socio: `tenantId` va primero (ADR-000 regla 4) · cuatro
  rutas nuevas · `Venue.bookingPolicy` suma `enforceWaivers` · dos permisos nuevos
  (`waiver.accept` para el socio, ya declarado `waiver.publish`/`read` para el staff) ·
  `@laplace/client` suma `sanitizeHtml` (DOMPurify) · la WAFM suma la pantalla "Tus documentos" y
  un aviso en el home.
- **Pendiente:** nada declarado. Es la última deuda que quedaba abierta desde F1-18/F1-19
  (`WaiverGate`), y con esta tarea queda saldada.

### El índice heredado de la migración base estaba mal para `consents`

`{ userId, tenantId, documentId }`, copiado del índice de `RmRecord` — que sí arranca por
`userId` porque un RM es del atleta, no del centro (ADR-000 regla 7, el único caso con nombre en
la spec). Un consentimiento **no es portable entre centros**: aceptar el deslinde de Box Toro no
dice nada del de otro gimnasio. Le corresponde el orden normal de todo índice compuesto —
`tenantId` primero— y de paso se le agregó `unique`, que es lo que hace que aceptar el mismo
documento dos veces (doble click) no duplique el registro.

### `enforceWaivers` es la parte de "configurable por Venue" que el criterio no explicitaba

Vive en `bookingPolicy`, al lado de `allowDebt`: el mismo patrón de barrera que Attendance
consulta antes de dejar entrar a alguien. Default apagado — prenderlo de una habría bloqueado a
cualquier centro que todavía no publicó sus documentos ni migró a que sus socios tengan cuenta en
la WAFM, incluidos los tests de F1-18/F1-19 que ya estaban en verde.

### El HTML del documento no se muestra tal cual

Lo escribe el staff del centro, no Laplace, y una cuenta de staff comprometida no tiene que poder
convertirse en un XSS almacenado contra cada socio que abre la app. `sanitizeHtml` (DOMPurify,
nuevo en `@laplace/client`) sanea el contenido antes de renderizarlo en la WAFM, con un allowlist
de las etiquetas de un documento de texto — nada de `<script>`, `<iframe>` ni manejadores `on*`.
El CSV del panel de cumplimiento tiene su propio escape, contra la inyección de fórmulas de
Excel/Sheets.

---

## 2026-09-03 — F1-19: QR con token rotativo y walk-in

- **Módulo:** `attendance` · `booking` · `wafm` · `dfsm`
- **Tipo:** feature
- **Commit/PR:** `9ab0a20` (rama `feat/phase-1-mvp`)
- **Trello:** F1-19 — movida a **Completadas**
- **Qué cambió:** el socio tiene "Mi QR" a un toque desde el home de la WAFM: un código que se
  renueva solo cada 30 segundos y se muestra en la tablet de la puerta para entrar. La tablet no
  lee cámara — es un lector de hardware que "escribe" el código, como en cualquier kiosko de
  retail — y si se queda sin red, encola el escaneo local y lo sincroniza solo al volver la
  conexión. El mostrador puede registrar a alguien que llegó sin reserva (walk-in): ahí, y solo
  ahí, el crédito se descuenta en el check-in y no al reservar.
- **Por qué:** es el camino de entrada que usa la mayoría de los socios en el día a día (§2.1.18),
  y el WiFi de un gimnasio es el peor lugar del mundo para depender de la conexión.
- **Impacto:** colección `checkInTokens` nueva, con **migración** (`20260903120000`) que le pone
  TTL — el documento se borra solo cuando vence — y único por `{tenantId, tokenHash}` para que el
  canje sea de un solo uso incluso con dos escaneos simultáneos (sin filtro parcial: a diferencia
  de `bookings` o `payments`, acá `tokenHash` está en todas las filas, nunca falta) · tres rutas
  (`POST /check-in-tokens`, `POST /check-in-tokens/redeem`, `POST /sessions/:id/walk-in`) ·
  `createOfflineQueue` nuevo en `@laplace/client`, reusable por cualquier pantalla que no pueda
  perder lo que el usuario ya hizo · la WAFM estrena router y su primera pantalla real · el DFSM
  suma la pantalla de kiosko, fuera del chrome del coach.
- **Pendiente:** el waiver se sigue pidiendo por el puerto `WaiverGate`, que hasta F1-20 contesta
  que está todo firmado.

### El QR guarda el hash, nunca el código

El documento de `checkInTokens` vive 30 segundos y se emite uno cada vez que alguien abre su QR,
pero una colección con los códigos en claro sería una colección de llaves de la puerta — y el TTL
de Mongo corre cada 60 segundos, así que un documento puede sobrevivir hasta un minuto a su propio
vencimiento. Lo que valida el canje no es que el documento siga existiendo: es que
`assertTokenUsable` compare el vencimiento guardado contra el reloj. El índice es higiene de la
colección, no la regla de negocio.

### La cola offline encola antes de intentar mandar

Si encolara solo después de que la primera mandada fallara, un corte de batería o de red justo en
el medio del primer intento perdería el escaneo sin dejar rastro. Encolando primero, lo peor que
puede pasar es un reintento — y como la clave de idempotencia se fija al encolar y no al mandar,
el reintento es el mismo pedido, no uno nuevo. Vive en `@laplace/client` y no en el kiosko porque
cualquier pantalla de Laplace que no pueda darse el lujo de perder lo que el usuario ya hizo la
puede reusar.

### Verificado en un navegador, no solo en jsdom

Las dos pantallas nuevas se probaron contra servers de desarrollo reales (se agregó
`.claude/launch.json`): el QR de la WAFM pasa de cargando a un estado de error legible cuando no
hay backend, y el kiosko del DFSM encola de verdad en `localStorage` y muestra "1 escaneo esperando
para sincronizar" cuando se le corta la red. De paso apareció un bug preexistente, ajeno a esta
tarea — la utilidad `hidden` de Tailwind no genera CSS en este build, así que el toggle de nav
mobile/desktop de `MobileShell` no esconde nada — quedó anotado como tarea aparte, no se tocó acá.

---

## 2026-09-03 — F1-18: check-in manual y lista de clase del coach

- **Módulo:** `attendance` (nuevo) · `dfsm`
- **Tipo:** feature
- **Commit/PR:** `46b3937` (rama `feat/phase-1-mvp`)
- **Trello:** https://trello.com/c/d7wJ0zxW (F1-18) — movida a **Completadas**
- **Qué cambió:** el coach abre la lista de su clase en el teléfono y ve inscriptos, presentes,
  lista de espera y las alertas de cada uno. Marca a uno de un toque o a todos de una, con la
  ventana de check-in y las validaciones del centro respetadas.
- **Por qué:** es la pantalla que se usa de pie, con una mano, en el piso del box (§5.1.2). Si no
  funciona perfecto en un teléfono, no se usa — y sin asistencia no hay métricas.
- **Impacto:** módulo `attendance` nuevo · tres rutas (`GET /sessions/:id/roster`,
  `POST /bookings/:id/check-in`, `POST /sessions/:id/check-in-all`) · `Booking` suma `checkedInAt`,
  `checkInMethod` y `checkedInBy` · código nuevo `LP-ATTD-409-006` · el DFSM estrena router y su
  primera pantalla real · sin migración.
- **Pendiente:** el QR con token rotativo y el walk-in son F1-19. El waiver se pide por un puerto
  que hasta F1-20 contesta que está firmado.

### Attendance no guarda nada

La asistencia es un estado de la reserva. Una colección propia serían dos verdades sobre si alguien
entró, y la que se desincronice va a ser la que mire el coach. El módulo aporta la decisión —quién
puede entrar, cuándo y con qué alertas— y la vista; el documento lo sigue escribiendo Booking, que
es su dueño.

### "Todos presentes" no se cae por uno

Los que no pasan una validación vuelven en `skipped` con su código. Cortar la operación entera
porque uno de los catorce debe plata sería cambiar ocho segundos de trabajo por una discusión en el
piso del box.

## 2026-09-03 — F1-17: no-show y penalización configurable

- **Módulo:** `booking`
- **Tipo:** feature
- **Commit/PR:** `5e217a7` (rama `feat/phase-1-mvp`)
- **Trello:** https://trello.com/c/viAET6ZL (F1-17) — movida a **Completadas**
- **Qué cambió:** el job de cada hora marca ausente a quien reservó y no hizo check-in, sin
  devolverle el crédito, y aplica la penalización del centro: superado el umbral de faltas, el
  socio queda sin reservar por el tiempo configurado y se le dice hasta cuándo.
- **Por qué:** quien reserva y no va le sacó el lugar a otro. Es la práctica estándar del sector
  (§2.1.5.d), y sin ella la lista de espera pierde sentido.
- **Impacto:** `Member` suma `noShowCount` y `bookingBlockedUntil`, y los dos salen en la respuesta
  del socio · `bookingPolicy` suma `noShowWindowDays` · job `markNoShows` cada hora · dos eventos
  nuevos (`booking.no_show`, `booking.blocked_by_no_shows`) · sin migración.
- **Pendiente:** el check-in que evita la falta es F1-18 y F1-19. Hasta entonces, toda reserva de
  una clase que pasó termina en `no_show`, que es lo correcto mientras no exista la asistencia.

### El umbral no se cuenta con un contador

`Member.noShowCount` existe y se mantiene, pero la decisión de bloquear se toma contando las
reservas que quedaron en `no_show` dentro de la ventana móvil. Un contador hay que resetearlo, y el
reseteo que no corre convierte una falta de hace ocho meses en un bloqueo de hoy. La ventana es
configurable porque tres ausencias en tres años no son las tres ausencias de un mes.

## 2026-09-02 — F1-16: lista de espera con promoción automática

- **Módulo:** `booking`
- **Tipo:** feature
- **Commit/PR:** `8c3a162` (rama `feat/phase-1-mvp`)
- **Trello:** https://trello.com/c/bQrvQ9gC (F1-16) — movida a **Completadas**
- **Qué cambió:** la fila es FIFO de verdad y se mueve sola. Cuando alguien cancela, el primero de
  la lista recibe el lugar guardado y quince minutos para confirmar; si no contesta, el job de cada
  minuto se lo pasa al siguiente. Congelar el contrato o dar de baja al socio lo saca de todas las
  listas, y la fila tiene tope.
- **Por qué:** §2.1.5.b pide que la promoción sea automática, sin que el staff intervenga. Una
  lista de espera que hay que atender a mano es una lista que nadie atiende.
- **Impacto:** `Booking` suma `holdExpiresAt`, `promotedAt` y `confirmedAt` · ruta nueva
  `POST /api/v1/bookings/:id/confirm` · job `expireWaitlistHolds` cada minuto · evento nuevo
  `booking.waitlist_hold_expired` · sin migración.
- **Pendiente:** la notificación al promovido es F1-22, que escucha `booking.waitlist_promoted`.
  La tasa de conversión de la fila la calcula F1-23 con `promotedAt` y `confirmedAt`.

### Por qué el lugar se toma al promover y no al confirmar

Si el lugar quedara libre durante los quince minutos de la ventana, cualquiera que abriera la app
se lo llevaría, y el aviso que el primero de la fila acaba de recibir sería mentira. Se toma con el
mismo `findOneAndUpdate` atómico de la reserva, así que dos cancelaciones simultáneas promueven a
dos personas distintas — hay un test que lo verifica.

### Con esto, el corazón del producto está entero

Alta de centro → sala → producto → socio → contrato → clase → reserva → cupo lleno → fila →
promoción → confirmación → cancelación con su crédito. Es el corte de revisión que marcaba el plan
al terminar F1-16.

## 2026-09-02 — F1-15: ventanas de tiempo y devolución de crédito

- **Módulo:** `booking`
- **Tipo:** feature
- **Commit/PR:** `4e1515d` (rama `feat/phase-1-mvp`)
- **Trello:** https://trello.com/c/LnUNw1UM (F1-15) — movida a **Completadas**
- **Qué cambió:** las cinco ventanas de §2.1.5.c se respetan de verdad — abrir, cerrar, cancelar,
  promover y hacer check-in —, cada categoría puede tener las suyas, y el socio ve el texto de la
  política **antes** de confirmar. Cancelar fuera de plazo ahora avisa qué se pierde y recién
  cancela si el socio lo confirma.
- **Por qué:** es donde se define si el producto se siente justo o arbitrario. La regla de que el
  late cancel no devuelve el crédito ya existía; lo que faltaba era que se supiera antes.
- **Impacto:** `bookingPolicy` suma `lateCancelPolicy` y `categoryPolicies` · ruta nueva
  `GET /api/v1/booking-policies/:sessionId` · el cuerpo de la cancelación acepta
  `acceptsLateCancel` · sin migración: las sedes viejas toman los defaults.
- **Pendiente:** la promoción automática de la lista de espera (F1-16) y el job de no-show (F1-17)
  son los que van a consumir `waitlistPromotionCutoffMinutes` y la fila `no_show` de la matriz.

### La matriz de §2.1.9 ahora tiene un solo lugar

`domain/credit-matrix.ts` responde qué pasa con el crédito en cada uno de los ocho eventos de la
tabla, y §Testing.5 la recorre fila por fila. La consultan Booking al cancelar, Schedule al cancelar
una clase y Contracts al congelar; Attendance y el job de no-shows la van a consultar igual. La
alternativa —la regla escrita en cada servicio— es la que termina cobrándole de más a alguien
cuando una copia se desactualiza.

### Dos cosas que aparecieron mirando la cobertura

La caja diaria leía "hoy" con `Temporal.Now` en la ruta en vez del reloj inyectado del servicio: era
lo único del módulo de plata que no se podía testear con un reloj fijo. Y el estado en el que queda
un cargo después de un reembolso tenía una rama inalcanzable, porque la imputación nunca sobrepaga
un cargo — lo que sobra queda como saldo a favor.

## 2026-09-02 — F1-14: reserva atómica con descuento de crédito

- **Módulo:** `booking`
- **Tipo:** feature
- **Commit/PR:** `e11b4f1` (rama `feat/phase-1-mvp`)
- **Trello:** https://trello.com/c/wzD96bLn (F1-14) — movida a **Completadas**
- **Qué cambió:** el corazón del producto. Un socio reserva y el crédito se descuenta en la misma
  operación; si la clase está llena entra a la lista de espera sin gastar crédito; si debe plata y
  el centro no permite deuda, no reserva. Cancelar devuelve el lugar y el crédito. Y las tres
  deudas que arrastraban F1-09, F1-11 y F1-13 quedaron saldadas.
- **Por qué:** sin reserva no hay producto, y una reserva que puede vender el mismo lugar dos veces
  deja a alguien parado en la puerta de una clase llena.
- **Impacto:** colección `bookings` · **migración nueva** (`20260902170000`) que reemplaza el único
  `{ tenantId, sessionId, memberId }` de F0-10 por uno **parcial** sobre los estados vivos, y agrega
  el único parcial de `idempotencyKey` · cuatro rutas nuevas · evento `booking.created` ·
  `src/persistence/transaction.ts`, la plomería de transacciones que faltaba (§5.2.4).
- **Pendiente:** la promoción automática de la lista de espera es F1-16, y las ventanas de tiempo y
  el late cancel con su matriz de 8 casos son F1-15. `cancel` hoy siempre devuelve el crédito.

### El índice de F0-10 estaba mal y esto lo destapó

El único `{ tenantId, sessionId, memberId }` de la migración de F0-10 no tenía filtro parcial: quien
cancelaba una clase quedaba **bloqueado para siempre** para volver a anotarse en esa misma clase,
porque la fila cancelada seguía ocupando la clave. La migración de esta tarea lo baja y lo recrea
filtrado por `status ∈ {booked, waitlisted, checked_in}`. Hay un test que lo cubre.

### Lo que verifica el test que no se negocia

50 reservas paralelas sobre una clase de 1 cupo: entra **una**, las otras 49 quedan en la fila y
`bookedCount` termina en 1 (§Testing.2). El lugar se toma con un `findOneAndUpdate` que exige
`bookedCount < capacity` dentro de la misma operación; con un `read` y después un `write`, las 50
leerían el mismo contador y entrarían las 50.

## 2026-09-02 — F1-13: edición, feriados y cancelación de clase

- **Módulo:** `schedule`
- **Tipo:** feature
- **Commit/PR:** `9a312dc` (rama `feat/phase-1-mvp`)
- **Trello:** https://trello.com/c/kpxJMwoQ (F1-13) — movida a **Completadas**
- **Qué cambió:** el comportamiento tipo Google Calendar de §2.1.5.a — editar solo una clase o "esta
  y futuras" —, los feriados y cierres que cancelan en bloque, la cancelación con devolución de
  créditos, el aviso de cambio de coach y la duplicación de una semana respetando feriados.
- **Por qué:** una grilla que no se puede corregir sin romper el histórico no sirve; y una
  cancelación que no devuelve el crédito es plata del socio retenida.
- **Impacto:** colección `venueClosures` con su **migración nueva** (`20260902160000`) · cinco rutas
  nuevas · dos eventos (`session.cancelled`, `session.coach_changed`).
- **Pendiente:** ver la deuda declarada abajo.

**Decisiones:**

- **Primero se liberan las reservas, después se cancela la clase.** Si la devolución falla, la clase
  queda en pie y el centro puede reintentar. Al revés quedaría una clase cancelada con los créditos
  retenidos, que es plata del socio y nadie se enteraría hasta que reclame. Hay un test que hace
  fallar la devolución a propósito y verifica que la clase siga `scheduled`.
- **Sin `scope`, editar la plantilla no propaga nada.** Reescribir clases ya publicadas sin que
  nadie lo pida es peor que obligar a un click de más.
- **Las clases pasadas nunca se tocan.** Son el histórico de lo que de verdad ocurrió; reescribirlas
  haría que la lista de asistencia de la semana pasada dejara de coincidir con lo que la gente hizo.
  El test mueve el reloj un mes y verifica que la mitad vieja de la grilla quedó intacta.
- **Una clase que ya terminó no se edita ni se cancela, aunque su estado siga siendo `scheduled`.**
  Nadie transiciona la grilla vieja, así que el corte tiene que ser por reloj, no por estado. Lo
  encontró el test: la primera versión solo miraba el estado y dejaba editar una clase de marzo en
  mayo.
- **Los cierres guardan las fechas como `YYYY-MM-DD`.** Un feriado es un día del calendario del
  centro, no una ventana de 24 horas; guardarlo como instante obligaría a elegir una hora arbitraria
  y a recalcularla en cada zona.
- **Un cierre declarado tarde no cancela lo que ya se dio.** La clase ocurrió: borrarla del registro
  sería mentir sobre lo que pasó.
- **Duplicar una semana dice qué no copió y por qué.** Feriado o sala ocupada: sin el motivo, el SMU
  ve un hueco en la grilla y no sabe si es un bug.
- **Cancelar dos veces no libera dos veces.** Liberar de nuevo devolvería el crédito otra vez, que
  es regalar clases.

**Deuda declarada:** el criterio pide que la cancelación y la devolución ocurran **en la misma
transacción**. Hoy son dos operaciones ordenadas para que un fallo no deje créditos retenidos, con
la devolución detrás del puerto `SessionBookingReleaser`. F1-14 las mete en una transacción de Mongo,
que es donde puede hacerlo: ahí las reservas y el contador de la sesión viven en el mismo módulo.
Anotado en esa tarea, que ya hereda tres deudas.

**Verificación:** 1501 tests verdes (1111 en la API), `lint`, `typecheck`, `build` y `format:check`
en verde, gate de cobertura por criticidad cumplido.

---

## 2026-09-02 — F1-12: la agenda y la materialización de clases

- **Módulo:** `schedule`
- **Tipo:** feature
- **Commit/PR:** `f648109` (rama `feat/phase-1-mvp`)
- **Trello:** https://trello.com/c/wHIRoAUH (F1-12) — movida a **Completadas**
- **Qué cambió:** el centro define plantillas recurrentes y un job diario materializa las clases de
  los próximos 60 días. También se pueden cargar clases sueltas, y dos clases no pueden ocupar la
  misma sala a la misma hora.
- **Por qué:** es el módulo del que cuelga el corazón del producto. Sin grilla no hay reserva
  (F1-14), ni lista de clase (F1-18), ni check-in (F1-19).
- **Impacto:** colecciones `classTemplates` y `classSessions` · ocho rutas nuevas · un job nuevo ·
  **migración nueva** (`20260902150000-session-materialization-unique.cjs`) · dos eventos.
- **Pendiente:** la edición "solo esta / esta y futuras" y la cancelación de clase son F1-13.

**Decisiones:**

- **La recurrencia se modela nativa, no como un string RRULE.** Es el subconjunto
  `FREQ=WEEKLY;BYDAY;BYHOUR` de RFC 5545, que es la forma que de verdad tiene una grilla de clases:
  "lunes a viernes a las 7:00". El expansor no tiene que parsear nada y el formulario del SMU son
  seis campos en vez de una gramática. Ensancharla más adelante —mensual, por día del mes— es
  aditivo: se suma un `freq` y el expansor crece con un caso.
- **La clase de las 7:00 es a las 7:00 todo el año.** El expansor recorre día por día en el
  calendario del centro y arma cada fecha con su hora local. Hay cuatro tests contra Santiago de
  Chile, que sí cambia de hora: expandiendo con sumas de 24 h, la clase del lunes siguiente al
  cambio caería a las 8:00 y el socio se encontraría el gimnasio cerrado. Y uno que verifica que la
  hora que **no existe** el día del salto se corre hacia adelante en vez de perderse.
- **El job es idempotente por doble vía.** Consulta los inicios ya materializados antes de escribir,
  y un índice único `{ tenantId, templateId, startAt }` cierra la ventana entre esa consulta y el
  `insert`. Sin el índice, dos instancias del runner arrancando a la vez duplicarían la grilla y el
  socio la vería dos veces. El índice es **parcial** sobre `templateId`, porque una clase suelta no
  tiene plantilla y con un `sparse` compuesto todas colisionarían en `null` — la misma trampa que
  ya documentaba F0-10.
- **El intervalo se cuenta desde la vigencia, no desde hoy.** Con "una semana sí y una no", correr
  el job un mes después no puede correr la grilla media semana.
- **El job no materializa hacia atrás.** Una clase cuya hora ya pasó hoy no se crea: nadie podría
  reservarla, y aparecería en la grilla como un hueco raro.
- **Archivar una plantilla no borra las clases ya materializadas.** La del jueves ya está publicada
  y puede tener gente anotada; bajarla es cancelarla, que avisa y devuelve créditos (F1-13).
- **Los bordes que se tocan no chocan.** La clase de 10 a 11 y la de 11 a 12 conviven en la misma
  sala: es la grilla normal de un box, y tratarlas como colisión haría el producto inusable.
- **El error de colisión dice cuál choca y a qué hora.** Sin eso, el SMU tiene que salir a buscarla
  en la grilla.
- **La agenda es un solo endpoint por rango.** Día, semana y mes son la misma consulta con otras
  fechas; cómo se dibuja es del front.

**Deuda de F1-02, saldada:** el puerto `FutureSessionCounter` de Rooms ahora lo contesta Schedule.
Una sala con clases programadas ya no se puede borrar, una sin ellas sí, y las clases que ya pasaron
no bloquean — los tres casos tienen test. La herencia de capacidad de §2.1.5.b también quedó.

**Verificación:** 1482 tests verdes (1092 en la API), `lint`, `typecheck`, `build` y `format:check`
en verde, gate de cobertura por criticidad cumplido.

---

## 2026-09-02 — F1-11: mora automática y caja diaria

- **Módulo:** `billing`
- **Tipo:** feature
- **Commit/PR:** `ee576e7` (rama `feat/phase-1-mvp`)
- **Trello:** https://trello.com/c/cxZpencT (F1-11) — movida a **Completadas**
- **Qué cambió:** un job diario pasa a mora los cargos vencidos, marca al socio como deudor y avisa.
  El estado de cobranza se ve en tiempo real, y cada sede tiene su arqueo de caja del día por método
  de pago, exportable a CSV.
- **Por qué:** §2.1.12 marca la morosidad como el KPI número 1 del mercado argentino. El pasaje a
  mora tiene que ser automático: si hay que calcularlo a mano, no se calcula.
- **Impacto:** un job nuevo (`dunning`) · una ruta nueva (`/venues/:venueId/till`) · evento
  `charge.overdue` · sin cambios en el modelo.
- **Pendiente:** el corte sobre la reserva está implementado y testeado, pero quien lo llama es
  Booking (F1-14). Ver la deuda declarada abajo.

**Decisiones:**

- **El estado de cobranza es derivado, no un campo.** `clear`, `pending`, `overdue` o `credit` se
  calculan sobre cargos y pagos. Guardarlo obligaría a un job que lo mantenga al día y a que ese job
  no se atrase nunca; y un estado de cobranza atrasado es peor que no tenerlo.
- **El corte de la mora vive en Billing, no en Booking.** `assertCanTransact(memberId, allowDebt)`:
  el módulo que sabe cuánto se debe es el que decide, y el que reserva solo pregunta. `allowDebt`
  sale de la política del Venue y su default es `false` (ADR-004, decisión 2).
- **El mensaje del corte dice cuánto debe.** "Regularizá" sin número manda al socio al mostrador a
  preguntar cuánto, que es exactamente la fricción que la mora automática viene a sacar.
- **El día de la caja es el del centro.** Calculado en UTC, la caja de un centro argentino cerraría
  a las 21:00 y los pagos de la última hora caerían en el día siguiente, con el arqueo sin cerrar.
- **El efectivo va aparte del resto.** Es lo único que hay que contar a mano al cerrar el turno, y
  es donde aparecen las diferencias. El CSV sale con el mismo corte para pegarlo en la planilla.
- **El job corre a las 06:00.** El socio que llega a entrenar y está en mora tiene que verlo en la
  puerta, no a media mañana.
- **El job es idempotente por su filtro:** solo trae los que siguen `pending` y de verdad deben
  algo, así que la segunda corrida del día no encuentra nada. Un cargo parcialmente pagado sí entra,
  por lo que falta.

**Sobre el código de error:** la tarjeta pedía `LP-BILL-402-006`, pero el corte que describe es
sobre **reservar**, y §11.2 ya tiene ese caso en el módulo BOOK: `LP-BOOK-403-005`, con la nota de
que solo se emite cuando `allowDebt` es `false`. Se usó ese. El `LP-BILL-402-006` queda libre para
cuando la mora bloquee una acción de facturación.

**Deuda declarada:** `assertCanTransact` está implementado y tiene cinco tests, pero hasta F1-14
nadie lo llama desde el flujo de reserva. Anotado en esa tarea.

**Verificación:** 1439 tests verdes (1049 en la API), `lint`, `typecheck`, `build` y `format:check`
en verde, gate de cobertura por criticidad cumplido.

---

## 2026-09-02 — F1-10: Billing, cargos y pagos manuales

- **Módulo:** `billing`
- **Tipo:** feature
- **Commit/PR:** `6ff533f` (rama `feat/phase-1-mvp`)
- **Trello:** https://trello.com/c/dyKwcshG (F1-10) — movida a **Completadas**
- **Qué cambió:** el centro genera cargos, registra pagos en efectivo, transferencia o POS, y abre
  el estado de cuenta de cualquier socio con su saldo y su deuda vencida. Los pagos se anulan con un
  reembolso, nunca borrándolos.
- **Por qué:** §2.1.16 lo marca como el gap más grave de la v1. El registro manual es como cobra hoy
  la mayoría de los centros.
- **Impacto:** colecciones `charges`, `payments` y `refunds` · cinco rutas nuevas ·
  `src/http/idempotency.ts` como infraestructura compartida · `Charge.paidCents` sumado al modelo ·
  umbral de cobertura propio para `src/modules/billing/**`.
- **Pendiente:** la mora automática y la caja diaria son F1-11.

**Decisiones:**

- **La idempotencia la garantiza el índice, no el middleware.** `requireIdempotencyKey` exige y
  valida la clave; la deduplicación real es el único `{ tenantId, idempotencyKey }`. Una caché de
  respuestas en memoria se pierde justo cuando el proceso se reinicia, que es exactamente cuando el
  cliente reintenta. Hay un test que lanza tres pagos simultáneos con la misma clave y verifica que
  gane uno solo, y otro que manda el mismo pago tres veces en serie: un registro, dos 409.
- **El 409 del duplicado lleva el pago original.** Sin él, el mostrador no puede confirmar que el
  cobro entró y termina cobrándolo de nuevo a mano, que es justo lo que la idempotencia evita.
- **La clave es por tenant.** El índice es `{ tenantId, idempotencyKey }`: si fuera solo la clave,
  el primer centro que use "abc" se la bloquearía a todos los demás. Tiene su test.
- **Un pago se imputa del cargo más viejo al más nuevo.** Es lo que espera el mostrador cuando
  alguien paga "lo que debe". Al revés, la deuda vieja queda abierta mientras se saldan las nuevas.
  Lo que sobra queda como saldo a favor, no se pierde.
- **Un pago nunca se borra (§5.2.4).** Se anula con un reembolso, con motivo obligatorio y registro
  en `AuditLog`. Si el pago desapareciera, el arqueo del día anterior dejaría de coincidir y nadie
  sabría por qué. Hay un test que verifica que el documento sigue existiendo después del reembolso.
- **Un reembolso parcial revierte el último cargo saldado, no el primero.** La deuda que reaparece
  es la que se acababa de cobrar; la vieja ya estaba cobrada y no tiene por qué volver a abrirse.
- **El estado de cuenta es la fuente de verdad del saldo.** `Member.balanceCents` es una copia que
  Billing refresca en cada movimiento, para que el listado de socios no recalcule por fila. El flag
  `debtor` sale del mismo número, así que no puede desincronizarse de él.
- **`Charge.paidCents` se sumó al modelo de §5.2.2.** Sin él no se puede representar un pago
  parcial, que es un criterio explícito de la tarea.

**Verificación:** 1421 tests verdes (1031 en la API), `lint`, `typecheck`, `build` y `format:check`
en verde. Cobertura de `src/modules/billing/**`: **100% de líneas**.

---

## 2026-09-02 — F1-09: congelamiento y vencimiento de contratos

- **Módulo:** `contracts`
- **Tipo:** feature
- **Commit/PR:** `5f23cda` (rama `feat/phase-1-mvp`)
- **Trello:** https://trello.com/c/SeFAtiva (F1-09) — movida a **Completadas**
- **Qué cambió:** el staff congela un contrato por vacaciones o lesión y el vencimiento se corre por
  los días declarados, respetando el tope anual del centro. Dos jobs diarios expiran los vencidos y
  avisan 7, 3 y 1 día antes.
- **Por qué:** el freeze es la feature más pedida que la v1 no tenía (§2.1.9), y los avisos de
  vencimiento son ingreso directo: es el momento en que el socio renueva.
- **Impacto:** `Contract.freeze`, `freezeDaysUsedThisYear`, `freezeYear` y `lastExpiryNoticeDays` ·
  `Venue.bookingPolicy.maxFreezeDaysPerYear` (default 30) · dos rutas nuevas · dos jobs registrados
  en el runner de F0-08.
- **Pendiente:** ver la deuda declarada abajo.

**Decisiones:**

- **El vencimiento se corre al congelar, no al descongelar.** Los días se declaran por adelantado.
  Si se corriera al final, el socio que se olvida de avisar que volvió tendría el pack parado para
  siempre, y el centro no podría planificar nada.
- **30 días son 30 días, no 30×24 horas.** Es el test que §Testing.6 marca como obligatorio y está
  escrito contra Santiago de Chile, que sí cambia de hora: un pack vendido venciendo a las 19:00
  pasaría a vencer a las 20:00 con la cuenta ingenua. Argentina no cambia de hora desde 2009, así
  que con una sola zona de prueba el bug sería invisible para siempre.
- **El tope de días es del centro, no del producto.** Vive en `bookingPolicy`, que es donde ya
  estaban las demás ventanas configurables. Con el tope en `0`, el centro simplemente no habilita
  la función.
- **El contador de días se reinicia con el año calendario.** El tope es "por año", así que el
  contrato guarda también de qué año es el número.
- **`lastExpiryNoticeDays` hace idempotente al aviso.** Sin él, correr el job dos veces el mismo día
  manda el mismo mail dos veces — que es exactamente la clase de error que hace que el centro apague
  las notificaciones y pierda el canal de renovación.
- **El job de expiración es idempotente por su filtro:** solo trae los que siguen `active` o
  `frozen`, así que la segunda corrida del día no encuentra nada.
- **Los jobs son el segundo uso legítimo de `skipTenantScope`.** No corren dentro del pedido de
  nadie: recorren todos los centros y abren el contexto de cada uno antes de tocar sus datos. Quedó
  documentado en el plugin de tenancy, al lado del primero.
- **Los avisos salen a las 10:00 y la expiración a las 03:00.** Un mail que llega de madrugada se
  lee entre otros veinte; el proceso pesado va cuando no hay nadie entrenando.

**Deuda declarada:** §2.1.9 pide que congelar cancele las reservas futuras y **devuelva esos
créditos**. El pedido sale con su motivo a través del puerto `FutureBookingReleaser` y hay un test
que lo verifica, pero hasta F1-14 nadie lo contesta. Anotado en esa tarea.

**Verificación:** 1357 tests verdes (967 en la API), `lint`, `typecheck`, `build` y `format:check`
en verde, gate de cobertura por criticidad cumplido.

---

## 2026-09-02 — F1-08: módulo Contracts y el orden de consumo

- **Módulo:** `contracts`
- **Tipo:** feature
- **Commit/PR:** `de10fbc` (rama `feat/phase-1-mvp`)
- **Trello:** https://trello.com/c/kfiwjNq6 (F1-08) — movida a **Completadas**
- **Qué cambió:** el staff vende un producto a un socio y queda un contrato con su precio y sus
  condiciones congeladas, su máquina de estados y sus créditos. El consumo elige el contrato según
  §2.1.9 y lo descuenta en una sola operación atómica.
- **Por qué:** es donde vive la regla más delicada del producto. Un consumo mal resuelto le cobra de
  más al socio o le regala clases al centro, y en los dos casos se descubre tarde.
- **Impacto:** colección `contracts` · seis rutas nuevas · dos eventos (`contract.sold`,
  `contract.status_changed`) · **infraestructura de `AuditLog`** nueva en `src/audit/` · umbral de
  cobertura propio para `src/modules/contracts/**` (95% de líneas, como auth y entitlements).
- **Pendiente:** el congelamiento y el job de vencimiento son F1-09.

**Decisiones:**

- **El contrato copia las condiciones del producto, no solo el precio.** Tipo, categorías
  habilitadas, franjas horarias y topes se guardan al vender. El centro puede editar el producto
  mañana; lo vendido tiene que seguir valiendo por lo que se vendió. Es `priceSnapshotCents`
  extendido al resto de los términos, y tiene su test: editar el producto después no cambia nada del
  contrato.
- **El vencimiento se calcula en el calendario del centro (§2.1.2).** Un pack de 30 días vendido el
  1 de marzo vence el 31 a la misma hora local, no 720 horas después.
- **El consumo es una sola operación.** `findOneAndUpdate` con `$expr` sobre
  `creditsUsed < creditsTotal`: el filtro y el `$inc` suceden juntos. Hay un test que lanza cinco
  consumos simultáneos sobre un pack de 1 crédito y verifica que gane exactamente uno. Con un read
  y después un write, los cinco leerían `creditsUsed: 0` y el socio terminaría con 5 clases usadas
  de un pack de 1.
- **Si el elegido pierde la carrera, se intenta con el siguiente.** Descartar la reserva porque
  justo se agotó el pack que el sistema eligió, teniendo otro disponible, sería un error nuestro.
  Hay un test con dos packs de 1 crédito y dos consumos simultáneos: ganan los dos.
- **El orden de consumo es explicable.** Vence primero → categoría más específica → más viejo. El
  tercer criterio no aporta al negocio pero hace el orden determinista, que es lo que permite
  decirle al socio de qué pack salió el crédito. La respuesta incluye esa explicación.
- **Gastar primero el más específico es deliberado:** el pack que solo sirve para funcional se
  pierde si no se usa en funcional; el general sirve para cualquier clase.
- **Un producto gratis nace `active`.** Dejar la clase de prueba esperando un pago de $0 sería una
  traba inventada justo en la puerta de entrada del socio.
- **`expired`, `exhausted` y `cancelled` son terminales.** Un contrato agotado no revive: la
  renovación crea uno nuevo, que es lo que mantiene legible el histórico de lo cobrado.
- **El ajuste manual exige motivo y deja registro.** El `AuditLog` guarda antes, después, quién y
  por qué. Seis meses después alguien pregunta por qué su pack tenía 10 clases, y el log de Pino ya
  rotó: esto es un dato, no un log.

**Deudas de F1-07 saldadas:** el trial único por persona ahora se dispara contra el historial real, y
la venta incrementa `soldCount`, así que el cupo `maxSales` aplica. Las dos tienen test de
integración.

**Verificación:** 1328 tests verdes (938 en la API), `lint`, `typecheck`, `build` y `format:check`
en verde, gate de cobertura por criticidad cumplido con el umbral nuevo de Contracts.

---

## 2026-09-02 — F1-07: módulo Products, el catálogo vendible

- **Módulo:** `products`
- **Tipo:** feature
- **Commit/PR:** `004e0f8` (rama `feat/phase-1-mvp`)
- **Trello:** https://trello.com/c/sFx6qTcx (F1-07) — movida a **Completadas**
- **Qué cambió:** el centro publica y administra su catálogo con los siete tipos de §2.1.17: pack de
  clases, membresía ilimitada, membresía con tope, clase suelta, clase de prueba, bono de personal
  training y evento. El socio ve el catálogo público; el staff ve todo.
- **Por qué:** modelar solo packs deja afuera al gimnasio y al estudio de pilates, que trabajan con
  cuota mensual. La spec lo marca como bloqueante comercial.
- **Impacto:** colección `products` · seis rutas nuevas · sin códigos de error nuevos.
- **Pendiente:** ver las dos deudas declaradas abajo.

**Decisiones:**

- **Las reglas por tipo se validan al crear el producto, no en el motor de reservas.** Un
  "ilimitado" con créditos, un pack sin créditos o una clase de prueba paga son contradicciones que
  se pueden rechazar en el formulario. Dejarlas pasar obliga a que el motor de reservas las
  desambigüe, y ahí el que se entera es el socio parado en la puerta.
- **El tipo no se edita.** Cambiarlo cambiaría el significado de los contratos ya vendidos, que
  apuntan al producto para saber cómo se consumen.
- **El PATCH revalida las reglas del tipo con el documento ya mezclado.** El schema del PATCH por sí
  solo no puede verlo, porque no conoce el tipo: sin esto, un PATCH que borra `credits` dejaría el
  pack vendible y sin clases.
- **El catálogo público se fuerza en el servidor.** Quien no tiene permiso para crear productos ve
  solo lo visible y activo. Se decide por el permiso y no por el nombre del rol, así que un rol
  nuevo que pueda publicar hereda la vista completa sin tocar nada.
- **El dinero es entero en centavos en toda la ruta.** Hay un test que verifica el request, lo
  guardado en la base y la respuesta: 60.000,50 pesos son 6000050 centavos, y un float en cualquiera
  de los tres puntos arrastra el error hasta la caja del centro.

**Deudas declaradas, ambas para F1-08:**

1. El **trial único por persona** está implementado y testeado contra el puerto `PurchaseHistory`,
   que hasta que exista Contracts responde `false` para todos. Es el mismo patrón que
   `FutureSessionCounter` en Rooms: la regla vive en su módulo y el dato lo trae quien lo tiene.
2. `soldCount` y `priceSnapshotCents` los escribe Contracts. Acá se declara el cupo (`maxSales`) y
   se verifica que archivar no toque nada vendido.

**Verificación:** 1263 tests verdes (873 en la API), `lint`, `typecheck`, `build` y `format:check`
en verde, gate de cobertura por criticidad cumplido.

---

## 2026-09-02 — F1-05: importación masiva por CSV

- **Módulo:** `members`
- **Tipo:** feature
- **Commit/PR:** `7d93104` (rama `feat/phase-1-mvp`)
- **Trello:** https://trello.com/c/V0UQdGSX (F1-05) — movida a **Completadas**
- **Qué cambió:** el centro sube el padrón exportado de un Excel o de un competidor, lo ve fila por
  fila con su validación, corrige o saltea lo que haga falta, y recién ahí importa. Al terminar
  queda un resumen fila por fila con qué se creó, qué se actualizó y qué se salteó.
- **Por qué:** §2.1.7 lo marca como la fricción número 1 para cambiar de plataforma. Si importar
  duele, el centro no migra y no hay venta.
- **Impacto:** dos rutas nuevas (`/members/import/preview` y `/members/import`) · sin cambios en el
  modelo · permiso propio `athlete.import`, que el `front_desk` **no** tiene.

**Decisiones:**

- **Parser de CSV propio, sin dependencia.** Las reglas que importan son cuatro: comillas, comillas
  escapadas, saltos de línea adentro de comillas y separador. El archivo viene de un usuario, así
  que prefiero poder leer exactamente qué hace con una entrada rara. Acepta `;` porque es lo que
  exporta un Excel en español —la coma es el separador decimal— y saca el BOM que Excel agrega al
  guardar como UTF-8: sin eso, la primera columna se llama `﻿nombre` y no matchea nunca.
- **Las fechas entran como `12/04/1999` y como `1999-04-12`.** Aceptar solo la ISO haría fallar el
  archivo del 90% de los centros por un motivo que no es del centro.
- **Los alias de columna son generosos.** `dni`, `documento`, `nro documento`; `celular`,
  `teléfono`, `tel`. Y las columnas que no se reconocen se **avisan**, no hacen fallar el archivo:
  el export del competidor trae columnas que no usamos, y rechazarlo por eso sería exactamente la
  fricción que esta tarea existe para sacar.
- **Dos pasos: previsualizar y confirmar.** Un import que escribe mientras valida deja el padrón a
  medio migrar y sin forma de saber qué entró. La previsualización no escribe una sola fila.
- **La confirmación es todo o nada.** Documentos repetidos dentro del archivo, documentos que ya
  existen y el cupo del plan se resuelven **antes** de escribir. Hay tres tests que verifican que
  tras un rechazo la colección quedó en cero.
- **El límite del plan no usa `requireWithinLimit`.** Ese guard corta de a uno; acá hay que poder
  decir "tu plan admite 2 socios y ya tenés 0; de los 3 del archivo, 1 no entra". Un "no entrás"
  sin número obliga al centro a borrar filas al azar hasta que entre.
- **Un duplicado que el chequeo previo no ve igual da 409 con su fila.** Un socio borrado
  lógicamente sigue reservando su documento y el índice único no sabe de borrado lógico. Con 143
  filas, "algo falló" no sirve: el error dice cuál.

**Limitación conocida:** la escritura no está en una transacción. Toda la validación ocurre antes,
así que el único escenario de import parcial es una caída de la base a mitad de la escritura; el
error dice cuántas filas alcanzaron a entrar. F1-14 es donde las transacciones se vuelven
obligatorias y donde se va a introducir esa plumbing.

**Verificación:** 1204 tests verdes (836 en la API), `lint`, `typecheck`, `build` y `format:check`
en verde, gate de cobertura por criticidad cumplido.

---

## 2026-09-02 — F1-04: códigos de invitación

- **Módulo:** `members`
- **Tipo:** feature
- **Commit/PR:** `e823cf9` (rama `feat/phase-1-mvp`)
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
- **Commit/PR:** `2f009d3` (entró con el scaffold)
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
- **Commit/PR:** `2f009d3`
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
- **Commit/PR:** `6dc2007`
- **Trello:** —
- **Qué cambió:** la spec pasa a vivir en `docs/spec/LAPLACE-SPEC.md` dentro del repo. Se agregan
  los ADR 000 a 003, el diccionario de errores, esta bitácora, `CLAUDE.md` y el directorio
  `.claude/` con subagentes, comandos y hooks.
- **Por qué:** sin convenciones escritas, cada sesión de IA inventa las suyas — razonables pero
  distintas entre sí — y el tiempo se va en corregir en vez de construir.
- **Impacto:** ninguno sobre el modelo de datos. Es capa de contexto, no de ejecución.
- **Pendiente:** scaffold del monorepo, CI y `.env.example` (Fase 0).

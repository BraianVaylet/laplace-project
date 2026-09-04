# Documento funcional — Laplace

> Qué hace el producto, por rol y por módulo. **Sin implementación**: acá no hay tablas, endpoints
> ni nombres de archivo. Para eso están [TECNICO.md](TECNICO.md) y
> [ARQUITECTURA.md](ARQUITECTURA.md).
>
> La fuente de verdad es `docs/spec/LAPLACE-SPEC.md`. Este documento la resume y la ordena; si
> discrepan, manda la spec.

---

## 1. Qué problema resuelve

Un centro deportivo chico o mediano —un box de CrossFit, un estudio de pilates, un gimnasio
funcional— maneja hoy sus socios en una planilla, sus reservas por WhatsApp y su cobranza de
memoria. Eso funciona hasta los 40 socios y después se rompe: nadie sabe quién debe, quién no
viene hace un mes ni cuántas clases le quedan al que está entrando.

Laplace es el sistema que reemplaza esa planilla. **La meta del producto es que más del 80% de las
reservas las haga el socio desde su celular**, no el staff desde el mostrador: ese es el tiempo que
se vende.

## 2. Quiénes lo usan

| Rol                    | Sigla | Dónde entra | Qué hace                                                            |
| ---------------------- | ----- | ----------- | ------------------------------------------------------------------- |
| Super admin de Laplace | SAU   | DFSA        | Administra los suscriptores, los planes y la salud de la plataforma |
| Dueño del centro       | SMU   | DFSM        | Todo lo de su centro: sin techo dentro de su organización           |
| Staff del centro       | SSU   | DFSM        | Lo que su rol le habilita: mostrador, coach, encargado              |
| Socio del centro       | MU    | WAFM        | Reserva, cancela, ve sus packs y su QR                              |

**Los roles del staff son presets, no jaulas.** El permiso se otorga por recurso y acción —"puede
leer socios", "puede cobrar"—, así que un centro puede armar el suyo. Los cuatro que vienen
armados:

- **Encargado**: todo salvo las métricas de negocio, la facturación y la gestión de accesos.
- **Coach**: sus clases, la asistencia, los resultados y la salud de sus atletas. **No ve plata.**
- **Head coach**: lo del coach más crear y publicar planificaciones.
- **Mostrador**: alta de socios, venta de packs, cobros y check-in manual. Sí ve plata, porque cobra.

> 🔴 **El coach no ve deuda ni saldo, y no porque la pantalla se lo esconda: la API no se lo manda.**
> Es una regla del producto (§2.1.12), y está verificada con tests desde la API.

## 3. Las cuatro aplicaciones

### DFSA — el panel del super admin

Los suscriptores con su plan, su estado y su uso contra los límites. Los planes y sus precios. El
panel de salud técnica y el buscador de soporte: el socio comparte el código de error que vio y del
otro lado se ve qué pasó.

> 🔴 **El super admin no ve datos de socios de ningún centro.** Ve conteos, nunca personas. Para
> entrar a una cuenta hay un solo camino, la impersonación, que exige motivo, dura poco, queda
> auditada y **le avisa al dueño de la cuenta**.

### DFSM — el escritorio del centro

Es el tablero del día, no un menú: al abrirlo se ve lo que hay que hacer hoy. Las clases con su
ocupación, cuánta gente entró, la caja del día y el panel de alertas accionables.

Además: el asistente de primeros pasos para el centro nuevo, la ficha 360 del socio, la lista de
clase del coach en mobile, el kiosco de check-in para la tablet de la entrada y el buscador global
(Ctrl+K, porque quien atiende tiene las manos en el teclado y a alguien esperando).

### WAFM — la app del socio

Mobile first, para usar de pie y con una mano. El horario del centro, reservar y cancelar, sus
packs con lo que le queda y hasta cuándo, su QR de check-in **a un toque**, sus datos y sus
notificaciones.

### Landing — la puerta de entrada

Qué es el producto, cuánto sale, qué incluye cada plan y cómo empezar la prueba. Con las páginas
legales y el formulario de contacto.

## 4. Qué hace cada módulo

### Socios (Members)

Alta, edición y baja de socios, con estados explícitos: activo, inactivo, suspendido, archivado. Se
pasa de uno a otro por transición validada, nunca editando el campo a mano.

- **Códigos de invitación**: el centro genera un código con vencimiento y límite de usos, lo manda
  al grupo de WhatsApp y cada socio asocia su cuenta solo. Se puede revocar, y revocarlo no afecta a
  quienes ya lo usaron.
- **Importación por CSV** con previsualización y validación fila por fila: se ve qué va a entrar
  antes de que entre.
- **Notas internas del staff**, con su propio permiso. **El socio nunca las ve.**
- **Ficha 360**: una sola pantalla con todo lo del socio — sus datos, su cuenta, sus packs, lo que
  tiene reservado, su asistencia de los últimos 90 días, lo que firmó y las notas.

### Sedes y salas (Venues, Rooms)

Un centro puede tener varias sedes, cada una con su zona horaria, su moneda, sus horarios y su
política de reserva. Al crear una sede se crea su sala principal: nadie quiere configurar dos cosas
para empezar.

La política de reserva es por sede **y por categoría de clase**: cuánto antes se abre y se cierra la
reserva, hasta cuándo se cancela sin perder el crédito, cuánto antes abre el check-in, si se puede
reservar debiendo, cuántas ausencias habilitan un bloqueo y por cuánto.

### Catálogo (Products)

Lo que el centro vende: pack de clases, membresía ilimitada, membresía con tope, clase suelta, clase
de prueba, entrenamiento personal y evento. Cada producto define su precio, su vigencia, en qué
sedes vale, para qué categorías, en qué franja horaria y si se ve en la app del socio.

La clase de prueba es **una sola vez por persona**, y el sistema lo sabe.

### Contratos (Contracts)

Lo que el socio compró: sus créditos, su vencimiento y su estado. Se puede congelar —con tope anual
configurable— y se vence solo, avisando 7, 3 y 1 días antes.

> 🔴 **El crédito se descuenta al reservar, no al asistir** (ADR-001). Es lo que hace que el cupo
> sea real: si se descontara al entrar, quien reserva y no va no le cuesta nada y el lugar se pierde
> igual.

Cuando hay varios contratos activos, el crédito sale del que vence primero.

### Agenda (Schedule)

Las clases se definen una vez como plantilla —día, hora, sala, cupo, coach— y el sistema materializa
la grilla de los próximos 60 días. Se edita "solo esta clase" o "esta y las que siguen", y las
pasadas nunca se tocan: son el histórico de lo que de verdad ocurrió.

Cancelar una clase cancela sus reservas, devuelve los créditos y avisa a los inscriptos, todo junto.

### Reservas (Booking)

Reservar toma el lugar y descuenta el crédito **en una sola operación**: no existe el estado
intermedio donde el lugar está tomado y el crédito no.

- **Lista de espera** con posición, promoción automática cuando alguien cancela y ventana para
  confirmar.
- **Cancelación**: dentro del plazo devuelve el crédito; fuera del plazo, la app lo dice **antes**
  de confirmar. Enterarse después de haber perdido el crédito es la queja número uno de este tipo de
  producto.
- **Ausencias**: el que reservó y no fue queda marcado por un proceso automático, y acumular
  ausencias puede bloquear la reserva por un tiempo configurable.

### Asistencia (Attendance)

La lista de clase del coach, pensada para el celular con una mano en el piso del box: quién está
anotado, quién entró, y las alertas que necesita ver al lado del nombre.

El check-in se toma de tres formas: el coach marca, el socio pasa su QR por la tablet de la entrada,
o entra alguien sin reserva y se le vende la clase en el momento.

> 🔴 **El QR del socio rota y vive poco.** Un código fijo se saca una foto y se comparte.

### Documentos legales (Waivers)

El reglamento, el deslinde de responsabilidad y los consentimientos, versionados. Cuando el socio
firma, queda registrado **qué versión exacta firmó**, cuándo y desde dónde. Si el centro publica una
versión nueva, lo firmado queda marcado como desactualizado: "firmó el reglamento" y "firmó **este**
reglamento" son cosas distintas.

El centro puede exigir la firma para dejar entrar.

### Cobranza (Billing)

Cargos y pagos manuales, estado de cuenta por socio, mora automática, caja diaria por sede y
reembolsos con motivo. El dinero se maneja siempre en **centavos enteros**: nunca en decimales.

> En Fase 1 el cobro es manual: el centro registra lo que cobró. El cobro online con Mercado Pago
> entra en Fase 2. **El dinero del socio nunca pasa por Laplace** (ADR-002).

### Avisos (Notifications)

Los ocho avisos del MVP: confirmación de reserva, recordatorios 24 h y 1 h antes, promoción desde la
lista de espera, clase cancelada, cambio de coach, pack por vencer, pago recibido y deuda vencida.

Cada socio elige qué quiere recibir y por qué canal, y hay una ventana horaria: nadie manda un
recordatorio a las 3 de la mañana.

### Métricas (Metrics)

Los números del centro precalculados por día: asistencia, ocupación, socios activos, ingresos,
morosidad. Alimentan el tablero del día y el panel de alertas.

> 🔴 Las métricas de negocio son del dueño y del encargado. El coach no las ve.

### Suscripciones (Susc)

El ciclo de vida del cliente de Laplace: alta desde la landing con **prueba de 14 días sin
tarjeta**, planes Basic / Pro / Max con sus límites, cambio de plan y datos fiscales.

- **Subir de plan es inmediato y se prorratea; bajar es al fin del ciclo**, y antes se valida que lo
  que ya tiene entre en el plan nuevo.
- **Cambiar el precio de un plan no cambia lo que paga quien ya está suscripto.**

> 🔴 **Nunca se borra nada por falta de pago.** Suspender es cambiar un estado: los socios, la
> agenda y la caja siguen exactamente donde estaban, y el día que paga vuelve a entrar y encuentra
> todo.

### CRM

Los interesados que llegan por el formulario de la landing, con su estado y su seguimiento.

## 5. Los planes

| Plan  | Sedes    | Socios activos | Staff    | Qué suma                                                     |
| ----- | -------- | -------------- | -------- | ------------------------------------------------------------ |
| Basic | 1        | 60             | 3        | Lo necesario para operar: socios, agenda, reservas, cobranza |
| Pro   | 3        | 180            | 10       | Planificación, resultados, RMs, QR, avisos push y WhatsApp   |
| Max   | sin tope | sin tope       | sin tope | Salud, CRM, marca propia en la app y modo TV                 |

**Los límites se aplican en el servidor.** Esconder un botón no es una restricción: el socio 61 de
un plan Basic falla con un error que dice cuál es el límite y qué plan lo levanta.

## 6. Los datos de las personas

- El socio puede **descargar todo lo que el centro guarda de él**, en JSON, en el momento. Un
  resumen elegido por nosotros no cumple el derecho de acceso.
- Puede **pedir la baja**. Se registra con fecha, no se ejecuta en el acto: el centro tiene
  obligaciones sobre lo firmado y lo cobrado. Los datos se conservan 90 días y después se purgan.
- Los datos de salud son **opcionales por diseño**: nadie puede ser obligado a darlos.
- La foto de perfil se guarda con enlace firmado que vence. Nunca una URL pública permanente de la
  foto de una persona.

## 7. Qué no hace todavía

Lo que la Fase 1 deja afuera a propósito, con su fase:

- **Cobro online** y débito automático con Mercado Pago → Fase 2.
- **Planificación de entrenamientos**, resultados y leaderboard → Fase 2.
- **Push y WhatsApp**: en Fase 1 los avisos son in-app y por email → Fase 2.
- **RMs, datos de salud y multi-sede con roles por sede** → Fase 3.
- **Reportes exportables, API pública y marca propia en la app del socio** → Fase 4.

Y lo que falta de la Fase 1 misma, que está anotado como deuda en
[ACTION-PLAN.md](ACTION-PLAN.md): las pantallas de alta de sede, clase y producto del DFSM —hoy
esas operaciones existen en la API pero se hacen sin pantalla— y la venta de packs desde el
mostrador.

# [LAPLACE] — Spec

> **Versión:** 2.1 · **Fecha:** 2026-08-31 · **Autor spec original:** Braian Vaylet · **Revisión:** research-driven + decisiones cerradas
>
> **Decisiones cerradas en v2.1:** (1) tenant = **Organization**; (3) el crédito se **descuenta al reservar**; (4) monetización **solo por suscripción mensual**, sin comisión por transacción.
> **Regla de esta revisión:** no se eliminó ningún contenido de la v1. Todo lo nuevo está marcado con **`[+]`** y todo lo reescrito/ampliado con **`[~]`**. El texto original se conserva íntegro.

---

## 0. Registro de cambios de esta revisión `[+]`

| # | Cambio | Impacto |
|---|---|---|
| 1 | Nueva **Sección 0.1: Investigación de mercado y benchmark** | Base de las mejoras |
| 2 | Nuevo **Billing Module** (cobro centro → miembro) | 🔴 Bloqueante comercial |
| 3 | Nuevo **Products Module** (membresías recurrentes, drop-in, trial, PT) | 🔴 Bloqueante comercial |
| 4 | Nuevo **Check-in & Attendance Module** | 🔴 Bloqueante de métricas |
| 5 | Nuevo **Results / Whiteboard Module** (scoring de WOD, leaderboard, PRs) | 🟠 Diferencial de engagement |
| 6 | Nuevo **CRM / Leads Module** | 🟡 Growth |
| 7 | Nuevo **Waivers & Consents Module** | 🔴 Riesgo legal (Ley 25.326) |
| 8 | Nuevo **Audit Module** (trazabilidad) | 🟠 Soporte y compliance |
| 9 | Nuevo **Entitlements Module** (enforcement de planes en backend) | 🔴 Sin esto los planes son decorativos |
| 10 | Schedule Module ampliado: capacidad, waitlist, cutoff, no-show, recurrencia, coach asignado | 🔴 Core |
| 11 | Packs Module ampliado: congelamiento, política de consumo de crédito, transferencia | 🟠 |
| 12 | Metrics Module ampliado: MRR, churn, ARPM, LTV, utilización, cohortes + benchmarks | 🟠 |
| 13 | Health Module: consentimiento explícito, cifrado, minimización, borrado | 🔴 Legal |
| 14 | Notifications: push (Web Push), email, WhatsApp; plantillas y preferencias | 🟠 |
| 15 | **Sección 5.2 completada**: modelo de datos MongoDB, índices, concurrencia | 🔴 Estaba vacía |
| 16 | Nueva **Sección 8: Multi-tenancy y aislamiento** | 🔴 Core arquitectónico |
| 17 | Nueva **Sección 9: Seguridad, privacidad y cumplimiento legal** | 🔴 |
| 18 | Nueva **Sección 10: Jobs, colas y procesos automáticos** | 🟠 |
| 19 | Nueva **Sección 11: Observabilidad, logs y códigos de error** (formato definido) | 🟠 |
| 20 | Nueva **Sección 12: Roadmap por fases (MVP → V1)** | 🔴 Alcance |
| 21 | Nueva **Sección 13: Riesgos y decisiones abiertas** | 🟠 |
| 22 | Nueva **Sección 14: Glosario de estados** | 🟡 |
| 23 | Nueva **Sección 15: Criterios de aceptación transversales (DoR / DoD)** | 🟠 |

---

## 0.1 Investigación de mercado y benchmark `[+]`

### 0.1.1 Panorama competitivo

**Segmento global (CrossFit / funcional):**

| Plataforma | Posicionamiento | Fortaleza | Debilidad |
|---|---|---|---|
| **Wodify** | All-in-one WOD-native | Performance tracking, leaderboards, benchmarks, billing integrado | Precio alto (desde ~USD 109–179/mes por sede), pesado |
| **SugarWOD** | Comunidad + programación | Whiteboard digital, PRs automáticos, feed social, ~1M atletas | No reemplaza gestión completa; sin tags/filtros en librería |
| **PushPress** | Operación simple | CRM/AI maduro, check-in ágil, tier gratuito | Tier free con comisión de procesamiento más alta |
| **Zen Planner** | Reportes + multidisciplina | Rankings/currículum (artes marciales), reporting | Muchas features como add-on pago |
| **Beyond the Whiteboard** | Analítica profunda | Librería 1500+ WODs, progresión por movimiento | Solo tracking, no gestión |
| **Mindbody / Glofox / Mariana Tek** | Enterprise / boutique | Marketplace, multi-sede, reporting enterprise | Sobredimensionado para un box |
| **Gymdesk / Virtuagym / GymMaster** | Value / generalistas | Precio plano, migración de billing | Menor profundidad WOD |

**Segmento LATAM / Argentina (competencia directa real de Laplace):**

| Plataforma | Notas |
|---|---|
| **SigueFIT** (referencia del spec) | Pilates/gimnasios/estudios multiactividad. Turnos, pagos, ficha de cliente, emails, procesos automáticos, control de acceso. App de cliente con QR de acceso, historial de turnos, últimos pagos y sección de novedades. App admin separada con agenda día/semana/mes y vista horizontal de múltiples salas. |
| **BoxMagic** | Gestión completa + finanzas y sueldos, buena integración Mercado Pago. Tarifa en USD. |
| **CrossHero** | Estándar para boxes: WODs, pizarras de resultados, engagement. Tarifa en USD. |
| **Fitco** | Boutique (yoga/pilates), foco marketing/retención y clases híbridas. Tarifa en USD. |
| **SocioPLUS / XCORE** | Robustos en hardware: molinetes, biometría/facial, integración fiscal AFIP. |
| **GymGestión / GymSmartAccess** | Cobro en pesos vía Mercado Pago, débito automático, recordatorios por WhatsApp, alertas de morosidad, QR de acceso. |

### 0.1.2 Ventaja competitiva de Laplace (posicionamiento propuesto) `[+]`

Los competidores caen en dos grupos: **WOD-native sin gestión local** (Wodify, SugarWOD, CrossHero) y **gestión local sin profundidad de entrenamiento** (SigueFIT, SocioPLUS, XCORE). Casi ninguno tiene ambas cosas *y* precio en pesos.

> **Posicionamiento sugerido:** *"La profundidad de entrenamiento de Wodify con la operación y el cobro en pesos de un software argentino, multi-disciplina (no solo CrossFit)."*

Tres cuñas defendibles:
1. **Precio en ARS**, sin exposición al dólar (dolor explícito en el mercado local frente a BoxMagic/CrossHero/Fitco).
2. **Multi-disciplina real** desde el día 1 (CrossFit + funcional + pilates + hyrox en el mismo centro). El mercado castiga a las plataformas mono-disciplina.
3. **Planning + Results + RMs + Health integrados**: nadie en LATAM une planificación, resultado, RM y limitaciones físicas del atleta en un mismo flujo.

### 0.1.3 Tabla de gaps detectados vs. spec v1

| Gap | Severidad | Presente en competidores | Resuelto en |
|---|---|---|---|
| Cobro a miembros / mora / débito automático | 🔴 Crítico | Todos | Billing Module (§2.1.16) |
| Membresía recurrente ilimitada (no solo packs) | 🔴 Crítico | Todos | Products Module (§2.1.17) |
| Check-in / asistencia | 🔴 Crítico | Todos | Attendance Module (§2.1.18) |
| Capacidad, waitlist, cutoff, no-show | 🔴 Crítico | Todos | Schedule ampliado (§2.1.5) |
| Resultados de WOD + leaderboard + PR | 🟠 Alto | Wodify, SugarWOD, BTWB, CrossHero | Results Module (§2.1.19) |
| Consentimiento datos de salud | 🔴 Legal | Parcial | Waivers Module (§2.1.20) + §9 |
| KPIs de negocio (churn/MRR/LTV) | 🟠 Alto | Wodify, Zen Planner | Metrics ampliado (§2.1.12) |
| Leads / conversión de prospectos | 🟡 Medio | PushPress, Fitco, Mindbody | CRM Module (§2.1.21) |
| Control de acceso QR | 🟡 Medio | SigueFIT, GymGestión, XCORE | Attendance Module (§2.1.18) |
| Enforcement de límites de plan | 🔴 Crítico | Todos | Entitlements (§2.1.22) |
| Notificaciones push/WhatsApp | 🟠 Alto | Todos | Notifications ampliado (§2.1.14) |
| Facturación fiscal AFIP | 🟡 Medio | SocioPLUS, XCORE | Fuera de alcance v1 (§3) |

---

## 1. Resumen

"Laplace project" es un producto para la gestion de centros de deportivos adaptable a actividades como crossfit, Funcional, Hybrid, Hyrox, Pilates, Gimnasios, etc. Cuenta con aplicativos web para su gestion y seguimiento.

### 1.1 Diccionario

#### Tipo de usuarios:
- Super Admin user: (SAU) Super Administrador, es el desarrollador del producto y quien los gestiona. Tiene acceso al DFSA.
- Suscriptor Manager user: (SMU) Es quien contrata el servicio y puede acceder a las aplicaciones y modulos contratados. Tiene acceso al DFSM.
- Suscriptor Staff user: (SSU) Es quien tiene acceso a determinados modulos del producto, el Suscriptor Manager es quien le otorga los permisos. Tiene acceso limitado al DFSM.
- Member user: (MU) Miembro de un centro deportivo que utiliza el producto, tiene acceso a la webapp. Tiene acceso a la WAFM.

##### `[+]` Sub-roles de Staff (SSU)

El rol `suscriptor_staff` es demasiado grueso. Se define un set de sub-roles preconfigurados, todos personalizables por permiso:

| Sub-rol | Alcance típico |
|---|---|
| `coach` | Ver clases asignadas, tomar asistencia, cargar resultados, ver Health de sus atletas, ver planificaciones |
| `front_desk` | Alta de miembros, venta de packs, registrar pagos, check-in manual |
| `head_coach` | Todo lo de coach + CRUD de planificaciones y ejercicios |
| `manager_assistant` | Todo salvo métricas de negocio y facturación |

> 👀 **Crítica a la v1:** un solo rol `staff` obliga a elegir entre dar de más (recepcionista viendo ingresos) o de menos (coach que no puede tomar asistencia). Los permisos deben ser por *recurso + acción*, no por rol fijo.

#### Componentes:
- DFSA: Dashboard for Super Admin.
- DFSM: Dashboard for Suscriptor Manager.
- WAFM: Webapp for Members.
- Landing: Landing page.

#### Planes:
- Plan: Planes que pueden ser contratados.
- Basic: Plan Basico, el mas economico.
- Pro: Plan Pro, el intermedio.
- Max: Plan Max, el mas completo.

#### Terminologias:
- Laplace: Nombre clave del proyecto de gestion de centros de fitnes.
- Rooms: Salas, un Suscriptor Manager puede tener mas de un centro deportivo asociado a su cuenta.
- Centros: Centro fitnes, deportivo, o donde se realice alguna actividad deportiva.
- Packs: Los centros funcionan con packs de clases, cada pack creado cuenta con un total de clases disponibles, un vencimiento y un costo. Ej: Un centro puede crear un plack de 8 clases con vencimiento de 30 dias a un valor de 60.000 pesos Argentinos. Eso significa que el miembro que le contrate ese pack al centro tendra 30 dias para utilizarlo y solo podra anotarse desde la WAFM a 8 clases.

##### `[~]` Aclaración de jerarquía: Organization → Venue → Room

> 👀 **Ambigüedad detectada en la v1:** "Rooms" se usa para *sucursal* ("puede tener más de un Box de Crossfit"), pero *sala* es también el espacio físico con capacidad. Mezclar ambos rompe el modelo de capacidad de clase y el de métricas por sede.

Jerarquía propuesta (3 niveles, el intermedio es opcional en planes bajos):

```
Organization (tenant = el suscriptor, la unidad de facturación del SaaS)
└── Venue / Sede         (unidad de negocio: dirección, marca, métricas y caja propias)
    └── Room / Sala      (espacio físico: capacidad máxima, equipamiento)
        └── ClassSession (clase concreta con horario, coach y cupo)
```

- El **límite del plan** ("1 sala / 3 salas / sin límite") pasa a contarse en **Venues**, no en Rooms.
- Un Venue con 1 sola sala (caso 90%) se crea automáticamente al crear el Venue → el usuario nunca ve el concepto "Room" salvo que lo necesite.

**Términos nuevos:**
- **Product / Producto**: cualquier cosa vendible a un miembro (pack, membresía, drop-in, trial, PT, evento).
- **Contract / Contrato**: la instancia comprada por un miembro concreto (antes: "pack asociado a un miembro").
- **Credit / Crédito**: unidad de clase consumible de un contrato.
- **Booking / Reserva**: intención de asistir a una ClassSession.
- **Attendance / Asistencia**: confirmación de que efectivamente asistió (check-in).
- **Result / Resultado**: marca registrada por un atleta en una clase (tiempo, rondas, carga).
- **Entitlement**: permiso derivado del plan contratado del SaaS.
- **Lead / Prospecto**: interesado que aún no es miembro.

#### Modulos
- Auth Module: modulo de autheticacion.
- Account Module: modulo de gestion de la cuenta.
- Suscriptors Module: modulo de gestion de suscriptores.
- Suscriptions Module: modulo de gestion de suscripciones.
- Schedule Module: modulo de gestion de horarios y clases.
- Rooms Module: modulo de gestion de salas.
- Members Module: modulo de gestion de miembros.
- Trainning Module: modulo de gestion de ejercicios.
- Packs Module: modulo de gestion de packs de clases.
- Planning Module: modulo de gestion de planificaciones.
- RMs Module: modulo de gestion de cargas y RMs.
- Metrics Module: modulo de gestion de metricas.
- Health Module: Modulo de salud.
- Notifications Module: modulo de notificaciones.
- Feedback Module: modulo de gestion de feedback.

##### `[+]` Módulos nuevos
- **Billing Module**: cobros del centro a sus miembros, deuda, mora, recibos.
- **Products Module**: catálogo vendible (packs, membresías, drop-in, trial, PT, eventos).
- **Attendance Module**: check-in, asistencia, control de acceso.
- **Results Module**: whiteboard, scoring de WOD, leaderboard, PRs.
- **Waivers Module**: deslindes, consentimientos y aptos médicos versionados.
- **CRM Module**: prospectos, clase de prueba, conversión.
- **Audit Module**: bitácora de acciones sensibles.
- **Entitlements Module**: enforcement de límites y features por plan.

## 2. Objetivo / Éxito

- Laplace es un producto que debe permitir la gestion y seguimiento de centros fitnes y miembros.
- El producto debe contar con 4 aplicativos web. Los aplicativos seran: Dashboard for Super Admin (DFSA), Dashbord for Suscriptor Manager (DFSM), Webapp for Members (WAFM) y Landingpage.
- La forma de monetizacion sera por medio de suscripciones, un valor mensual dependiendo de los servicios que se contraten. Se tendran 3 tipos de packs: Basic, Pro y Max.
- El DFSA debe ser un dashboard web optimizado para desktop en el cual el Super Admin pueda gestionar a los suscriptores, las suscripciones, los ejercicios y ver metricas del producto.
- El DFSM debe ser un dashboard para los suscriptores que se suscriben a alguno de los planes disponibles, en funcion al plan seleccionado tendran acceso o no a diferentes modulos y funcionalidades de la plataforma.
- LA WAFM debe ser una webapp para el uso de los miembros o atletas, desde la cual pdran gestionar sus clases, RMs y ver estadisticas.
- La landing page debe ser publica y debe explicar y mostrar de que trata y como funciona el producto.

### `[+]` 2.0 Métricas de éxito del producto (cómo sabemos que funciona)

Sin métricas de éxito, "éxito" es una opinión. Objetivos medibles para los primeros 12 meses:

| Métrica | Objetivo | Por qué |
|---|---|---|
| Time-to-first-class | < 30 min desde el registro del SMU hasta la primera clase publicada | Onboarding es donde se pierde el SaaS |
| Activación | 60% de trials crean ≥1 clase y ≥5 miembros en 7 días | Predictor de conversión |
| Churn mensual de suscriptores | < 5% | Benchmark de la industria fitness: 3–5% mensual es sano, >7% indica estancamiento |
| Adopción WAFM | > 50% de los miembros del centro con ≥1 login/semana | Sin adopción del miembro, el SMU no percibe valor |
| Reservas self-service | > 80% de bookings hechos por el miembro (no por staff) | Es el ahorro de tiempo que se vende |
| p95 de respuesta API | < 400 ms | Percepción de velocidad en el mostrador |
| Uptime | ≥ 99.5% mensual | Si la app cae a las 6 AM, el box no abre |

### 2.1 Modulos

1. Auth Module: Se encarga de la authenticacion y registro de usuarios, se reutiliza para cada uno de los aplicativos y esta basado en Better Auth.
- Registro de usuarios via aplicaciones de terceros (gmail, Outlook, etc).
- Recupero de contraseña.
- Seguridad.
- Velocidad.
- Disponible en: Landing-page, DFSA, DFSM, WAFM.

**`[+]` Ampliación Auth**
- Usar el **plugin `organization` de Better Auth** como base de multi-tenancy: organizaciones, miembros, invitaciones y RBAC ya resueltos (no reinventar tablas ni flujo de invitación). Roles por defecto `owner`/`admin`/`member`; se definen roles propios con `createAccessControl` para `coach`, `front_desk`, `head_coach`.
- **Regla:** `checkRolePermission` solo para render de UI. La autorización real se resuelve **siempre en el servidor** (`hasPermission` / guard propio). Nunca confiar en el cliente.
- **Un usuario, múltiples pertenencias:** un mismo email puede ser MU en dos centros y SSU en uno. Sesión con `activeOrganizationId` + selector de centro en la WAFM.
- Verificación de email obligatoria antes de reservar.
- **Rate limiting** en login, registro y recupero (ver §9).
- Sesiones: rotación de refresh token, revocación por dispositivo, cierre de sesión global.
- 2FA opcional (TOTP) para SMU y obligatorio para SAU.
- Magic link como alternativa a password para MU (reduce fricción en mobile).
- Bloqueo progresivo tras N intentos fallidos.
- **Criterio de aceptación transversal:** ningún endpoint responde datos de una organización distinta a la del token, ni siquiera con IDs válidos de otro tenant (test de IDOR obligatorio).

2. Account Module: Se encarga de la gestion de la cuenta del usuario (varia dependiendo del rol del usuario).
- CRUD de datos del usuario.
- Para los usuarios de tipo member y staff permite subir foto de perfil y editar su informacion personal (nombre, apellido, edad, descripcion, etc)
- Para los usuarios de tipo suscriptor_manager permite subir foto del centro y editar su informacion personal (marca personal, nombre del centro, direccion, telefono, descripcion, etc)

**`[+]` Ampliación Account**
- **Preferencias de notificación** por canal (push / email / WhatsApp) y por tipo de evento.
- **Zona horaria y locale** por usuario y por Venue (crítico: el vencimiento de un pack a "30 días" debe calcularse en la TZ del centro, no del servidor). Usar `Temporal` con `ZonedDateTime`, nunca `Date` nativo para lógica de negocio.
- **Contacto de emergencia** para MU (dato operativo real en centros deportivos).
- **Derechos del titular de datos**: exportar mis datos (JSON) y solicitar baja/eliminación desde la propia cuenta (ver §9).
- Subida de imágenes: validación de mime real (no extensión), límite de tamaño, recorte en cliente, almacenamiento en Backblaze con URL firmada de corta duración. Nunca URLs públicas permanentes de fotos de personas.
- Baja de cuenta: soft-delete con anonimización a los N días, preservando agregados de métricas.

3. Suscriptors Module: Se encarga del alta de nuevos suscriptores, los nuevos suscriptores pueden ser dados de alta por el Super Admin o desde un formulario en la landingpage.
- CRUD de suscriptores.
- Cambios de estado (enabled, disabled, blocked).
- Disponible en: DFSA.

**`[+]` Ampliación Suscriptors**
- Estados ampliados: `trial`, `active`, `past_due` (pagó tarde), `suspended` (impago), `cancelled`, `blocked` (decisión del SAU).
- **Self-service signup**: desde la landing, el SMU crea su cuenta, elige plan y arranca un **trial de 14 días sin tarjeta**. El alta manual del SAU queda como excepción, no como camino principal.
- Asistente de onboarding guiado: crear Venue → horarios → primera clase → primer producto → invitar miembros. Con barra de progreso persistente.
- **Impersonación** por parte del SAU para soporte: requiere motivo, es temporal, se audita y se notifica al SMU (ver Audit Module).
- Datos fiscales del suscriptor (CUIT, razón social, condición IVA) para el comprobante del SaaS.
- Suspensión automática por impago con período de gracia configurable y **datos preservados** (nunca borrar por falta de pago).

4. Suscriptions Module: Se encarga de la gestion de los planes de suscripcion (basic, pro y max). Permite definir su precio, su informacion (la cual se muestra en la landingpage) y que modulos y funcionalidades se incluyen en cada uno de los 3. Se permite crear planes personalizados para suscriptores vip.
- CRUD de suscripciones/planes
- Cambio de informacion de planes (nombre, precio, descripcion, vigencia, tags, que incluye/no incluye (modulos, funcionalidades, limites)).
- Disponible en: DFSA.

**`[+]` Ampliación Suscriptions (ciclo de vida y cobro del SaaS)**
- **Cobro recurrente con Mercado Pago Suscripciones**: se crea un `preapproval_plan` por plan y luego un `preapproval` por suscriptor (autorización del pagador para cargos recurrentes con un medio de pago definido). Alternativa manual (transferencia) para VIP.
- **Webhooks idempotentes**: cada notificación de pago se procesa una sola vez (clave de idempotencia = `payment.id`), con reintentos y cola de fallidos.
- **Dunning**: reintento de cobro, aviso al día 1/3/7 de vencido, `past_due` → `suspended` al día 10. Configurable.
- **Precios versionados**: cambiar el precio de un plan NO debe cambiar retroactivamente lo que paga un suscriptor existente (grandfathering). Cada suscripción guarda el `priceSnapshot`.
- **Cambio de plan**: upgrade inmediato con prorrateo; downgrade al fin del ciclo, con validación previa de límites (ej: si tiene 120 miembros y baja a Basic (60), se bloquea el downgrade y se explica exactamente qué excede).
- **Inflación / ARS**: precios en pesos con posibilidad de ajuste programado y aviso previo obligatorio de 30 días. Campo `currency` desde el día 1 aunque solo se use ARS.
- Cupones y períodos promocionales (`X meses al Y%`), con fecha de expiración.
- Panel de MRR del SaaS para el SAU (ver §2.1.12).

5. Schedule Module: Se encarga de la gestion de horarios y clases tanto para los centros como para los miembros.
- CRUD de clases de un centro.
- CRUD de clases de un miembro
- Un centro puede elegir los horarios de atencion (abierto/cerrado), permite fraccionar el dia/semana en clases. Las clases pueden diferenciarse por medio de una categoria, permitiendo tener clases para diferentes disiplinas.
- Un miembro con plan activo puede anotarse a una clase de un centro o modificar o darse de baja de una.
- Disponible en: DFSM (para gestion de clases), WAFM (para gestion de sus packs contratados).

**`[~]` Ampliación Schedule — reglas de negocio de reserva (el corazón del producto)**

Este es el módulo donde se juega la percepción de calidad. Todos los competidores lo tienen resuelto; la v1 no lo modelaba.

**a) Modelo de clase**
- `ClassTemplate`: plantilla recurrente (nombre, categoría/disciplina, duración, capacidad por defecto, coach por defecto, sala, regla de recurrencia tipo RRULE, vigencia desde/hasta).
- `ClassSession`: instancia concreta y materializada de la plantilla en una fecha/hora. **Toda edición individual afecta solo a la sesión**; editar la plantilla ofrece "solo esta / esta y futuras" (comportamiento tipo Google Calendar).
- Excepciones: feriados, cierres por vacaciones, clases canceladas (con notificación automática y devolución de crédito).

**b) Capacidad y lista de espera**
- `capacity` por sesión (hereda de la sala, se puede sobreescribir).
- **Waitlist** con: tamaño máximo, orden FIFO, ventana de confirmación (ej: 15 min) y promoción automática hasta N minutos antes del inicio. Si no confirma, pasa al siguiente. La promoción debe ser automática, sin intervención del staff.
- Métrica derivada: tasa de conversión de waitlist (indica si falta oferta en ese horario).

**c) Ventanas de tiempo (todas configurables por Venue y por categoría)**
| Regla | Default sugerido |
|---|---|
| `bookingOpensAt` | 7 días antes |
| `bookingClosesAt` | 15 min antes del inicio |
| `cancelCutoff` | 2 h antes |
| `waitlistPromotionCutoff` | 30 min antes |
| `checkInWindow` | desde 30 min antes hasta 30 min después del inicio |

**d) Políticas de penalización**
- **Late cancel** (cancelar dentro del cutoff): configurable → no devuelve crédito / devuelve crédito / devuelve y avisa.
- **No-show** (reservó y no hizo check-in): consume crédito y se registra en el perfil. Penalización opcional tras N no-shows: bloqueo temporal de reservas (ej: 48 h). Esta es la práctica estándar del sector.
- Ambas políticas deben ser **visibles para el miembro en el momento de reservar** (texto de política en el modal de confirmación).

**e) Concurrencia (🔴 requisito técnico no negociable)**
La reserva de cupo es una condición de carrera clásica: dos personas tomando el último lugar a las 6:00 AM.
```js
// Reserva atómica sin transacción: el filtro y el $inc viajan juntos
const session = await ClassSession.findOneAndUpdate(
  { _id: sessionId, tenantId, status: 'scheduled', $expr: { $lt: ['$bookedCount', '$capacity'] } },
  { $inc: { bookedCount: 1 } },
  { new: true }
);
if (!session) return toWaitlist(); // cupo lleno → lista de espera
```
- Índice **único** en `bookings { tenantId, sessionId, memberId }` para impedir doble reserva.
- Toda cancelación decrementa `bookedCount` en la misma operación atómica y dispara la promoción de waitlist.

**f) Otros**
- **Coach asignado** por sesión + flujo de sustitución con notificación a los inscriptos.
- Vistas de agenda **día / semana / mes** y vista horizontal por sala cuando hay más de una (patrón validado por SigueFIT).
- Reserva desde el DFSM en nombre de un miembro (mostrador).
- Turnos 1:1 (personal training) como sesión de capacidad 1 con coach obligatorio.
- Duplicar semana / copiar horario de una semana a otra (ahorro de tiempo real para el SMU).
- Auto-cancelación de sesión si no llega a un mínimo de inscriptos X minutos antes (opcional).

6. Rooms Module: Se encarga de la gestion de Salas para un usuario Suscriptor Manager. Puede crear mas de una sala y administrarlas por separado. Este modulo esta pensado para centros que cuenten con mas de una sucursal y cada uno se necesite gestionar como una unidad de negocio independiente de las demas. Ej: Un SMU puede tener mas de un Box de Crossfit, o puede tener un gimnasio y un centro de pilates, o se puede tratar de una cadena de centros funcionales, etc.
- CRUD de salas.
- Disponible en: DFSM.

**`[~]` Ampliación Rooms → Venues + Rooms** (ver jerarquía en §1.1)
- **Venue**: nombre, marca/logo propio, dirección, geolocalización, teléfono, TZ, moneda, horarios de atención, políticas de reserva propias, caja y métricas independientes.
- **Room**: nombre, capacidad, equipamiento disponible (racks, bicis, remos) — habilita en el futuro reservar equipamiento.
- Un miembro puede pertenecer a varios Venues del mismo suscriptor; el staff puede tener alcance limitado a un Venue.
- **Los datos NO se mezclan entre Venues** salvo el perfil del atleta (RMs, health) que es del atleta, no del centro (ver §2.1.11 y §9).
- El límite del plan cuenta Venues activos. Archivar un Venue libera el cupo pero preserva histórico.

7. Members Module: Se encarga de la gestion de los miembros de un centro. Los miembros son los atletas que toman clases de alguna disiplina fitnes en algun centro que tenga contratado el servicio. Son quienes tendran acceso a la WAFM. Pueden estar asociados a mas de un centro, podran desde la WAFM elegir el que quieren usar.
- CRUD de miembros desde el DFSM.
- Generacion de codigos para asociar miembros a su centro. Ejemplo, el atleta Juan se registra en la WAFM y utiliza un codigo generado pro el SMU de un centro para poder asociar su cuenta con la de ese centro deportivo.
- Disponible en: DFSM y DFSA.

**`[+]` Ampliación Members**
- **Ficha 360 del miembro** (una sola pantalla, es la pantalla más usada del DFSM): datos personales · estado de cuenta y deuda · contratos activos y créditos restantes · próximas reservas · asistencia últimos 90 días · RMs · alertas de salud · feedback · waivers firmados · notas internas del staff.
- **Estados del miembro**: `lead` → `trial` → `active` → `at_risk` → `inactive` → `archived`; más `debtor` (en mora) y `suspended` como flags transversales.
- **Alerta de riesgo de churn**: sin asistir hace 14 días es la señal más fuerte de baja inminente; el sistema debe listarlos automáticamente en un panel "Miembros en riesgo" con acción de contacto en un click.
- **Códigos de invitación**: código por Venue con expiración, límite de usos y revocación (la v1 no definía expiración → riesgo de que un código filtrado se use indefinidamente).
- Importación masiva por CSV con previsualización y validación fila por fila (crítico para migrar desde Excel o desde un competidor: es la fricción #1 de cambio de plataforma).
- Etiquetas/segmentos libres (ej: "turno mañana", "competidores", "rehabilitación") para filtrar y notificar.
- Notas internas del staff, no visibles para el miembro, con autor y fecha.
- Menores de edad: campo de tutor responsable y consentimiento del tutor obligatorio antes de reservar.

8. Trainning Module: Se encarga de la carga de ejercicios en la aplicacion. Los ejercicios cargados por el Super Admin desde el DFSA son visibles y de uso para todos los centros desde el DFSM, a su vez desde los DFSM se pueden cargar ejercicios propios que solo seran visibles para ese centro. Los miembros podran ver el listado de ejercicios o entrenamientos que el centro cargo y gestionar sus cargas y RMs desde la WAFM.
- CRUD de ejercicios o entrenamiento. (Para SAU y SMU)
- Ver ejercicios y entrenamientos. (Para MU)
- Disponible en: DFSA, DFSM y WAFM.

**`[+]` Ampliación Training (librería de ejercicios)**
- **Taxonomía obligatoria** (SugarWOD pierde puntos justamente por no tener tags ni filtros): `category` (halterofilia, gimnásticos, monoestructural, accesorio), `movementPattern` (empuje, tracción, bisagra, sentadilla, core, locomoción), `equipment[]`, `modality` (G/W/M), `unit` (kg, reps, m, cal, seg), `isUnilateral`, `isBenchmarkable` (¿admite RM?).
- **Media**: video demostrativo (URL externa o Backblaze), imagen y descripción técnica. Servir video bajo demanda, nunca precargado (costo de ancho de banda).
- **Escalados y sustituciones**: cada ejercicio referencia alternativas (`scalingOptions[]`), que alimentan automáticamente al Health Module: si un atleta marcó "no puedo hacer overhead", la app sugiere la sustitución al coach.
- **Origen del dato**: sembrar la librería base con un dataset abierto (`free-exercise-db` u equivalente) + curación manual del SAU. No arrancar de cero.
- Herencia: `global` (SAU) → `organization` (SMU). El centro puede ocultar globales sin borrarlos y clonar uno global para editarlo.
- Búsqueda con filtros combinados y "usados recientemente" (el coach usa 30 ejercicios el 90% del tiempo).
- **Benchmarks nombrados** (Fran, Murph, Cindy, Grace…) como entidad propia con definición estándar y comparación histórica — es la feature que sostiene el engagement a largo plazo en las plataformas líderes.

9. Packs Module: Permite la gestion de los packs para los centros desde el DFSM. Un pack es una unidad que cuenta con las siguientes caracteristicas (nombre, cantidad de clases, fecha de inicio, fecha de vencimiento, precio, categoria, descripcion). La categoria implica en que tipo de clases se pueden usar y cuales no. Los packs pueden ser asociados a un miembro, un miembro puede tener mas de un pack contratado al mismo tiempo, ya sean de diferentes centros o del mismo. Los miembros pueden ver la informacion de sus packs desde la WAFM, ver cuantas clases tienen disponibles y su vencimiento.
- CRUD de packs. (para SMU y SSU)
- Asociar pack a miembro. (para SMU y SSU)
- Ver packs disponibles (para MU)
- Disponible en: DFSM y WAFM.

**`[~]` Ampliación Packs → se absorbe dentro de Products + Contracts (§2.1.17)**

Reglas que faltaban definir y que van a generar bugs si no se cierran ahora:

- **✅ DECIDIDO — ¿Cuándo se consume el crédito? Al reservar.** El crédito se descuenta (`creditsUsed++`) en la misma operación atómica que crea la Booking. No existe estado `held`.
  Reglas derivadas, todas obligatorias:
  | Evento | Efecto sobre el crédito |
  |---|---|
  | Reserva creada | Se descuenta 1 crédito |
  | Cancelación **dentro** del plazo (antes del `cancelCutoff`) | **Se devuelve** automáticamente |
  | Cancelación **fuera** de plazo (late cancel) | No se devuelve (ya está consumido) |
  | No-show | No se devuelve (ya está consumido) |
  | Clase cancelada por el centro | **Se devuelve** + notificación a todos los inscriptos |
  | Contrato congelado (freeze) | Se cancelan las reservas futuras y **se devuelven** esos créditos |
  | Walk-in sin reserva (check-in directo en mostrador) | Se descuenta **en el check-in** — único camino donde el consumo no ocurre al reservar |
  | Ajuste manual del staff | Motivo obligatorio + registro en AuditLog |
  > ⚠️ Consecuencia a tener presente: **asistencia y consumo quedan desacoplados.** La utilización real de clase y la tasa de no-show se miden con `Attendance`, nunca con los créditos consumidos.
- **Orden de consumo con múltiples contratos activos**: FIFO por fecha de vencimiento más próxima, y entre iguales, el de categoría más específica. Debe ser determinista y explicable al miembro.
- **Congelamiento (freeze/hold)**: pausar un contrato por vacaciones o lesión, corriendo la fecha de vencimiento. Con máximo de días por año configurable. **Feature muy pedida y ausente en la v1**; al congelar, liberar automáticamente todas las reservas futuras y quitarlo de las waitlists.
- **Vencimiento**: job diario que expira contratos, notifica 7/3/1 días antes y ofrece renovación en un click desde la WAFM (esto es ingreso directo).
- Renovación automática opcional del pack.
- Transferencia de créditos entre miembros: **no permitida** por defecto (habilitable por el SMU).
- Créditos de cortesía / ajuste manual del staff con motivo obligatorio (queda auditado).
- Restricción por categoría ya prevista en v1 → se mantiene y se extiende a restricción por horario (ej: "pack matutino, válido 6–12 h") y por Venue.

10. Planning Module: Modulo que permite la planificacion de clases, las planificaciones pueden asociarse a una o mas clases, a uno o mas dias, a uno o mas meses debe ser flexible (como agendar un evento en un calendario.). Al momento de crear una planificacion, se permite agregar ejercicios desde el modulo traning y colocarles el numero de repeticiones, % de cargas, tiempos, etc. El SMU o SSU debe poder tener la flexibilidad de armar la rutina como quiera. Estas rutinas pueden ser compartidas con los miembros (desde la WAFM). El modulo debe permitir ir viendo estadisticas de la planificacion a medida que se arma, para tener un registro de que ejercicios se agregaron por clase, dia, semana, etc. Los miembros pueden puntuar la planing y dejar un comentario (feedback) desde la WAFM, esto le permite al Staff mejorar sus planificaciones o saber cuales son las favoritas por su publico.
- CRUD de planificaciones.
- Hacerlas visibles a los miembros (Algunos centros prefiern no compartir la planificacion hasta el momento de la clase).
- Analizar planificacion en tiempo real.
- Reutilizarlas.
- Drag and Drop.
- CRUD de Feedback. (Para los MU)
- Disponible en: DFSM y WAFM.

**`[+]` Ampliación Planning**
- **Estructura por bloques**, no una lista plana: `Planning → Block[] → Item[]`. Cada bloque tiene un **tipo de scoring** propio (warmup, strength, metcon, accessory, cooldown) y un formato (`for_time`, `amrap`, `emom`, `tabata`, `rft`, `chipper`, `strength_sets`, `not_scored`).
- **Publicación programada**: `publishAt` (ej: "visible a las 20:00 del día anterior"). Resuelve el requisito de la v1 de no compartir hasta el momento de la clase, sin depender de que alguien apriete un botón.
- **Plantillas y biblioteca**: guardar planificación como plantilla, clonar semana, ciclos de N semanas con progresión de %.
- **Analítica de programación en vivo** (la v1 lo pide, acá se define qué medir): volumen por patrón de movimiento, distribución G/W/M, minutos de trabajo por bloque, ejercicios repetidos en los últimos 7/14/30 días, balance empuje/tracción. Panel lateral que se actualiza mientras se arma.
- **Cargas relativas**: al escribir "5 × 3 @ 80%", la WAFM resuelve el peso concreto de cada atleta usando su RM (ver §2.1.11). Ese es el puente entre Planning y RMs y es el mayor diferencial funcional del producto.
- **Chequeo de salud automático**: al publicar, avisar al coach qué atletas inscriptos tienen restricciones sobre los ejercicios programados y sugerir el escalado.
- Notas privadas del coach (no visibles al atleta) vs. notas públicas.
- Adjuntar video/imagen al bloque.
- Drag and drop con `pragmatic-drag-and-drop` (ya en el stack) — requisito de accesibilidad: **toda acción de DnD debe tener equivalente por teclado** (mover arriba/abajo), si no se rompe WCAG.

11. RMs Module: Modulo que permite a los miembros gestionar sus RMs y porcentajes de cargas en sus ejercicios de Fuerza desde la WAFM. Permite registrar un valor de RM para un ejercicio del modulo Traning y automaticamente obtener los porcentajes de cargas (65%, 75%, 80%, 85%, 90%, 95%, % custom). Permite ir registrando varios valores de RM para el mismo ejercicio teniendo un historial y pudiendo ver estadisticas de su evolucion en el tiempo. Los centros podran ver esta informacion y usarla para ayudar a los athletas a mejorar. Cada ejercicio puede completarse con su valor de RM, sus repeticiones (estas pueden cargarse varios set de repeticiones por ejercicio y asociarle un % de carga) y un tiempo. Ejemplo: Ejercicio Snatch, RM cargado 100kg, Set de repeticiones cargados 3 (para el 65% tiene 12 repeticiones como maximo, para 85% tiene un maximo de 8 repeticiones, para 95% su repeticiones maximas fue de 3.)
- CRUD de RM
- Estadisticas
- Disponibles en: WAFM y DFSM

**`[+]` Ampliación RMs**
- **RM estimado a partir de submáximos**: si el atleta levanta 90 kg × 3, estimar el 1RM (fórmula de Epley/Brzycki, configurable) y marcarlo como `estimated` vs `tested`. Nunca mezclar ambos en el mismo gráfico sin distinguirlos.
- Redondeo al **incremento de disco disponible** del centro (ej: 2.5 kg) y desglose de discos por lado. Detalle chico, altísimo valor percibido en el piso del box.
- Unidades kg/lb por preferencia del usuario, almacenando siempre en kg.
- Historial con gráfico de evolución, PR marcado y fecha, y comparación contra el bloque programado.
- **🔴 Decisión de privacidad crítica (corrige un riesgo de la v1):** la v1 dice que "los valores de RM cargados para un centro se replican en los demás". Eso, implementado literalmente, es una fuga de datos entre tenants.
  - **Modelo correcto:** el RM pertenece al **perfil global del atleta** (`athleteProfile`, propiedad del usuario), no a la organización.
  - Cada centro **ve** los RMs del atleta solo si el atleta **consintió compartir su perfil con ese centro** (consentimiento por Venue, revocable desde la WAFM).
  - Así se cumple la intención de la v1 (mismo RM en Gym Black y Box Toro) sin violar el aislamiento ni la Ley 25.326.

12. Metrics Module: Modulo que permite ver metricas de diferentes campos de la base de datos, dependiendo el rol de usuario.
- Metricas para miembros: Evolucion de RMs, Total de packs contratados, Evolucion de asistencias a clases. El miembro puede ver metricas asociadas a cada centro y a su vez estadisticas globales en el caso de entrenar en mas de un centro. (Los valores de RM cargados para un centro se replican en los demas. Ejemplo si en el Gym Black cargo un RM de 100kg para snatch, en el Box Toro debe ver el mismo valor de RM para ese ejercicio si ambos centros lo comparten.)
- Metricas para SMU: Los suscriptores manager deben poder ver metricas relacionadas a su negocio (cantidad de packs contratados, ingresos, cantidad de miembros, etc). Tambien deben poder ver metricas de la evolucion de cada miembro.
- Metricas para SSU: Los usuarios de Staff no deben poder ver las metricas relacionadas al negocio (esas son privadas y unicas para el manager). No deben tener acceso a este modulo.
- Metricas para SAU: El super admin debe ver metricas a nivel negocio (cantidad de suscripciones, de usuarios Staff, de miembros totales y por centro, de salas, de ejercicios creados, etc).
- Disponible en: DFSA, DFSM, WAFM.

**`[+]` Ampliación Metrics — KPIs concretos y benchmarks de industria**

La v1 lista "cantidad de X". Eso son conteos, no KPIs. Un dueño de centro toma decisiones con estos números:

**Panel SMU — Negocio**
| KPI | Fórmula | Benchmark de industria |
|---|---|---|
| **MRR** | Σ ingreso recurrente mensual | — |
| **ARPM** (ingreso por socio) | MRR / socios activos | Objetivo > USD/ARS equivalente a ~250; en boxes, ARPU alto sostiene el modelo |
| **Churn mensual** | bajas del mes / activos al inicio | **3–5% sano; <3% excelente; >7% alerta** |
| **Retención 90 días** | % que sigue activo a los 90 días | Primer trimestre concentra la mayoría de las bajas |
| **LTV** | ARPM / churn mensual | Debe ser ≥ 3× el costo de adquisición |
| **Asistencias por socio por semana** | asistencias / socios activos | **2.5–3.5 sano; <2 alerta.** Es el mejor predictor individual de baja |
| **Utilización de clase** | inscriptos / capacidad | Detecta horarios muertos y horarios saturados |
| **Tasa de no-show y late-cancel** | por horario y categoría | Define si hay que endurecer política o hacer overbooking |
| **Conversión de waitlist** | promovidos / total en espera | Señal para abrir otro horario |
| **Morosidad** | deuda vencida / facturación del mes | KPI #1 del mercado argentino |
| **Utilización de coach** | horas dictadas / horas disponibles | Costo laboral bajo control |
| **Cohortes de alta** | retención por mes de ingreso | Las altas de enero tienen tasa de baja mucho mayor |

**Panel SMU — Alertas accionables** (más valioso que cualquier gráfico): miembros sin asistir hace 14 días · contratos que vencen en 7 días · deudores · clases con baja ocupación esta semana · atletas sin waiver firmado.

**Panel SAU — SaaS**
MRR/ARR del producto · suscriptores por plan · churn de suscriptores · trials activos y conversión trial→pago · uso por módulo (qué se usa y qué no) · centros al límite de su plan (oportunidad de upsell) · salud técnica (errores por código, p95, jobs fallidos).

**Panel MU — Atleta**
Asistencias por mes y racha · evolución de RMs · PRs recientes · créditos disponibles y vencimiento · balance de disciplinas.

**Implementación:** precalcular agregados diarios en una colección `metricsDaily` por (tenantId, venueId, fecha). **No calcular KPIs con agregaciones en vivo sobre colecciones grandes** — es la causa #1 de dashboards lentos.

13. Health Module: Este modulo esta pensado para que los miembros puedan compartir informacion con los centros, ejemplo: Peso, altura, edad, discapacidades, lesiones, etc. Tambien pueden seleccionar ejercicios del listado e indicar si pueden o no hacerlos y si presentan alguna molestia al realizarlo. Estos datos podran ser vistos por los SMU y SSU desde el DFSM y les permitira tenerlo en cuenta al momento de realizar las planificaciones para buscar soluciones como cambiar ejercicios o agregar opciones para esas personas.
- CRUD de datos personales.
- CRUD de estado por ejercicio.
- Visualizacion desde el modulo miembros en el DFSM y health desde la WAFM.
- Disponible en: DFSM y WAFM.

**`[~]` Ampliación Health — 🔴 requisitos legales obligatorios**

En Argentina, lesiones, discapacidades y condiciones médicas son **datos sensibles** bajo la Ley 25.326: nadie puede ser obligado a proporcionarlos, su tratamiento exige **consentimiento expreso, informado y por escrito**, el responsable debe adoptar **medidas técnicas y organizativas** de seguridad, y todos los que intervienen quedan sujetos al **deber de secreto**. La AAIP (Res. 47/2018) recomienda niveles de seguridad reforzados. Requisitos derivados:

1. **Consentimiento explícito y versionado** antes de habilitar el módulo, con texto que indique: qué se recolecta, para qué, quién lo verá (staff del centro X), por cuánto tiempo y cómo revocarlo. Guardar versión del texto, timestamp e IP.
2. **Opcionalidad real**: el miembro debe poder usar toda la app sin completar Health. Nunca bloquear reservas por no completarlo.
3. **Granularidad**: el atleta elige qué comparte y con qué Venue. Revocable en un click, con efecto inmediato.
4. **Minimización**: no pedir diagnósticos ni historia clínica. Modelo recomendado: *limitación funcional por ejercicio* (`can_do` / `with_modification` / `cannot_do` + nota corta), que es lo que el coach realmente necesita, en vez de "tiene hernia de disco L4-L5".
5. **Cifrado en reposo a nivel campo** para las notas de salud, con clave separada de la de la base.
6. **Acceso restringido**: solo coach asignado a la clase y manager. Cada lectura queda en el audit log.
7. **Retención y borrado**: eliminación a pedido y purga automática N días después de la baja del miembro.
8. **Peso/altura**: histórico opcional. No mostrar IMC ni juicios de valor, ni objetivos de peso automáticos.
9. **Disclaimer**: Laplace no es software médico y no reemplaza evaluación profesional. Debe figurar en el módulo.
10. **Apto médico**: campo de fecha de vencimiento del certificado + alerta automática al staff al vencer (práctica habitual y muchas veces exigida por seguros en AR).

> 👀 Este módulo, mal implementado, es el único del producto que puede generar responsabilidad legal directa. Si el MVP tiene que recortar algo, recortar Health antes que Billing — pero si se hace, se hace completo.

14. Notifications Module: Este modulo sirve para notificar a otros miembros de menor gerarquia. Ejemplo: El admin puede generar un mensaje para uno o mas suscriptores (manager y/o staff) el cual veran desde el DFSM, un SMU o SSU puede generar un mensaje para que los miembros vean desde la WAFM. Cada aplicativo tiene una seccion de notificaciones donde los usuarios pueden acceder a ellas.
- CRUD de notificaciones.
- Disponible en: DFSA, DFSM, WAFM.

**`[+]` Ampliación Notifications**
- **Canales**: in-app (v1) + **Web Push** (PWA, clave para "tu clase es en 1 h" y "ya se publicó el WOD") + email transaccional + **WhatsApp** (canal dominante en Argentina para recordatorios y avisos de mora; vía proveedor con plantillas aprobadas).
- **Notificaciones transaccionales automáticas** (no solo mensajes manuales): confirmación de reserva · recordatorio 24 h y 1 h antes · promoción desde waitlist · cancelación de clase o cambio de coach · pack por vencer / vencido · pago recibido / rechazado / deuda · WOD publicado · PR conseguido.
- Preferencias por usuario y canal, con opt-out garantizado por canal (excepto avisos críticos de facturación).
- Plantillas editables por el SMU con variables (`{{nombre}}`, `{{clase}}`, `{{hora}}`).
- Envío segmentado por etiqueta/estado (ej: "todos los que vencen esta semana").
- Cola con reintentos, deduplicación y ventana horaria (no enviar push a las 3 AM).
- Registro de entregas para soporte ("no me llegó el aviso").

15. Feedback Module: Este modulo permite gestionar el Feedback dentro de la plataforma. El feedback puede ser dado a usuarios como a planificaciones.
- Los SMU pueden dar feedback a los SSU.
- Los SSU pueden dar feedback a los MU y a las planificaciones.
- Los MU pueden dar feedback a los SSU, al SMU y a las planificaciones (solo si se habilito la opcion para que puedan verlas).
- Todo el feedback de los SSU y MU y del propio SMU se ve en el module members del DFSM.
- Cada miembro puede ver su propio feedback desde la WAFM.
- El feedback consiste en un puntaje de la eleccion de 1 a 5 pulgares (👍, 👍👍, 👍👍👍, 👍👍👍👍, 👍👍👍👍👍) o del pulgar para abajo en casos de completo desacuerdo (👎), ademas de dejar un mensaje.
- CRUD de feedback

**`[+]` Ampliación Feedback**
- Almacenar el puntaje como **entero 1–5** con `thumbsDown` como flag booleano aparte (0 no es un 1: es una señal distinta). Renderizar con pulgares es decisión de UI, no de modelo.
- Anonimato opcional del feedback del MU hacia el staff — sin esto, el feedback negativo simplemente no se escribe.
- Agregados: promedio por planificación, por coach, por categoría de clase y por período. Ranking de planificaciones favoritas (pedido explícito en la v1).
- Feedback post-clase disparado automáticamente tras el check-in (una pregunta, un tap).
- Moderación: el SMU puede ocultar feedback abusivo, con registro en el audit log (nunca borrado silencioso).
- Métrica derivada tipo NPS por Venue.

---

### `[+]` Módulos nuevos

16. **Billing Module** — 🔴 **el gap más grave de la v1.** Gestiona el dinero entre el centro y sus miembros.
- Registro de pagos manuales (efectivo, transferencia, POS) con comprobante y responsable.
- Cobro online vía **Mercado Pago** (Checkout Pro para pago único de pack; Suscripciones/`preapproval` para cuota mensual con débito automático).
- **Estado de cuenta por miembro**: cargos, pagos, saldo, deuda vencida.
- **Gestión de mora**: cada socio debe tener estado visible en tiempo real (al día / en mora / inactivo / pendiente) y el pasaje a mora debe ser automático, sin cálculo manual.
- Recordatorios automáticos de vencimiento y de deuda (WhatsApp/push/email).
- **Caja diaria** por Venue: ingresos del día por método de pago, arqueo, exportable.
- Descuentos, promociones, planes familiares, becas y precios diferenciales.
- Reembolsos y notas de crédito con motivo obligatorio.
- Webhooks idempotentes + conciliación diaria (comparar pagos reportados vs. registrados).
- **Nunca almacenar datos de tarjeta.** Tokenización del lado del proveedor, siempre.
- Reporte de ingresos por producto, por Venue y por período; exportación CSV para el contador.
- **Fuera de alcance v1:** facturación electrónica AFIP (ver §3 y §13).

17. **Products Module** — catálogo vendible. Absorbe y generaliza el Packs Module.
Tipos de producto:
| Tipo | Descripción | Consumo |
|---|---|---|
| `class_pack` | N clases con vencimiento (modelo de la v1) | Por crédito |
| `membership_unlimited` | Cuota mensual recurrente, clases ilimitadas | Sin crédito, valida vigencia |
| `membership_limited` | Cuota mensual con tope semanal/mensual (ej: 3×semana) | Por período |
| `drop_in` | Clase suelta | 1 crédito |
| `trial` | Clase de prueba gratuita, 1 sola vez por persona | 1 crédito |
| `personal_training` | Bono de sesiones 1:1 | Por crédito |
| `event` | Competencia, seminario, challenge | Inscripción |
| `product` | Venta física simple (remera, suplemento) — opcional | — |

> 👀 **Por qué es bloqueante:** modelar solo packs deja afuera al gimnasio y al estudio de pilates, que trabajan con **cuota mensual**. La v1 dice apuntar a "Gimnasios, Pilates, Funcional" pero solo modela el mecanismo de un box de CrossFit.

- Atributos comunes: nombre, tipo, precio, vigencia, categorías habilitadas, franja horaria habilitada, Venues habilitados, visible/oculto en WAFM, auto-renovación, cupo máximo de ventas.
- **Contract**: instancia comprada, con estados `pending_payment` · `active` · `frozen` · `expired` · `exhausted` · `cancelled`.
- Venta self-service desde la WAFM (el miembro compra y renueva solo) — convierte la app en canal de ingreso, no solo de gasto.

18. **Attendance & Access Module** — check-in y asistencia.
- Check-in: **QR desde la WAFM** (patrón validado por SigueFIT y GymGestión), tablet-kiosko en la puerta, o manual desde la lista de clase del coach.
- QR con token rotativo de corta vida (evita capturas de pantalla compartidas).
- **Lista de clase para el coach** en mobile: inscriptos, presentes, waitlist, alertas de salud, deuda (opcional), y check-in de todos en un tap.
- Validación al hacer check-in: contrato vigente + crédito disponible + waiver firmado + (opcional) sin deuda.
- Registro de `bookedAt`, `checkedInAt`, `method`, `by` (self / staff / kiosk).
- Estados de reserva: `booked` · `waitlisted` · `checked_in` · `late_cancelled` · `cancelled` · `no_show`.
- Modo offline en el kiosko (cola local, sincroniza al recuperar red).
- **Fuera de alcance v1**: molinetes y biometría (integración de hardware). Dejar la API preparada.

19. **Results / Whiteboard Module** — 🟠 el diferencial de engagement diario.
> Un log de gimnasio registra series, reps y peso. Un log de WOD registra **tiempo** para For Time, **rondas + reps** para AMRAP, **tiempo por ronda** para EMOM y **carga** para 1RM: cuatro formatos de scoring distintos en la misma semana. La v1 solo modela RM, es decir uno de los cuatro.

- **Tipos de score**: `time`, `rounds_reps`, `load`, `reps`, `distance`, `calories`, `points`, `not_scored`.
- **Niveles**: `rx` / `scaled` / `foundations` / `custom`, con leaderboard separado por nivel (comparar Rx contra escalado no tiene sentido).
- **Leaderboard** por sesión, por día y por Venue; y ranking histórico por benchmark.
- **PR automático**: al cargar un resultado, detectar si supera el histórico del atleta y celebrarlo (notificación + badge). Los PRs calculados automáticamente son el mecanismo que hace visible el progreso que de otro modo se pierde.
- Comentarios y reacciones entre atletas de la misma clase (el componente social es el que sostiene el uso diario).
- Notas del atleta y sensación percibida (RPE 1–10).
- **Modo TV/whiteboard**: vista pública en pantalla grande dentro del box, con el WOD del día y el scoreboard en vivo. Es el reemplazo digital de la pizarra.
- Privacidad: el atleta puede ocultar sus resultados del leaderboard sin dejar de registrarlos.

20. **Waivers & Consents Module** — 🔴 legal.
- Documentos versionados: deslinde de responsabilidad, términos y condiciones, política de privacidad, consentimiento de datos de salud, consentimiento de uso de imagen (fotos en redes), consentimiento de tutor para menores.
- Firma digital simple (aceptación con timestamp, IP, user agent y hash del texto de esa versión).
- **Bloqueo de check-in** si falta el waiver obligatorio (configurable por Venue).
- Re-aceptación automática al publicar una versión nueva.
- Panel de cumplimiento: quién firmó qué y cuándo; exportable.

21. **CRM / Leads Module** — 🟡 growth.
- Captura desde la landing del centro y desde el formulario de contacto.
- Pipeline simple: `nuevo` → `contactado` → `clase de prueba agendada` → `asistió` → `convertido` / `perdido`.
- Asignación a un responsable + recordatorio de seguimiento.
- **Velocidad de respuesta**: la conversión cae fuerte pasados los primeros minutos; el sistema debe alertar leads sin contactar en 15 min.
- Métricas: leads/semana, conversión lead→socio, costo por lead (carga manual), origen.

22. **Entitlements Module** — 🔴 sin esto, los planes Basic/Pro/Max son solo texto en la landing.
- Definición declarativa de qué habilita cada plan: módulos, features y **límites numéricos** (venues, miembros activos, usuarios staff, almacenamiento).
- **Enforcement en el backend**, en un middleware, no en la UI. Ocultar un botón no es una restricción.
- Comportamiento al alcanzar el límite: bloquear la creación con mensaje claro (`"Alcanzaste el máximo de 60 miembros del plan Basic"` + CTA de upgrade), nunca fallar en silencio.
- Aviso al 80% y al 100% del límite.
- Overrides por suscriptor para planes VIP/custom.
- Cache de entitlements en la sesión con invalidación al cambiar de plan.

### 2.2 Planes

1. BASIC: Plan Base, el mas economico y con acceso limitado. Incluye:
- DFSM: Schedule Module y Packs Module.
- WAFM: Schedule Module.
- 1 sola sala, hasta 60 miembros, hasta 10 usuarios Staff.

2. PRO: Plan Pro, el intermedio y con acceso a mas modulos y funcionalidades con limites.
- DFSM: Schedule Module, Packs Module, Rooms Module, Members Module, Training Module, Metrics Module.
- WAFM: Schedule Module, Training Module, Metrics Module.
- 3 salas, hasta 180 miembros, hasta 10 usuarios Staff.

3. Max: Plan Max, el mas completo y con acceso a todos los modulos y sin limites.
- DFSM: todos los modulos disponibles.
- WAFM: todos los modulos disponibles.
- Sin limites de salas y usuarios.

#### `[~]` 2.2.1 Revisión del empaquetado de planes

> 👀 **Problema en la v1:** el plan Basic no incluye **Members Module**. Sin gestión de miembros no se puede operar: no hay a quién asignarle un pack ni quién reserve. Y sin **Billing**, ningún plan resuelve el dolor principal del mercado argentino. El empaquetado actual hace que Basic sea inutilizable y que Pro sea el verdadero piso.

**Empaquetado propuesto** (mismos 3 nombres, distinto contenido):

| Módulo | Basic | Pro | Max |
|---|:--:|:--:|:--:|
| Auth / Account / Entitlements | ✅ | ✅ | ✅ |
| **Members** (era Pro) | ✅ | ✅ | ✅ |
| Schedule + reservas + waitlist | ✅ | ✅ | ✅ |
| Products & Packs | ✅ | ✅ | ✅ |
| **Billing** (pagos manuales) | ✅ | ✅ | ✅ |
| Billing online (Mercado Pago) | ❌ | ✅ | ✅ |
| Attendance / check-in QR | básico | ✅ | ✅ |
| Waivers | ✅ | ✅ | ✅ |
| Notifications (in-app + email) | ✅ | ✅ | ✅ |
| Notifications push / WhatsApp | ❌ | ✅ | ✅ |
| Training (librería) | solo lectura | ✅ | ✅ |
| Planning | ❌ | ✅ | ✅ |
| Results / Whiteboard | ❌ | ✅ | ✅ |
| RMs | ❌ | ✅ | ✅ |
| Metrics básicas | ✅ | ✅ | ✅ |
| Metrics avanzadas (churn, LTV, cohortes) | ❌ | ✅ | ✅ |
| Multi-Venue | 1 | 3 | ilimitado |
| Health | ❌ | ❌ | ✅ |
| CRM / Leads | ❌ | ❌ | ✅ |
| Feedback | ❌ | ✅ | ✅ |
| Marca propia en WAFM | ❌ | ❌ | ✅ |
| Modo TV / whiteboard | ❌ | ❌ | ✅ |
| Exportación de datos | ✅ | ✅ | ✅ |
| Límite de miembros activos | 60 | 180 | ilimitado |
| Límite de staff | 3 | 10 | ilimitado |

Notas:
- Basic con 10 staff y 60 miembros está desbalanceado (un centro de 60 socios no tiene 10 empleados). Se baja a 3.
- El límite se cuenta sobre **miembros activos**, no históricos: archivar a los que se fueron no debe costar plata.
- Exportar los propios datos debe estar en todos los planes. Retenerlo como rehén genera mala reputación y es lo que hace que la gente no migre hacia vos tampoco.

## 3. Fuera de alcance (Non-goals)

- No se debe desarrollar ninguna funcionalidad que no este documentada en las specs.
- No se debe seguir malas practicas en desarrollo de software y en seguridad informatica.
- No se debe dejar sin documentar ninguno de los procesos.

### `[+]` 3.1 Fuera de alcance explícito para V1

Declarar esto por escrito evita scope creep (y evita que la IA lo implemente "por las dudas"):

- **Facturación electrónica AFIP/ARCA** (CAE, comprobantes fiscales). Se registra el pago y se emite recibo interno, no factura fiscal.
- **Apps nativas iOS/Android** en tiendas. La WAFM es PWA instalable.
- **Hardware**: molinetes, lectores biométricos, control de acceso facial.
- **Liquidación de sueldos** de coaches.
- **Clases online / streaming** de video en vivo.
- **Marketplace público** de centros (buscador de gimnasios tipo Mindbody).
- **Nutrición y planes alimentarios.**
- **Wearables** (Polar, Whoop, Apple Health).
- **Multi-idioma**: solo español AR en V1 (pero la app se construye con i18n desde el día 1 para no rehacerla después).
- **Multi-moneda**: solo ARS (con el campo `currency` ya modelado).
- **Inventario y punto de venta** de productos físicos.
- **App de escritorio.**

## 4. Contexto / Estado actual

- Repo: https://github.com/BraianVaylet/laplace-project

### `[+]` 4.1 Contexto ampliado
- **Equipo:** 1 desarrollador (full-stack) + asistencia de IA. Este dato es la restricción más importante del proyecto y condiciona todo el §12 (roadmap).
- **Antecedente:** el módulo de RMs se basa en la app existente **BV Cross**; se reutiliza el modelo de datos y las fórmulas ya validadas ahí.
- **Infra actual:** Railway (Hobby), Mongo Atlas, Backblaze.
- **Gestión:** Trello (tablero Laplace) vía MCP.
- **Mercado objetivo inicial:** centros de Bahía Blanca y zona; validación con 2–3 boxes piloto antes de abrir el registro público.

## 5. Requisitos funcionales

- Action Plan: Es necesario un plan de accion con todas las tareas ordenadas por prioridad. Se debe ir actualizando para marcar las que ya se finalizaron usando [ ] y [x].
- Task: Separa el desarrollo en pequeñas tareas.Cada tarea debe tener un titulo, descripcion, criterios de aceptacion, ejemplos, estimacion (por complejidad)

```
// Task format:
{
    title,
    description,
    acceptance-criteria,
    example,
    story-points
}
```

- Trello: Usar trello via mcp para el registro de tareas, usa el tablero Laplace https://trello.com/b/8QrgU6Cc/laplace
- Documentation: Es necesario la generacion de documentacion: documento funcional, documento tecnico, documento de arquitectura, documentacion por aplicativo.
- Bitacora: Es necesario mantener un bitacora en la cual se deje documentado en un nuevo registro cada cambio que se realiza en el projecto.
- Idioma: Todas las variables y codigo debe estar en ingles, toda la documentacion y el producto debe estar en español.
- Todos los formularios deben tener validaciones en sus campos.
- Todos los llamados a servicios tienen que estar validados con un try/catch.
- Definir un diccionario de codigos de errores. [Definir Codigos de error]
- Todos los errores deben mostrarse al usuario de forma asertiva y deben incluir el codigo de error. El objetivo es que lo puedan compartir con el super admin para detectar donde esta fallando.
- Todo el codigo debe tener logs y deben tener todos el mismo formato. [Definir Formato]
- Los logs que correspondan a errores deben incluir el codigo de error.

### `[+]` 5.0 Requisitos funcionales adicionales

- **Task format ampliado**: agregar `module`, `depends_on[]`, `risk` (low/med/high) y `test_plan`. Sin dependencias declaradas, el Action Plan no es ordenable de forma confiable.
- **Story points por complejidad**: escala Fibonacci 1/2/3/5/8/13. Toda tarea > 8 se parte antes de empezar.
- **Definition of Ready / Done**: ver §15.
- **Validaciones**: un único esquema **Zod compartido entre front y back** (fuente de verdad única). Prohibido duplicar reglas de validación.
- **try/catch**: el requisito de la v1 es correcto pero insuficiente. Regla: `try/catch` + **error tipado** + **código de error** + **log estructurado** + **respuesta HTTP normalizada**. Un `catch` que solo hace `console.log` es peor que no tener catch.
- **Formato de respuesta de error unificado** (todas las APIs):
```json
{
  "success": false,
  "error": {
    "code": "LP-BOOK-409-002",
    "message": "La clase ya alcanzó su capacidad máxima.",
    "action": "Podés sumarte a la lista de espera.",
    "requestId": "01J9X...",
    "timestamp": "2026-08-31T14:03:11.412Z"
  }
}
```
- **Idempotencia** obligatoria en: reservas, pagos, webhooks y check-in (header `Idempotency-Key`).
- **Paginación** obligatoria en todo listado (cursor-based, nunca `skip` en colecciones grandes).
- **Versionado de API**: prefijo `/api/v1`. Sin excepciones.
- **Soft delete** por defecto; hard delete solo por solicitud del titular de los datos.
- **Bitácora**: se mantiene el requisito de la v1 y se agrega que cada entrada referencie el commit/PR y las tareas de Trello afectadas.

### 5.1. Aplicaciones

1. DFSA:
- Dashboard pensado principalmente para desktop
- Solo accede el usuario super-admin
- Componentes:
-- Header: Con acceso a configuracion, Cerrar sesion, cambio de tema, volver a la home.
-- Footer: Con informacion sobre el producto.
-- Panel de navegacion lateral izquierdo: Para navegar entre modulos, permite comprimirse para ganar espacio.

**`[+]`** Agregar: buscador global (por suscriptor, email, ID), panel de salud del sistema (errores por código, jobs fallidos, webhooks pendientes), impersonación auditada, gestión de la librería global de ejercicios y benchmarks, editor de textos legales versionados, feature flags por suscriptor.

2. DFSM:
- Dashboard pensado principalmente para desktop y mobile.
- Pueden acceder los usuarios suscriptior-manager y suscriptor-staff.
- El usuario suscriptor-staff puede acceder solo a algunos modulos, no puede acceder a metricas.
- Componentes: Misma estructura que el DFSA.
-- Header: Con acceso a configuracion, Cerrar sesion, cambio de tema, volver a la home.
-- Footer: Con informacion sobre el producto.
-- Panel de navegacion lateral izquierdo: Para navegar entre modulos, permite comprimirse para ganar espacio.

**`[+]`** Agregar:
- **Selector de Venue** en el header cuando hay más de uno (contexto activo persistente).
- **Home = tablero operativo del día**, no un menú: clases de hoy con ocupación, check-ins en vivo, cobros del día, alertas (deudores, packs por vencer, miembros en riesgo, aptos vencidos).
- **Vista mobile del coach**: la lista de clase y el check-in tienen que funcionar perfecto en un teléfono, de pie, con una mano. Es el uso real en el piso del box.
- Buscador global (miembro por nombre/DNI/teléfono) con atajo de teclado.
- Acciones rápidas: cobrar, agregar miembro, vender pack, marcar asistencia.

3. WAFM:
- Webapp pensada principalmente para mobile.
- Debe permitir instalarla en el dispositivo por medio de un boton presente en el login y en la configuracion de la app. Tambien debe aparecer un modal cada vez que que ingresa a la url de la webapp pidiendole instalarla.
- Cada vez que la webapp tenga una nueva actualizacion se le debe notificar al usuario para que la actualice por medio de un popup. No se puede cerrar el popup hasta que el usuario la actualice.
- Solo pueden acceder los usuarios members y suscriptor_staff (algunos usuarios staff pueden tomar clases en el mismo centro que administran por lo que deben poder hacer uso de la webapp).
- Componentes:
-- Header: Con acceso a configuracion, Cerrar sesion, cambio de tema, volver a la home.
-- Footer: Con informacion sobre el producto.
-- Barra de navegacion superior horizontal: Permite acceder a los modulos de la app.
-- El modulo de RM es similar al de la app bv-cross

**`[+]` Precisiones técnicas de la PWA**
- **iOS no soporta `beforeinstallprompt`**: en Safari/iOS hay que mostrar instrucciones manuales ("Compartir → Agregar a inicio"). Detectar plataforma y mostrar el flujo correcto, si no el botón de instalar no hace nada en la mitad de los usuarios.
- **Popup de actualización bloqueante**: aceptable, pero implementarlo con `skipWaiting` + `clients.claim()` y **con un escape a los 30 s** por si el service worker falla; si no, un bug de SW deja al usuario encerrado sin poder reservar. Nunca bloquear más de un minuto.
- **Modal de instalación recurrente**: no mostrarlo en cada visita (la v1 lo pide así) → penaliza fuerte la UX. Regla: mostrar máx. 1 vez cada 7 días y no volver a mostrarlo tras 2 rechazos.
- **Offline mínimo**: cachear el horario y las reservas propias para consulta sin red (los sótanos de los gimnasios no tienen señal). Las acciones de escritura se encolan y se sincronizan.
- **Web Push** con permiso solicitado en el momento correcto (después de la primera reserva, no al abrir).
- Selector de Venue si el miembro entrena en más de uno.
- **Bottom nav en mobile**, no top nav: el pulgar no llega arriba en pantallas grandes. La v1 pide barra superior; se recomienda revisarlo.
- Pantalla "Mi QR" accesible en 1 tap desde el home (es lo que abre en la puerta).

4. Landing:
- Landing page pensada principalmente para desktop y mobile.
- Puede acceder todo el publico.
- Componentes:
-- Header: Con redireccion a las secciones de la landing y acceso al DFSM y WAFM.
-- Footer: Con informacion sobre el producto.
-- Boton para volver al inicio de la landing visible en todo momento (auto scroll a la parte superior).
-- Secciones:
--- Banner + Presentacion
--- Descripcion del producto
--- Funcionalidades del producto.
--- Testimonios (carousel)
--- Imagenes y detalles de las interfaces.
--- Precios (Planes)
--- Preguntas FAQ
--- Acceso directo a Redes
--- Contacto (formulario)

**`[+]`** Agregar: CTA de **prueba gratis 14 días sin tarjeta** (principal), comparativa contra "gestionar con Excel y WhatsApp" (el competidor real), sección de seguridad y privacidad de datos, blog/SEO (`software gestión gimnasio Argentina`, `sistema para box de crossfit`, `software pilates turnos`), páginas legales (términos, privacidad), y **SSR/SSG + meta tags + sitemap** (la landing es el canal de adquisición: si es SPA sin SSR, no rankea).

### 5.2. Estructuras de Datos

#### `[+]` 5.2.1 Convenciones

- Toda colección de negocio lleva `tenantId` (= `organizationId`) **y** `venueId` cuando aplica. **Sin excepción.**
- Todo documento lleva `createdAt`, `updatedAt`, `createdBy`, `updatedBy`, `deletedAt` (soft delete).
- IDs: `ObjectId` interno; identificadores públicos con prefijo legible (`mem_`, `bkg_`, `pay_`) para soporte.
- Fechas: guardar siempre en **UTC**; interpretar y mostrar con la TZ del Venue usando `Temporal`.
- Dinero: **enteros en centavos** (`amountCents: number`) + `currency`. Nunca `float`.
- Nombres de campos y colecciones en **inglés** (requisito de la v1).

#### `[+]` 5.2.2 Colecciones principales (MongoDB)

```ts
// ── Tenancy & usuarios ────────────────────────────────────────────
User            { _id, email, name, avatarUrl, locale, timezone, prefs, authProviders[] }
Organization    { _id, name, ownerId, planId, planLimits, status, billing:{...},
                  fiscal:{ cuit, businessName, ivaCondition }, trialEndsAt }
Membership      { _id, userId, organizationId, venueIds[], role, permissions[], status } // Better Auth org plugin
Venue           { _id, tenantId, name, address, geo, phone, timezone, currency,
                  branding:{ logoUrl, colors }, businessHours[], bookingPolicy:{...}, status }
Room            { _id, tenantId, venueId, name, capacity, equipment[] }

// ── Miembros ──────────────────────────────────────────────────────
Member          { _id, tenantId, venueIds[], userId?, firstName, lastName, docId, phone,
                  birthDate, emergencyContact, status, tags[], joinedAt, lastAttendanceAt,
                  balanceCents, notes[] }
AthleteProfile  { _id, userId, unitPreference, sharedWith:[{ tenantId, scopes[], grantedAt }] } // global, del atleta
InviteCode      { _id, tenantId, venueId, code, maxUses, usedCount, expiresAt, revokedAt }

// ── Catálogo y contratos ──────────────────────────────────────────
Product         { _id, tenantId, venueIds[], type, name, priceCents, currency, credits?,
                  durationDays?, weeklyLimit?, allowedCategories[], allowedTimeRanges[],
                  autoRenew, visibleInApp, active }
Contract        { _id, tenantId, venueId, memberId, productId, priceSnapshotCents,
                  creditsTotal, creditsUsed, startsAt, endsAt,
                  status, freeze:{ days, from, to }, autoRenew }

// ── Facturación ───────────────────────────────────────────────────
Charge          { _id, tenantId, venueId, memberId, contractId?, amountCents, dueAt, status }
Payment         { _id, tenantId, venueId, memberId, chargeIds[], amountCents, method,
                  provider, providerPaymentId, status, receivedAt, receivedBy, idempotencyKey }
Refund          { _id, tenantId, paymentId, amountCents, reason, createdBy }

// ── Agenda ────────────────────────────────────────────────────────
ClassTemplate   { _id, tenantId, venueId, roomId, name, categoryId, durationMin, capacity,
                  coachId, recurrence:{ rrule, from, until }, bookingPolicy?, active }
ClassSession    { _id, tenantId, venueId, roomId, templateId?, name, categoryId,
                  startAt, endAt, capacity, bookedCount, waitlistCount, coachId,
                  planningId?, status } // scheduled | cancelled | completed
Booking         { _id, tenantId, venueId, sessionId, memberId, contractId?, status,
                  waitlistPosition?, bookedAt, cancelledAt, checkedInAt, checkInMethod,
                  creditConsumed }

// ── Entrenamiento ─────────────────────────────────────────────────
Exercise        { _id, scope:'global'|'org', tenantId?, name, category, movementPattern,
                  equipment[], modality, unit, isUnilateral, isBenchmarkable,
                  mediaUrl, scalingOptions[], tags[] }
Benchmark       { _id, scope, tenantId?, name, definition, scoreType }
Planning        { _id, tenantId, venueId, name, blocks:[{ type, format, timeCapSec, notes,
                  items:[{ exerciseId, reps, sets, loadPercent, distance, calories, notes }] }],
                  publishAt, visibility, createdBy, templateOf? }
Result          { _id, tenantId, venueId, sessionId, memberId, blockIndex, scoreType,
                  value, level, isPr, notes, rpe, visibility, createdAt }
RmRecord        { _id, userId, exerciseId, valueKg, type:'tested'|'estimated', reps?,
                  measuredAt, source:{ tenantId?, sessionId? } }

// ── Salud, legal, comunicación ────────────────────────────────────
HealthProfile   { _id, userId, tenantId, consentId, heightCm?, weightHistory[],
                  limitations:[{ exerciseId, level, note }], medicalClearanceExpiresAt } // cifrado a nivel campo
LegalDocument   { _id, scope, tenantId?, type, version, contentHtml, publishedAt, required }
Consent         { _id, userId, tenantId, documentId, version, acceptedAt, ip, userAgent, revokedAt }
Notification    { _id, tenantId, audience, channel, templateId, payload, status, sentAt, readAt }
Feedback        { _id, tenantId, targetType, targetId, authorId, score, thumbsDown, message, anonymous }
Lead            { _id, tenantId, venueId, name, phone, email, source, stage, ownerId, nextFollowUpAt }
AuditLog        { _id, tenantId, actorId, action, resourceType, resourceId, before, after, ip, at }
MetricsDaily    { _id, tenantId, venueId, date, kpis:{ mrrCents, activeMembers, churn,
                  attendances, utilization, noShowRate, ... } }
```

#### `[+]` 5.2.3 Índices obligatorios

```js
// Aislamiento y performance: el tenantId SIEMPRE va primero en el índice compuesto
Member:        { tenantId: 1, status: 1, lastAttendanceAt: -1 }
Member:        { tenantId: 1, docId: 1 } // unique sparse
ClassSession:  { tenantId: 1, venueId: 1, startAt: 1 }
Booking:       { tenantId: 1, sessionId: 1, memberId: 1 } // UNIQUE → evita doble reserva
Booking:       { tenantId: 1, memberId: 1, bookedAt: -1 }
Contract:      { tenantId: 1, memberId: 1, status: 1, endsAt: 1 }
Payment:       { tenantId: 1, idempotencyKey: 1 } // UNIQUE → webhooks idempotentes
Result:        { tenantId: 1, sessionId: 1 }
RmRecord:      { userId: 1, exerciseId: 1, measuredAt: -1 }
AuditLog:      { tenantId: 1, at: -1 } // + TTL de retención
MetricsDaily:  { tenantId: 1, venueId: 1, date: -1 } // UNIQUE
```

#### `[+]` 5.2.4 Reglas de integridad

- Un `Booking` no puede existir sin `Contract` válido **salvo** que el Venue permita reserva con deuda (flag).
- `creditsUsed <= creditsTotal` — validado en la **misma** operación atómica que crea la Booking (nunca en dos pasos):
```js
const contract = await Contract.findOneAndUpdate(
  { _id, tenantId, status: 'active', endsAt: { $gt: now },
    $expr: { $lt: ['$creditsUsed', '$creditsTotal'] } },
  { $inc: { creditsUsed: 1 } }, { new: true }
);
if (!contract) throw new AppError('LP-CTRT-402-001');
```
- Si la creación de la Booking falla después de descontar el crédito, se compensa con `$inc: -1` (o se usa transacción de Mongo, disponible en Atlas).
- `bookedCount <= capacity` — garantizado por el `findOneAndUpdate` con `$expr` (§2.1.5.e).
- Cancelar una `ClassSession` cancela todas sus `Booking` y devuelve créditos en la misma transacción (Mongo Atlas = replica set, `session.withTransaction` disponible).
- Nunca borrar un `Payment`: se anula con `Refund`.

## 6. Requisitos no funcionales

### STACK

- React
- Node
- TypeScript
- Mongo DB
- Better Auth (authenticacion)
- Zod (Validaciones)
- Temporal (Fechas)
- Tanstack (Table, Form, Charts, Query, Router and others)
- Motion (animaciones)
- Fontsource (fuentes)
- Zustand (estado global)
- pragmatic-drag-and-drop (drag and drop)
- Nuqs (estados en url)
- Swagger (api doc)

#### `[+]` Adiciones al stack

| Necesidad | Propuesta | Motivo |
|---|---|---|
| Framework backend | **Hono** o **Fastify** | Ya usados en el ecosistema BV; Hono si se quiere edge-ready |
| ODM | **Mongoose 8** | Ya validado en ArcherLog; schemas + hooks para `tenantId` |
| Monorepo | **pnpm workspaces + Turborepo** | 4 apps + packages compartidos (`ui`, `schemas`, `types`, `config`) |
| Cola de jobs | **BullMQ + Redis** o cron simple de Railway | Notificaciones, vencimientos, métricas, waitlist |
| Emails | Resend / Postmark | Transaccionales con plantillas |
| Push | Web Push API (VAPID) | Nativo, sin dependencia de tercero |
| WhatsApp | Proveedor con API oficial | Canal dominante en AR |
| Pagos | **Mercado Pago SDK** | Suscripciones (`preapproval`) + Checkout Pro |
| Logs | **Pino** (JSON estructurado) | Formato único, barato |
| Errores | **Sentry** | Agrupación y stack traces del front |
| Tests | **Vitest** + **Playwright** + **MSW** + **mongodb-memory-server** | Unit / e2e / mocks / integración real |
| Estilos | **Tailwind v4** | Consistente con el ecosistema BV |
| Fechas | `@js-temporal/polyfill` | Temporal aún no está en todos los runtimes |
| Feature flags | tabla propia + cache | Entitlements por plan |
| CI/CD | GitHub Actions | Lint + types + tests + build por PR |

> 👀 **Sobre Zustand + Tanstack Query juntos:** definir la frontera de una vez. Query = estado del servidor. Zustand = estado de UI (sidebar, modales, filtros no urleables). Nuqs = filtros que sí van en URL. Si se duplica estado del servidor en Zustand aparecen bugs de sincronización imposibles de rastrear.

### Arquitectura

- SDD (Spec-Driven Development)
- TDD
- Modular
- APIs REST
- Atomic Design
- Componentes Cross (libreria de componentes UI)

#### `[+]` Precisiones de arquitectura

- **Modular monolith + hexagonal-lite**: un solo deployable de backend con módulos aislados (`modules/booking`, `modules/billing`…), cada uno con `domain / application / infrastructure`. Nada de microservicios con un solo dev.
- **Regla de dependencia**: los módulos se comunican por interfaces o eventos internos, nunca importando modelos de otro módulo directamente. Es lo que permite extraer un módulo el día que haga falta.
- **Eventos de dominio** (in-process, en cola después): `booking.created`, `booking.cancelled`, `attendance.checked_in`, `payment.received`, `contract.expiring`, `pr.achieved`. Notificaciones y métricas se suscriben; no se acoplan al flujo principal.
- **Package `@laplace/schemas`**: Zod compartido front/back = fuente única de verdad de validaciones y tipos (`z.infer`).
- **Package `@laplace/ui`**: librería de componentes cross (los "Componentes Cross" de la v1), con Storybook.
- **Atomic Design**: aplicarlo con criterio. La discusión "¿esto es molécula u organismo?" no aporta valor; lo que aporta es que `@laplace/ui` no importe lógica de negocio.
- **API REST versionada** + OpenAPI generado desde los schemas Zod (no escrito a mano, se desactualiza siempre).

### Buenas Practicas

- SOLID
- DRY
- Patrones de diseño
- Logs

#### `[+]` Adiciones
- **YAGNI** por encima de todo, dado el tamaño del equipo. DRY mal aplicado a las 2 semanas de proyecto genera abstracciones equivocadas: preferir duplicar dos veces antes de abstraer.
- Conventional commits + PRs pequeñas + changelog automático.
- ADRs (Architecture Decision Records) cortos para cada decisión estructural: contexto, opciones, decisión, consecuencias.
- Sin `any`. `strict: true` en TS.
- Sin lógica de negocio en componentes React.

### Buenas Practicas con IA

- AI Fluency Framework.
- Claude code best practice for Vibe Coding.

#### `[+]` Operativa concreta con IA
- **CLAUDE.md por app y en la raíz**: stack, convenciones, comandos, estructura, cosas prohibidas.
- **Flujo 4D (AI Fluency)** por tarea: *Delegation* (qué hace la IA y qué no) → *Description* (spec de la tarea con criterios de aceptación) → *Discernment* (revisar salida contra los criterios) → *Diligence* (tests, seguridad, atribución).
- **La spec manda**: si la IA propone algo fuera de spec, primero se actualiza la spec, después se codea. Es literalmente el requisito de la v1 en §3.
- Tests escritos (o revisados) por humano en los flujos de dinero, reservas y permisos. Ahí no aplica autopiloto.
- Subagentes por rol: `spec-reviewer`, `test-writer`, `security-reviewer`.

### Testing

- TDD
- Test estaticos (linters)
- Test unitarios
- Test e2e
- Coverage mayor al 90%

#### `[~]` Revisión de la estrategia de testing

> 👀 **90% global es una trampa.** Con un dev, perseguir 90% en todo el código lleva a escribir tests triviales de getters para levantar el número mientras la lógica de reserva concurrente queda sin cubrir. La cobertura es un indicador, no un objetivo.

**Propuesta por criticidad:**

| Zona | Cobertura mínima | Tipo de test |
|---|---|---|
| Billing, Contracts, Booking, Entitlements, Auth/permisos | **95%** | Unit + integración con DB real (mongodb-memory-server) |
| Attendance, Results, RMs, Planning | 85% | Unit + integración |
| Notifications, Metrics, CRM, Feedback | 70% | Unit |
| UI genérica, landing | 50% | Componentes clave + visual |
| **Global** | **≥ 80%** con quality gate en CI | — |

**Tests obligatorios y no negociables:**
1. **Aislamiento de tenant**: para cada endpoint, el tenant A no puede leer ni escribir recursos del tenant B (test parametrizado sobre todas las rutas).
2. **Concurrencia de reserva**: N pedidos simultáneos sobre 1 cupo → exactamente 1 booking, el resto a waitlist.
3. **Idempotencia de webhooks**: el mismo evento 3 veces → 1 solo pago registrado.
4. **Enforcement de límites de plan**: crear el miembro 61 en Basic falla con el código correcto.
5. **Consumo de créditos**: reserva → descuenta · cancel dentro de plazo → devuelve · late cancel y no-show → no devuelve · clase cancelada por el centro → devuelve · walk-in → descuenta en check-in · freeze → devuelve las futuras.
6. **Cálculo de vencimientos cruzando TZ y DST.**
7. **E2E de los 3 caminos críticos**: alta de suscriptor→primera clase publicada · miembro compra pack y reserva · coach toma asistencia y carga resultados.

> 👀 Se debe arrancar cada módulo generando primero los tests (aislamiento, concurrencia, idempotencia) contra una API que todavía no existe. Los tests se vuelven la spec ejecutable y la IA no puede desviarse del contrato.

### UX/UI

- UI guideline (https://www.uiguideline.com/)
- Generar una imagen propia de la marca
- Respetar componentes y paletas de colores en todas las aplicacions
- Mobile First
- Accesibilidad
- Tema dark/light (dark first)

#### `[+]` Precisiones UX/UI
- **Accesibilidad = WCAG 2.2 nivel AA** como objetivo declarado y verificable: contraste ≥ 4.5:1, foco visible, navegación completa por teclado, labels y `aria-*` correctos, `prefers-reduced-motion` respetado en todas las animaciones de Motion, targets táctiles ≥ 44×44 px. Auditoría con axe en CI.
- **DnD accesible**: alternativa por teclado obligatoria en el Planning.
- **Estados vacíos con acción** ("Todavía no tenés clases → Crear la primera"): son el 80% del onboarding percibido.
- **Skeletons**, no spinners, en listas.
- **Confirmación destructiva** con nombre del recurso escrito, para borrados irreversibles.
- **Optimistic UI** en reservar/cancelar, con rollback y mensaje claro si falla.
- Densidad alta en DFSM (herramienta de trabajo) vs. densidad baja en WAFM (uso ocasional, de pie, con una mano).
- Formato de fecha/hora/moneda es-AR; primer día de la semana lunes.
- Tipografía: escala fluida; mínimo 16 px en inputs (evita el zoom automático de iOS).

### Infra

- Railway
- Mongo Atlas
- Backblaze

#### `[+]` Precisiones de infra
- **Ambientes**: `dev` (local) · `staging` (datos sintéticos) · `prod`. Prohibido probar en prod.
- **Mongo Atlas**: replica set (necesario para transacciones), backups automáticos con **PITR**, alertas de conexión y de storage. Definir **RPO ≤ 24 h y RTO ≤ 4 h** y **probar la restauración** al menos una vez (un backup sin restore probado no es un backup).
- **Backblaze B2**: buckets privados + URLs firmadas de corta vida, límites de tamaño, CDN por delante para media de ejercicios.
- **Secrets** en el gestor de la plataforma, nunca en el repo. Rotación documentada.
- **Migraciones de esquema** versionadas y reversibles (`migrate-mongo` o equivalente); nunca cambios manuales en Atlas.
- **Health checks** `/health` (liveness) y `/ready` (readiness con ping a Mongo).
- Uptime monitoring externo con alerta a WhatsApp/Telegram.
- Plan de escala: Railway alcanza para las primeras decenas de tenants; el disparador para migrar a VPS/Coolify es costo o límites de recursos, no estética.

## 7. Ejemplo de productos similares

- SigueFIT (https://www.siguefit.com/)

### `[+]` 7.1 Benchmark ampliado

**Argentina / LATAM (competencia directa):**
- SigueFIT — https://www.siguefit.com/ (pilates, gimnasios, multiactividad; app cliente con QR)
- BoxMagic — gestión + finanzas, Mercado Pago
- CrossHero — WODs y pizarras de resultados
- Fitco — boutique, marketing y retención
- SocioPLUS / XCORE — molinetes, biometría, AFIP
- GymGestión / GymSmartAccess — cobro en pesos, WhatsApp, morosidad

**Global (referencia de producto):**
- Wodify · SugarWOD · PushPress · Zen Planner · Beyond the Whiteboard · TeamUp · Gymdesk · Mindbody · Glofox · Virtuagym · Momence · Arketa

**Qué copiar de cada uno:**
| Referencia | Qué robar |
|---|---|
| SugarWOD | Whiteboard digital, PR automático, feed social del box |
| Wodify | Profundidad de performance tracking y KPIs de negocio en el mismo lugar |
| BTWB | Analítica por movimiento y librería de benchmarks |
| PushPress | Simplicidad del check-in y onboarding |
| SigueFIT | Agenda día/semana/mes, vista horizontal multi-sala, QR de acceso |
| GymGestión | Estados de mora, débito automático, recordatorios por WhatsApp |
| TeamUp | Claridad absoluta en las reglas de reserva y cancelación |

---

## `[+]` 8. Multi-tenancy y aislamiento de datos

**Modelo elegido:** base de datos única, colecciones compartidas, discriminador `tenantId`. (Coherente con lo ya definido: sin schema-per-tenant.)

**Reglas no negociables:**
1. **Todo query pasa por un repositorio que inyecta `tenantId`.** Prohibido usar el modelo de Mongoose directamente en un controller.
2. Middleware de contexto: resuelve `tenantId` desde la sesión (nunca desde el body o la query del cliente).
3. Plugin de Mongoose que agrega `tenantId` en `pre('save')` y en todos los `find*`, como red de seguridad de segundo nivel.
4. `tenantId` **primero** en todo índice compuesto.
5. Suite de tests de aislamiento automática sobre todas las rutas (§Testing).
6. Recursos globales (`Exercise` scope `global`, `Benchmark`, `LegalDocument`) son de solo lectura para tenants.
7. **El `AthleteProfile` no es del tenant**: pertenece al usuario, y se comparte con cada centro por consentimiento explícito y revocable.
8. Log y métricas siempre etiquetados con `tenantId` para poder depurar por cliente.
9. Exportación y eliminación total de datos de un tenant como operación soportada (portabilidad y baja).

## `[+]` 9. Seguridad, privacidad y cumplimiento legal

### 9.1 Seguridad de aplicación
- OWASP Top 10 como checklist de revisión por módulo.
- **Autorización en cada endpoint** (recurso + acción + tenant). Los ataques reales acá son **IDOR**: cambiar un ID en la URL. Test obligatorio.
- Rate limiting: login (5/min/IP), registro, recupero, reservas (evitar bots que copan cupos), webhooks.
- Validación de entrada con Zod en el borde; sanitización de HTML en notas y descripciones.
- Prevención de NoSQL injection (nunca pasar objetos del usuario directo a `find`).
- Headers: CSP, HSTS, X-Content-Type-Options, Referrer-Policy. CORS restrictivo por origen.
- Subida de archivos: mime real, tamaño máximo, nombre aleatorio, sin ejecución.
- Dependencias: `npm audit` + Dependabot en CI.
- **Nunca** datos de tarjeta en la base. Nunca secretos en el front.
- Contraseñas: hashing gestionado por Better Auth; política mínima + verificación contra listas de filtradas.

### 9.2 Cumplimiento — Ley 25.326 (Argentina)
Aplicable porque se tratan datos personales y **datos sensibles de salud**:
- **Consentimiento expreso e informado** para datos de salud, previo a la recolección, con finalidad declarada (Arts. 6, 7 y 11).
- **Nadie puede ser obligado** a dar datos sensibles → el módulo Health debe ser 100% opcional.
- **Medidas técnicas y organizativas de seguridad** (Art. 9) — cifrado, control de acceso, registro de accesos.
- **Deber de secreto** de todos los intervinientes (Art. 10), incluido el proveedor de software.
- **Cesión con consentimiento previo y revocable** (Art. 11) → aplica al compartir el perfil del atleta entre centros.
- **Transferencia internacional** restringida a países con nivel adecuado (Art. 12) → relevante si Atlas/Backblaze alojan fuera; documentar región y encuadre.
- **Derechos ARCO**: acceso, rectificación, actualización y supresión, con flujo autoservicio en la app.
- **Rol dual**: el centro es responsable del tratamiento; Laplace es encargado. Hace falta un **acuerdo de tratamiento de datos** en los términos del SaaS. Ambos responden solidariamente ante la cesión.
- Registro de bases de datos ante la AAIP: evaluar con asesoramiento legal.

### 9.3 Documentos legales requeridos
Términos y condiciones del SaaS · Política de privacidad · Acuerdo de tratamiento de datos (Laplace ↔ centro) · Deslinde de responsabilidad para miembros · Consentimiento de datos de salud · Consentimiento de uso de imagen · Consentimiento de tutor para menores. Todos versionados en `LegalDocument`.

## `[+]` 10. Jobs, colas y procesos automáticos

| Job | Frecuencia | Descripción |
|---|---|---|
| `materializeSessions` | Diario | Materializa ClassSessions futuras desde las plantillas (ventana de 60 días) |
| `promoteWaitlist` | Evento + cada 5 min | Promueve desde lista de espera y notifica |
| `expireWaitlistHolds` | Cada minuto | Libera confirmaciones vencidas |
| `markNoShows` | Cada hora | Marca no-show las reservas sin check-in pasada la ventana y aplica política |
| `expireContracts` | Diario | Expira contratos vencidos y libera reservas futuras |
| `notifyExpiring` | Diario | Avisa packs por vencer (7/3/1 días) con CTA de renovación |
| `classReminders` | Cada 15 min | Recordatorio 24 h y 1 h antes de clase |
| `dunning` | Diario | Reintentos de cobro y avisos de mora (miembros y suscriptores) |
| `reconcilePayments` | Diario | Conciliación con Mercado Pago |
| `computeMetricsDaily` | Diario 03:00 | Precalcula KPIs por tenant y venue |
| `churnRiskScan` | Diario | Detecta miembros sin asistir hace 14 días |
| `medicalClearanceCheck` | Diario | Alerta de aptos médicos vencidos |
| `dataRetentionPurge` | Semanal | Purga datos vencidos según política |
| `backupVerify` | Semanal | Verifica que el último backup restaure |

**Requisitos:** idempotentes, reintentables, con lock para evitar ejecución doble, con log de inicio/fin/duración y alerta ante fallo.

## `[+]` 11. Observabilidad, logs y códigos de error

### 11.1 Formato de log (JSON, Pino)
```json
{
  "ts": "2026-08-31T14:03:11.412Z",
  "level": "error",
  "env": "prod",
  "service": "api",
  "module": "booking",
  "action": "createBooking",
  "requestId": "01J9X7K2...",
  "tenantId": "org_123",
  "venueId": "ven_45",
  "userId": "usr_789",
  "durationMs": 42,
  "errorCode": "LP-BOOK-409-002",
  "msg": "Session at capacity",
  "meta": { "sessionId": "ses_9", "capacity": 12 }
}
```
**Reglas:** nunca loguear passwords, tokens, datos de salud ni datos de tarjeta. `requestId` viaja del front al back y vuelve al usuario en el mensaje de error.

### 11.2 Diccionario de códigos de error
**Formato:** `LP-<MODULE>-<HTTP>-<NNN>`

| Módulo | Código |
|---|---|
| AUTH · ACCT · SUBS · SUSC · SCHD · BOOK · ATTD · MEMB · PROD · CTRT · BILL · TRNG · PLAN · RSLT · RM · HLTH · NOTF · FDBK · ENTL · CRM · SYS |

**Semilla del diccionario:**
| Código | HTTP | Significado | Mensaje al usuario |
|---|---|---|---|
| `LP-AUTH-401-001` | 401 | Credenciales inválidas | Email o contraseña incorrectos. |
| `LP-AUTH-403-002` | 403 | Sin permiso sobre el recurso | No tenés permisos para esta acción. |
| `LP-AUTH-429-003` | 429 | Demasiados intentos | Demasiados intentos. Probá en 5 minutos. |
| `LP-BOOK-409-001` | 409 | Ya reservado | Ya tenés una reserva en esta clase. |
| `LP-BOOK-409-002` | 409 | Clase completa | La clase está completa. Podés sumarte a la lista de espera. |
| `LP-BOOK-422-003` | 422 | Fuera de la ventana de reserva | Todavía no se puede reservar esta clase. |
| `LP-BOOK-422-004` | 422 | Cancelación fuera de término | Pasó el plazo de cancelación; se descuenta el crédito. |
| `LP-CTRT-402-001` | 402 | Sin créditos disponibles | No te quedan clases en tu pack. |
| `LP-CTRT-402-002` | 402 | Contrato vencido | Tu pack venció el {fecha}. |
| `LP-CTRT-422-003` | 422 | Categoría no habilitada | Tu pack no incluye esta actividad. |
| `LP-BILL-402-001` | 402 | Pago rechazado | El pago fue rechazado por el emisor. |
| `LP-BILL-409-002` | 409 | Pago duplicado | Este pago ya fue registrado. |
| `LP-ENTL-403-001` | 403 | Límite de plan alcanzado | Alcanzaste el máximo de {limite} de tu plan {plan}. |
| `LP-HLTH-403-001` | 403 | Sin consentimiento | Necesitás aceptar el consentimiento para usar esta sección. |
| `LP-SYS-500-001` | 500 | Error no controlado | Ocurrió un error. Compartí el código {code} con soporte. |

### 11.3 Observabilidad
- Métricas: throughput, p50/p95/p99, tasa de error por código, jobs fallidos, latencia de Mongo, webhooks pendientes.
- Alertas: 5xx > 1% en 5 min · job fallido · webhook sin procesar > 15 min · uptime.
- Trazas con `requestId` de punta a punta.
- **Dashboard de soporte en el DFSA**: buscar por `requestId` o `errorCode` y ver qué pasó. Esto es exactamente lo que la v1 pide al decir que el usuario comparta el código de error con el super admin.

## `[+]` 12. Roadmap por fases

> 👀 **Realidad de alcance:** 22 módulos × 4 aplicaciones × TDD, con un dev, es un proyecto de años si se hace en paralelo. La única forma de llegar a producción es cortar por valor. El orden de abajo prioriza *lo que hace que un centro pague*.

**Fase 0 — Fundaciones (bloqueante de todo)**
- [ ] Monorepo, CI, linting, tipos estrictos
- [ ] Better Auth + organization plugin + RBAC + guards de tenant
- [ ] Contexto de tenant, repositorios, plugin de Mongoose
- [ ] Logger, códigos de error, manejo global de errores
- [ ] `@laplace/schemas` + `@laplace/ui` base + tema dark/light
- [ ] Deploy staging + health checks + backups verificados

**Fase 1 — MVP vendible** *(objetivo: un box real operando y pagando)*
- [ ] Venues + Rooms
- [ ] Members (alta, ficha, invitación, CSV)
- [ ] Products + Contracts (pack y membresía mensual)
- [ ] Billing con pagos manuales, estado de cuenta y mora
- [ ] Schedule: plantillas, sesiones, capacidad, reserva atómica, waitlist, cutoff
- [ ] Attendance: check-in manual + QR
- [ ] Waivers básicos
- [ ] WAFM: ver horario, reservar, cancelar, mis packs, mi QR
- [ ] Notificaciones in-app + email transaccional
- [ ] Métricas básicas + panel de alertas del día
- [ ] Entitlements + planes
- [ ] Landing con trial

**Fase 2 — Diferenciación**
- [ ] Mercado Pago (pago único + suscripción + webhooks + conciliación)
- [ ] Training: librería con tags, media y escalados
- [ ] Planning con bloques, DnD, publicación programada y analítica en vivo
- [ ] Results / Whiteboard + leaderboard + PRs
- [ ] Web Push + WhatsApp
- [ ] Métricas avanzadas (churn, LTV, cohortes, utilización)
- [ ] Feedback

**Fase 3 — Profundidad**
- [ ] RMs + % de carga + integración con Planning
- [ ] Health + consentimientos + cifrado + alertas al coach
- [ ] Multi-Venue completo y roles por sede
- [ ] Benchmarks nombrados e histórico
- [ ] Modo TV / whiteboard

**Fase 4 — Escala**
- [ ] CRM / Leads
- [ ] Marca propia por centro en la WAFM
- [ ] Reportes exportables y API pública
- [ ] Facturación AFIP (evaluar)
- [ ] Integración con hardware de acceso

**Regla de corte:** ninguna fase arranca sin que la anterior esté en producción con un cliente real usándola.

## `[+]` 13. Riesgos y decisiones abiertas

### 13.1 Riesgos
| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| Alcance excesivo para 1 dev | Alta | Alto | Fases del §12; corte duro del MVP |
| Sin cobro a miembros no se vende | Alta | Crítico | Billing en Fase 1 |
| Fuga de datos entre tenants | Media | Crítico | §8 + tests automáticos de aislamiento |
| Datos de salud sin consentimiento | Media | Crítico legal | §9.2 + Health a Fase 3 |
| Race condition en reservas | Alta | Alto | Update atómico + índice único + test de carga |
| Rechazo del popup bloqueante de update | Media | Medio | Escape a los 30 s |
| Costo de infra al crecer | Media | Medio | Métricas de costo por tenant desde el día 1 |
| Competidores con más recursos | Alta | Medio | Nicho: precio en ARS + multi-disciplina + profundidad de entrenamiento |
| Dependencia de Mercado Pago | Media | Alto | Capa de abstracción `PaymentProvider` |
| Burnout del único dev | Media | Crítico | Fases cortas, releases chicos, no perseguir el 90% de coverage |

### 13.2 👉 Decisiones abiertas (requieren definición antes de codear)
1. ✅ **DECIDIDO — El tenant es la `Organization` (el suscriptor).** El `tenantId` de todo el sistema es el `organizationId`. El `venueId` es un discriminador secundario para alcance de staff, métricas y caja, nunca la frontera de aislamiento. Consecuencias: índices compuestos siempre `{ tenantId, venueId, ... }`; el límite del plan cuenta Venues dentro de la Organization; un cambio de sede no migra datos.
2. **¿Puede un miembro reservar con deuda?** Propuesta: configurable por Venue, default *no*.
3. ✅ **DECIDIDO — Se descuenta al reservar.** Ver la tabla completa de reglas derivadas en §2.1.9.
4. ✅ **DECIDIDO — Solo suscripción mensual. Sin comisión por transacción.** Consecuencias técnicas:
   - **No se usa** el modelo marketplace con split de pagos de Mercado Pago.
   - Cada centro conecta **su propia cuenta de Mercado Pago** vía OAuth; Laplace guarda el `providerAccountId` y el token del centro (cifrado), nunca sus credenciales en claro.
   - **El dinero de los miembros nunca pasa por una cuenta de Laplace** → no hay rol de agregador de pagos ni el encuadre fiscal/PSP que eso implica.
   - Laplace solo cobra su propia suscripción, con su cuenta propia (§2.1.4).
   - Si en el futuro se quisiera comisionar, requiere rehacer la integración: modelarlo ahora sería trabajo especulativo.
5. **¿Trial del SaaS con o sin tarjeta?** Propuesta: sin tarjeta, 14 días.
6. **¿Precio en ARS con ajuste periódico o indexado a USD?** Es la principal queja contra los competidores; hay ventaja competitiva en decidirlo bien.
7. **¿El SAU puede ver datos de miembros de un centro?** Propuesta: no, salvo impersonación auditada y con aviso.
8. **¿La WAFM permite comprar packs online en Fase 1 o solo el staff vende?**
9. **¿Nombre comercial definitivo?** "Laplace" es el nombre clave del proyecto — verificar disponibilidad de dominio y marca antes de invertir en identidad visual.
10. **¿Cuántos días de retención de datos tras la baja de un suscriptor?** Propuesta: 90 días con export disponible, luego purga.

## `[+]` 14. Glosario de estados

```
Organization : trial | active | past_due | suspended | cancelled | blocked
Member       : lead | trial | active | at_risk | inactive | archived   (+flags: debtor, suspended)
Contract     : pending_payment | active | frozen | expired | exhausted | cancelled
Booking      : booked | waitlisted | checked_in | cancelled | late_cancelled | no_show
ClassSession : draft | scheduled | in_progress | completed | cancelled
Payment      : pending | approved | rejected | refunded | chargeback
Charge       : pending | paid | overdue | void
Lead         : new | contacted | trial_scheduled | trial_attended | converted | lost
Planning     : draft | scheduled | published | archived
```
Regla: los estados se cambian **solo** mediante transiciones explícitas y validadas (máquina de estados), nunca con un `update` libre del campo.

## `[+]` 15. Criterios de aceptación transversales (DoR / DoD)

**Definition of Ready** — una tarea puede empezar si tiene:
- [ ] Título, descripción y módulo
- [ ] Criterios de aceptación verificables (Given/When/Then)
- [ ] Ejemplo concreto de uso
- [ ] Story points y dependencias declaradas
- [ ] Impacto en el modelo de datos identificado
- [ ] Códigos de error nuevos definidos

**Definition of Done** — una tarea está terminada si:
- [ ] Cumple todos los criterios de aceptación
- [ ] Tests unitarios y de integración pasando; cobertura según criticidad
- [ ] Validación Zod compartida front/back
- [ ] `tenantId` respetado y test de aislamiento incluido
- [ ] Errores tipados con código y mensaje asertivo al usuario
- [ ] Logs estructurados en las rutas críticas
- [ ] Estados vacíos, de carga y de error implementados
- [ ] Accesible: teclado, foco, contraste, labels
- [ ] Responsive verificado (360 px / 768 px / 1440 px)
- [ ] Dark y light verificados
- [ ] Documentación y OpenAPI actualizados
- [ ] Entrada en la bitácora con commit/PR y tarjeta de Trello
- [ ] Sin `any`, sin `console.log`, sin TODOs sueltos
- [ ] Desplegado en staging y probado a mano

---

*Fin de la spec v2.0 — documento vivo. Cada cambio debe registrarse en la bitácora del proyecto.*

# Diccionario de códigos de error

**Formato:** `LP-<MODULE>-<HTTP>-<NNN>`

- `MODULE`: prefijo de 2 a 4 letras mayúsculas del módulo (tabla de abajo). `RM` es el más corto.
- `HTTP`: status HTTP con el que se responde.
- `NNN`: correlativo de 3 dígitos, **por módulo**, que nunca se reutiliza.

Este archivo crece por módulo. **Definir los códigos nuevos es parte del Definition of Ready**
(spec §15): una tarea no arranca sin sus códigos declarados acá.

## Respuesta de error unificada (todas las APIs)

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

Reglas:

- Todo error mostrado al usuario incluye el `code` y el `requestId`, para que pueda compartirlos
  con soporte (dashboard de búsqueda por `requestId` / `errorCode` en el DFSA).
- `message` es asertivo y en español (es-AR). `action` dice qué puede hacer el usuario.
- El log del error incluye el mismo `errorCode` y el mismo `requestId`.
- Un `catch` que solo loguea sin código tipado **no cumple el DoD**.

## Prefijos de módulo

| Prefijo | Módulo                 | Prefijo | Módulo                  |
| ------- | ---------------------- | ------- | ----------------------- |
| `AUTH`  | Autenticación          | `TRNG`  | Training                |
| `ACCT`  | Account                | `PLAN`  | Planning                |
| `SUBS`  | Suscripciones del SaaS | `RSLT`  | Results                 |
| `SUSC`  | Suscriptores           | `RM`    | RMs                     |
| `SCHD`  | Schedule               | `HLTH`  | Health                  |
| `BOOK`  | Booking                | `NOTF`  | Notifications           |
| `ATTD`  | Attendance             | `FDBK`  | Feedback                |
| `MEMB`  | Members                | `ENTL`  | Entitlements            |
| `PROD`  | Products               | `CRM`   | CRM                     |
| `CTRT`  | Contracts              | `SYS`   | Sistema / no controlado |
| `BILL`  | Billing                |         |                         |

## Diccionario

El `NNN` es correlativo **por módulo** y **nunca se reutiliza**, aunque cambie el HTTP: si `SYS`
ya usó el `002`, el próximo código de `SYS` es el `003`. Antes de agregar uno, mirá el último de su
módulo.

Los códigos de abajo cubren la semilla de la spec §11.2 más todos los declarados por el plan de
acción para Fase 0 y Fase 1 (`docs/ACTION-PLAN.md`). Los de Fases 2 a 4 se declaran cuando la fase
se abre.

### AUTH — Autenticación y autorización

| Código            | HTTP | Significado                    | Mensaje al usuario                                            |
| ----------------- | ---- | ------------------------------ | ------------------------------------------------------------- |
| `LP-AUTH-401-001` | 401  | Credenciales inválidas         | Email o contraseña incorrectos.                               |
| `LP-AUTH-403-002` | 403  | Sin permiso sobre el recurso   | No tenés permisos para esta acción.                           |
| `LP-AUTH-429-003` | 429  | Demasiados intentos            | Demasiados intentos. Probá en 5 minutos.                      |
| `LP-AUTH-403-004` | 403  | Email sin verificar            | Verificá tu email antes de continuar.                         |
| `LP-AUTH-401-005` | 401  | Sesión inválida o vencida      | Tu sesión expiró. Entrá de nuevo.                             |
| `LP-AUTH-403-006` | 403  | Cuenta bloqueada temporalmente | La cuenta está bloqueada hasta las {hora} por seguridad.      |
| `LP-AUTH-403-007` | 403  | Segundo factor requerido       | Configurá la verificación en dos pasos para entrar.           |
| `LP-AUTH-401-008` | 401  | Código de 2FA inválido         | El código no es correcto o ya venció.                         |
| `LP-AUTH-409-009` | 409  | Email ya registrado            | Ese email ya tiene una cuenta. Probá recuperar la contraseña. |
| `LP-AUTH-422-010` | 422  | Enlace inválido o vencido      | Este enlace ya se usó o venció. Pedí uno nuevo.               |
| `LP-AUTH-403-011` | 403  | Sesión sin organización activa | Elegí un centro para continuar.                               |

> El `422-010` cubre tanto el enlace de verificación de email (F0-01) como el magic link (F0-03):
> para quien recibe el error son el mismo problema y la misma salida.
>
> El `401-001` **nunca** revela si el email existe: la respuesta es idéntica para email inexistente
> y para contraseña incorrecta. Lo mismo vale para el `429-003`.

### ACCT — Cuenta y perfil

| Código            | HTTP | Significado                  | Mensaje al usuario                                   |
| ----------------- | ---- | ---------------------------- | ---------------------------------------------------- |
| `LP-ACCT-422-001` | 422  | Archivo con formato inválido | El archivo tiene que ser una imagen JPG, PNG o WebP. |
| `LP-ACCT-413-002` | 413  | Archivo demasiado grande     | La imagen supera el máximo de {limite}.              |

> El formato se valida por **mime real**, no por extensión (§2.1.2).

### SUSC — Suscriptores

| Código            | HTTP | Significado                        | Mensaje al usuario                         |
| ----------------- | ---- | ---------------------------------- | ------------------------------------------ |
| `LP-SUSC-422-001` | 422  | Transición de estado inválida      | No se puede pasar de {estado} a {destino}. |
| `LP-SUSC-409-002` | 409  | La organización ya existe          | Ya hay una cuenta con ese nombre.          |
| `LP-SUSC-403-003` | 403  | Impersonación sin motivo declarado | Indicá el motivo del acceso de soporte.    |

### SUBS — Suscripciones del SaaS

| Código            | HTTP | Significado             | Mensaje al usuario                                     |
| ----------------- | ---- | ----------------------- | ------------------------------------------------------ |
| `LP-SUBS-422-001` | 422  | Cambio de plan inválido | No se puede cambiar al plan {plan} desde {planActual}. |

### ENTL — Entitlements

| Código            | HTTP | Significado                    | Mensaje al usuario                                               |
| ----------------- | ---- | ------------------------------ | ---------------------------------------------------------------- |
| `LP-ENTL-403-001` | 403  | Límite de plan alcanzado       | Alcanzaste el máximo de {limite} de tu plan {plan}.              |
| `LP-ENTL-403-002` | 403  | Módulo no incluido en el plan  | El módulo {modulo} no está incluido en tu plan {plan}.           |
| `LP-ENTL-403-003` | 403  | Feature no incluida en el plan | Esta función está disponible desde el plan {planMinimo}.         |
| `LP-ENTL-409-004` | 409  | Downgrade bloqueado por uso    | No podés bajar a {plan}: tenés {actual} y el máximo es {limite}. |
| `LP-ENTL-500-005` | 500  | Centro sin plan asignado       | No pudimos identificar tu centro.                                |

> El `403-001` y el `409-004` siempre dicen **qué** excede y **por cuánto**. Un límite sin número
> concreto obliga al usuario a adivinar (§2.1.22).

### SCHD — Agenda y clases

| Código            | HTTP | Significado                       | Mensaje al usuario                                       |
| ----------------- | ---- | --------------------------------- | -------------------------------------------------------- |
| `LP-SCHD-422-001` | 422  | Política de reserva inconsistente | El cierre de reservas no puede ser antes de la apertura. |
| `LP-SCHD-409-002` | 409  | Sala con sesiones futuras         | La sala tiene clases programadas. Podés archivarla.      |
| `LP-SCHD-409-003` | 409  | Sala ocupada en ese horario       | Ya hay una clase en esa sala a esa hora.                 |
| `LP-SCHD-422-004` | 422  | Regla de recurrencia inválida     | La repetición de la clase no es válida.                  |
| `LP-SCHD-422-005` | 422  | La sesión ya terminó              | No se puede modificar una clase que ya pasó.             |
| `LP-SCHD-422-006` | 422  | Transición de estado inválida     | No se puede pasar de {estado} a {destino}.               |
| `LP-SCHD-422-007` | 422  | Cupo mayor al de la sala          | La sala admite {capacidad} personas.                     |
| `LP-SCHD-404-008` | 404  | La sede no existe                 | No encontramos esa sede.                                 |

### BOOK — Reservas

| Código            | HTTP | Significado                      | Mensaje al usuario                                               |
| ----------------- | ---- | -------------------------------- | ---------------------------------------------------------------- |
| `LP-BOOK-409-001` | 409  | Ya reservado                     | Ya tenés una reserva en esta clase.                              |
| `LP-BOOK-409-002` | 409  | Clase completa                   | La clase está completa. Podés sumarte a la lista de espera.      |
| `LP-BOOK-422-003` | 422  | Fuera de la ventana de reserva   | Todavía no se puede reservar esta clase (o ya se cerraron).      |
| `LP-BOOK-422-004` | 422  | Cancelación fuera de término     | Pasó el plazo: confirmá para cancelar igual y perder el crédito. |
| `LP-BOOK-403-005` | 403  | Miembro en mora                  | Tenés un pago pendiente. Regularizá para reservar.               |
| `LP-BOOK-404-006` | 404  | Clase inexistente                | No encontramos esa clase.                                        |
| `LP-BOOK-409-007` | 409  | Ya está en la lista de espera    | Ya estás en la lista de espera de esta clase.                    |
| `LP-BOOK-422-008` | 422  | Lista de espera llena            | La lista de espera está completa.                                |
| `LP-BOOK-422-009` | 422  | Confirmación de waitlist vencida | Se venció el plazo para confirmar tu lugar.                      |
| `LP-BOOK-403-010` | 403  | Bloqueado por no-shows           | Tenés las reservas bloqueadas hasta el {fecha} por ausencias.    |

> El `403-005` solo se emite cuando el Venue tiene `allowDebt: false` (ADR-004, decisión 2).

### ATTD — Asistencia y control de acceso

| Código            | HTTP | Significado                        | Mensaje al usuario                                        |
| ----------------- | ---- | ---------------------------------- | --------------------------------------------------------- |
| `LP-ATTD-409-001` | 409  | Ya tiene check-in                  | Ya registramos tu ingreso a esta clase.                   |
| `LP-ATTD-422-002` | 422  | Fuera de la ventana de check-in    | El check-in abre 30 minutos antes de la clase.            |
| `LP-ATTD-403-003` | 403  | Falta firmar un waiver obligatorio | Firmá el deslinde de responsabilidad para poder ingresar. |
| `LP-ATTD-422-004` | 422  | Token de QR inválido o vencido     | El código venció. Abrí de nuevo tu QR.                    |
| `LP-ATTD-404-005` | 404  | Reserva inexistente                | No encontramos tu reserva.                                |

### MEMB — Miembros

| Código            | HTTP | Significado                          | Mensaje al usuario                                           |
| ----------------- | ---- | ------------------------------------ | ------------------------------------------------------------ |
| `LP-MEMB-409-001` | 409  | Documento ya registrado en el centro | Ya hay un miembro con ese documento.                         |
| `LP-MEMB-422-002` | 422  | Transición de estado inválida        | No se puede pasar de {estado} a {destino}.                   |
| `LP-MEMB-404-003` | 404  | Miembro inexistente                  | No encontramos a esa persona.                                |
| `LP-MEMB-422-004` | 422  | Menor de edad sin tutor              | Cargá el tutor responsable antes de continuar.               |
| `LP-MEMB-422-005` | 422  | Código de invitación inválido        | El código no es válido, ya venció o se agotó.                |
| `LP-MEMB-422-006` | 422  | CSV con formato inválido             | El archivo no tiene el formato esperado. Revisá la fila {n}. |

> El `422-005` es deliberadamente ambiguo: no distingue entre vencido, agotado y revocado, para no
> darle información a quien prueba códigos al azar.

### PROD — Productos

| Código            | HTTP | Significado              | Mensaje al usuario                              |
| ----------------- | ---- | ------------------------ | ----------------------------------------------- |
| `LP-PROD-422-001` | 422  | Producto mal configurado | Revisá el precio, la vigencia y las categorías. |
| `LP-PROD-409-002` | 409  | Clase de prueba ya usada | Ya usaste tu clase de prueba.                   |
| `LP-PROD-404-003` | 404  | Producto inexistente     | No encontramos ese producto.                    |

### CTRT — Contratos

| Código            | HTTP | Significado                       | Mensaje al usuario                                        |
| ----------------- | ---- | --------------------------------- | --------------------------------------------------------- |
| `LP-CTRT-402-001` | 402  | Sin créditos disponibles          | No te quedan clases en tu pack.                           |
| `LP-CTRT-402-002` | 402  | Contrato vencido                  | Tu pack venció el {fecha}.                                |
| `LP-CTRT-422-003` | 422  | Categoría no habilitada           | Tu pack no incluye esta actividad.                        |
| `LP-CTRT-422-004` | 422  | Transición de estado inválida     | No se puede pasar de {estado} a {destino}.                |
| `LP-CTRT-404-005` | 404  | Contrato inexistente              | No encontramos ese pack.                                  |
| `LP-CTRT-422-006` | 422  | Máximo de días de freeze superado | Ya usaste los {limite} días de congelamiento de este año. |

### BILL — Facturación del centro a sus miembros

| Código            | HTTP | Significado              | Mensaje al usuario                                    |
| ----------------- | ---- | ------------------------ | ----------------------------------------------------- |
| `LP-BILL-402-001` | 402  | Pago rechazado           | El pago fue rechazado por el emisor.                  |
| `LP-BILL-409-002` | 409  | Pago duplicado           | Este pago ya fue registrado.                          |
| `LP-BILL-422-003` | 422  | Monto inválido           | El monto tiene que ser mayor a cero.                  |
| `LP-BILL-404-004` | 404  | Cargo o pago inexistente | No encontramos ese movimiento.                        |
| `LP-BILL-409-005` | 409  | Reembolso mayor al pago  | El reembolso no puede superar los {monto} del pago.   |
| `LP-BILL-402-006` | 402  | Miembro en mora          | Hay {monto} de deuda vencida. Regularizá para seguir. |

### HLTH — Salud, waivers y consentimientos

| Código            | HTTP | Significado                       | Mensaje al usuario                                          |
| ----------------- | ---- | --------------------------------- | ----------------------------------------------------------- |
| `LP-HLTH-403-001` | 403  | Sin consentimiento                | Necesitás aceptar el consentimiento para usar esta sección. |
| `LP-HLTH-403-002` | 403  | Documento obligatorio sin aceptar | Tenés que aceptar {documento} para continuar.               |

### NOTF — Notificaciones

| Código            | HTTP | Significado                   | Mensaje al usuario                                     |
| ----------------- | ---- | ----------------------------- | ------------------------------------------------------ |
| `LP-NOTF-500-001` | 500  | Envío fallido tras reintentos | No pudimos enviar el aviso. Lo reintentamos más tarde. |
| `LP-NOTF-422-002` | 422  | Plantilla inválida            | La plantilla tiene variables que no existen.           |

### CRM — Prospectos

| Código           | HTTP | Significado         | Mensaje al usuario               |
| ---------------- | ---- | ------------------- | -------------------------------- |
| `LP-CRM-422-001` | 422  | Formulario inválido | Revisá los datos del formulario. |

### SYS — Sistema y errores transversales

| Código           | HTTP | Significado                                    | Mensaje al usuario                                         |
| ---------------- | ---- | ---------------------------------------------- | ---------------------------------------------------------- |
| `LP-SYS-500-001` | 500  | Error no controlado                            | Ocurrió un error. Compartí el código {code} con soporte.   |
| `LP-SYS-404-002` | 404  | Recurso o ruta inexistente                     | No encontramos lo que buscabas.                            |
| `LP-SYS-500-003` | 500  | Consulta sin contexto de tenant                | Ocurrió un error. Compartí el código {code} con soporte.   |
| `LP-SYS-500-004` | 500  | Handler de evento de dominio fallido           | Ocurrió un error. Compartí el código {code} con soporte.   |
| `LP-SYS-500-005` | 500  | Job fallido                                    | Ocurrió un error. Compartí el código {code} con soporte.   |
| `LP-SYS-422-006` | 422  | Payload inválido (Zod en el borde)             | Revisá los datos: {detalle}.                               |
| `LP-SYS-409-007` | 409  | `Idempotency-Key` reutilizada con otro payload | Esta operación ya se hizo con otros datos.                 |
| `LP-SYS-400-008` | 400  | Falta el header `Idempotency-Key`              | Ocurrió un error. Compartí el código {code} con soporte.   |
| `LP-SYS-429-009` | 429  | Demasiadas peticiones                          | Estás yendo muy rápido. Probá de nuevo en un momento.      |
| `LP-SYS-503-010` | 503  | Dependencia no disponible                      | El servicio no está disponible. Probá de nuevo en un rato. |

> `LP-SYS-500-003`, `004` y `005` son **bugs, no errores de usuario**: el mensaje es genérico a
> propósito y el detalle vive en el log con su `requestId`. El `500-003` en particular significa que
> alguien consultó sin pasar por el repositorio: es una falla de aislamiento y se trata como
> incidente, no como error esperado (ADR-000).

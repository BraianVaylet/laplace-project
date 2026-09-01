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

## Semilla del diccionario

| Código            | HTTP | Significado                    | Mensaje al usuario                                          |
| ----------------- | ---- | ------------------------------ | ----------------------------------------------------------- |
| `LP-AUTH-401-001` | 401  | Credenciales inválidas         | Email o contraseña incorrectos.                             |
| `LP-AUTH-403-002` | 403  | Sin permiso sobre el recurso   | No tenés permisos para esta acción.                         |
| `LP-AUTH-429-003` | 429  | Demasiados intentos            | Demasiados intentos. Probá en 5 minutos.                    |
| `LP-BOOK-409-001` | 409  | Ya reservado                   | Ya tenés una reserva en esta clase.                         |
| `LP-BOOK-409-002` | 409  | Clase completa                 | La clase está completa. Podés sumarte a la lista de espera. |
| `LP-BOOK-422-003` | 422  | Fuera de la ventana de reserva | Todavía no se puede reservar esta clase.                    |
| `LP-BOOK-422-004` | 422  | Cancelación fuera de término   | Pasó el plazo de cancelación; se descuenta el crédito.      |
| `LP-CTRT-402-001` | 402  | Sin créditos disponibles       | No te quedan clases en tu pack.                             |
| `LP-CTRT-402-002` | 402  | Contrato vencido               | Tu pack venció el {fecha}.                                  |
| `LP-CTRT-422-003` | 422  | Categoría no habilitada        | Tu pack no incluye esta actividad.                          |
| `LP-BILL-402-001` | 402  | Pago rechazado                 | El pago fue rechazado por el emisor.                        |
| `LP-BILL-409-002` | 409  | Pago duplicado                 | Este pago ya fue registrado.                                |
| `LP-ENTL-403-001` | 403  | Límite de plan alcanzado       | Alcanzaste el máximo de {limite} de tu plan {plan}.         |
| `LP-HLTH-403-001` | 403  | Sin consentimiento             | Necesitás aceptar el consentimiento para usar esta sección. |
| `LP-SYS-500-001`  | 500  | Error no controlado            | Ocurrió un error. Compartí el código {code} con soporte.    |
| `LP-SYS-404-002`  | 404  | Recurso o ruta inexistente     | No encontramos lo que buscabas.                             |

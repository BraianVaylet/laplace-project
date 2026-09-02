# ADR-004 — Cierre de las decisiones abiertas de la spec §13.2

- **Estado:** Aceptada
- **Fecha:** 2026-09-01
- **Spec:** §13.2, §2.1.5, §2.1.3, §2.1.4, §9.2

## Contexto

La spec §13.2 lista diez decisiones; cuatro ya están cerradas en el propio documento (tenant =
Organization, crédito al reservar, solo suscripción sin comisión) y las otras quedaron con una
propuesta pero sin resolver. Seis de esas propuestas **bloquean tareas concretas de Fase 1**: sin
ellas no se puede escribir la política de reserva, el alta de suscriptor, el catálogo de productos
ni la política de retención.

Mantenerlas abiertas no las hace más seguras: hace que cada tarea las resuelva por su cuenta, de
forma distinta y sin dejar registro.

## Opciones consideradas

1. **Dejarlas abiertas** hasta tener un cliente piloto que opine. Realista para el pricing, pero
   frena seis tareas de Fase 1 que no dependen de la opinión del cliente sino de una definición.
2. **Cerrarlas con la propuesta de la spec.** Cada una ya trae un default razonado por la propia
   investigación de mercado del §0.1. Se codea contra eso y se revisa con datos reales.
3. **Cerrarlas con otro criterio.** Requiere justificar por qué la investigación previa se
   descarta; no hay evidencia nueva que lo sustente.

## Decisión

**Opción 2.** Se adoptan las propuestas de la spec, con el detalle técnico que sigue. Cada una es
revisable: la que cambie, cambia acá y en la spec, no en el código.

| §13.2 | Decisión                                           | Implementación                                                                                                                                                        |
| ----- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2     | **Reservar con deuda: no**, configurable por Venue | Flag `Venue.bookingPolicy.allowDebt` (default `false`). Si está en `false` y el miembro tiene `Charge` en `overdue`, la reserva falla con `LP-BOOK-403-005`           |
| 5     | **Trial de 14 días sin tarjeta**                   | `Organization.status = 'trial'` y `trialEndsAt = signup + 14d` en la TZ del Venue. Al vencer sin plan pago: `suspended`, datos preservados                            |
| 6     | **Precio en ARS con ajuste programado**            | `currency: 'ARS'` desde el día 1. Ajuste con `effectiveFrom` y aviso obligatorio 30 días antes. Cada suscripción guarda `priceSnapshotCents` (grandfathering)         |
| 7     | **El SAU no ve datos de miembros**                 | Los endpoints del DFSA no exponen colecciones con `tenantId`. Única excepción: impersonación con motivo obligatorio, TTL, entrada en `AuditLog` y notificación al SMU |
| 8     | **La WAFM no vende en Fase 1**                     | `Product.visibleInApp` existe desde el día 1 pero la compra self-service se habilita recién con Mercado Pago (Fase 2). En Fase 1 el contrato lo crea el staff         |
| 10    | **Retención de 90 días tras la baja**              | Al pasar a `cancelled`, export disponible durante 90 días; después, purga por el job `dataRetentionPurge`. Nunca borrar por falta de pago (§2.1.3)                    |

**Queda abierta a propósito** la decisión 9 (nombre comercial definitivo): es una decisión de
negocio y de disponibilidad de marca, y no bloquea ninguna línea de código.

## Consecuencias

- **Positivas:** seis tareas de Fase 1 pasan a cumplir el Definition of Ready (§15). Las reglas de
  reserva, el alta y la retención quedan en un solo lugar auditable.
- **Negativas:** son defaults elegidos sin dato de campo. El riesgo real está en la decisión 6
  (pricing en ARS con inflación): es la que más probablemente se revise después del piloto. Se
  mitiga con `priceSnapshotCents` y `effectiveFrom` desde el día 1, que es lo que permite cambiar
  la política sin migrar datos.
- La decisión 2 se implementa como flag por Venue, no como constante: cambiar de opinión es
  configuración, no un deploy.
- La decisión 7 obliga a que el panel de soporte del DFSA (§11.3) busque por `requestId` y
  `errorCode`, **nunca** por datos del miembro.

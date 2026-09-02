# ADR-001 — Momento de consumo de créditos y política de devolución

- **Estado:** Aceptada
- **Fecha:** 2026-08-31
- **Spec:** §2.1.9, §13.2 (decisión 3), §14

## Contexto

Un miembro compra un `Product` (pack de N clases) y obtiene un `Contract` con N `Credits`.
Hay que definir en qué momento del ciclo `booking → attendance` se descuenta el crédito. La
decisión determina el comportamiento ante cancelaciones, no-shows y clases canceladas por el
centro, y es la fuente más común de reclamos de miembros en productos de este rubro.

## Opciones consideradas

1. **Descontar al reservar.** El cupo y el crédito se comprometen juntos. Reservar sin créditos es
   imposible por construcción.
2. **Descontar al hacer check-in.** Más "justo" a primera vista, pero permite reservar sin saldo,
   copar cupos sin costo y deja al centro sin herramienta contra el no-show.

## Decisión

**Se descuenta al reservar (opción 1).** Tabla de reglas derivadas:

| Evento                                        | Efecto sobre el crédito                           |
| --------------------------------------------- | ------------------------------------------------- |
| Reserva (`booked`)                            | **Descuenta**                                     |
| Cancelación dentro del plazo (`cancelled`)    | **Devuelve**                                      |
| Cancelación fuera de plazo (`late_cancelled`) | No devuelve                                       |
| No-show (`no_show`)                           | No devuelve                                       |
| Clase cancelada por el centro                 | **Devuelve**                                      |
| Walk-in (sin reserva previa)                  | Descuenta en el check-in                          |
| Freeze del contrato (`frozen`)                | Devuelve las reservas futuras                     |
| Contrato vencido (`expired`)                  | Libera las reservas futuras, no devuelve créditos |

## Consecuencias

- El descuento y la toma de cupo ocurren en **la misma transacción atómica** (replica set de Atlas
  es un requisito, no una preferencia — ver ADR-003).
- Errores tipados asociados: `LP-CTRT-402-001` (sin créditos), `LP-CTRT-402-002` (contrato vencido),
  `LP-BOOK-422-004` (cancelación fuera de término).
- La devolución es una **transición de estado explícita**, nunca un `update` libre del contador.
- Test obligatorio de los 8 casos de la tabla + test de concurrencia: N pedidos simultáneos sobre
  1 cupo → exactamente 1 `booking`, el resto a `waitlisted`.
- La ventana de cancelación es configuración por Venue, no una constante en el código.

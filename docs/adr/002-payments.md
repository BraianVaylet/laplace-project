# ADR-002 — Modelo de pagos y encuadre frente a Mercado Pago

- **Estado:** Aceptada
- **Fecha:** 2026-08-31
- **Spec:** §2.1.4, §13.2 (decisión 4)

## Contexto

Hay dos flujos de dinero distintos y no hay que confundirlos:

1. **Laplace ↔ centro:** el centro paga su suscripción mensual al SaaS (Basic / Pro / Max).
2. **Centro ↔ miembro:** el miembro le paga packs y membresías a su centro.

El encuadre del segundo flujo define si Laplace es un agregador de pagos, con todo lo que eso
implica en materia fiscal, de PSP y de responsabilidad sobre fondos de terceros.

## Opciones consideradas

1. **Marketplace con split de pagos.** El dinero del miembro pasa por la cuenta de Laplace, que
   retiene una comisión. Ingreso variable, pero convierte a Laplace en agregador: encuadre fiscal
   y regulatorio pesado, custodia de fondos ajenos, contracargos.
2. **Solo suscripción mensual, sin comisión por transacción.** Cada centro conecta su propia cuenta
   de Mercado Pago; el dinero del miembro nunca toca una cuenta de Laplace.

## Decisión

**Opción 2: solo suscripción mensual. Sin comisión por transacción.**

- **No se usa** el modelo marketplace con split de pagos.
- Cada centro conecta **su propia cuenta de Mercado Pago** vía OAuth. Laplace guarda el
  `providerAccountId` y el token del centro **cifrado**, nunca credenciales en claro.
- El dinero de los miembros **nunca pasa por una cuenta de Laplace**.
- Laplace cobra únicamente su propia suscripción, con su cuenta propia.
- Toda la integración va detrás de una interfaz `PaymentProvider` (mitigación del riesgo de
  dependencia de un solo proveedor, §13.1).
- **Nunca** datos de tarjeta en la base. Nunca secretos de pago en el front.

## Consecuencias

- Ingreso predecible y encuadre simple: Laplace vende software, no procesa pagos de terceros.
- La Fase 1 sale con **pagos manuales** (el staff registra el cobro); Mercado Pago entra en Fase 2
  sin bloquear la venta del MVP.
- Idempotencia obligatoria en webhooks (`Idempotency-Key`): el mismo evento 3 veces → 1 solo pago
  registrado. Test obligatorio.
- Job `reconcilePayments` diario para conciliación, y alerta si hay webhooks sin procesar > 15 min.
- Errores tipados: `LP-BILL-402-001` (pago rechazado), `LP-BILL-409-002` (pago duplicado).
- **Costo de revertir:** alto. Comisionar en el futuro obliga a rehacer la integración completa.
  Se acepta explícitamente: modelarlo ahora sería trabajo especulativo (YAGNI).

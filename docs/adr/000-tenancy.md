# ADR-000 — Modelo de multi-tenancy y frontera de aislamiento

- **Estado:** Aceptada
- **Fecha:** 2026-08-31
- **Spec:** §8, §13.2 (decisión 1)

## Contexto

Laplace es un SaaS multi-tenant. Un suscriptor (`Organization`) puede tener varias sedes
(`Venue`), y cada sede varias salas (`Room`). Hace falta definir dónde está la frontera de
aislamiento de datos y cómo se garantiza técnicamente, porque una fuga entre tenants es un
riesgo crítico (§13.1) y porque la elección condiciona todos los índices de Mongo.

## Opciones consideradas

1. **Database por tenant.** Aislamiento máximo, pero con Mongo Atlas escala mal en costo y en
   operación (migraciones × N bases, límites de conexiones) para decenas de tenants y un solo dev.
2. **Colecciones compartidas con discriminador `tenantId`.** Una base, una migración, un deploy.
   El aislamiento depende de la disciplina del código.
3. **`venueId` como frontera.** Aislaría por sede, pero rompe los reportes consolidados de la
   organización y obliga a migrar datos cuando un centro abre una sucursal.

## Decisión

**Opción 2, con el tenant = `Organization`.** El `tenantId` de todo el sistema es el
`organizationId`. El `venueId` es un discriminador **secundario** para alcance de staff, métricas
y caja — nunca la frontera de aislamiento.

Reglas no negociables derivadas:

1. Todo query pasa por un repositorio que inyecta `tenantId`. **Prohibido** usar el modelo de
   Mongoose directamente en un controller.
2. El `tenantId` se resuelve en un middleware de contexto **desde la sesión**, nunca desde el body
   ni la query del cliente.
3. Plugin de Mongoose que agrega `tenantId` en `pre('save')` y en todos los `find*`, como red de
   seguridad de segundo nivel.
4. `tenantId` **primero** en todo índice compuesto: `{ tenantId, venueId, ... }`.
5. Suite de tests de aislamiento parametrizada sobre **todas** las rutas: el tenant A no puede leer
   ni escribir recursos del tenant B.
6. Recursos globales (`Exercise` scope `global`, `Benchmark`, `LegalDocument`) son de solo lectura
   para los tenants.
7. El `AthleteProfile` **no pertenece al tenant**: es del usuario, y se comparte con cada centro por
   consentimiento explícito y revocable (Ley 25.326 Art. 11).
8. Logs y métricas siempre etiquetados con `tenantId`.
9. Exportación y eliminación total de los datos de un tenant son operaciones soportadas.

## Consecuencias

- **Positivas:** una sola base, una sola migración, reportes consolidados por organización gratis.
  Abrir una sucursal no migra datos. El límite del plan cuenta Venues dentro de la Organization.
- **Negativas:** el aislamiento es responsabilidad del código, no del motor. Se compensa con las
  tres capas: repositorio → plugin de Mongoose → suite de tests obligatoria.
- Un endpoint nuevo sin test de aislamiento **no cumple el DoD** (§15).
- Si algún día un tenant grande necesita base propia, la salida es sharding por `tenantId`, que
  este modelo ya habilita.

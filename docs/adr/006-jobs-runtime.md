# ADR-006 — Ejecución de jobs: cron in-process con lock en Mongo

- **Estado:** Aceptada
- **Fecha:** 2026-09-01
- **Spec:** §10, §6 (adiciones al stack)

## Contexto

La spec §10 define catorce procesos automáticos (materializar sesiones, promover waitlist, marcar
no-shows, expirar contratos, avisos de vencimiento, recordatorios de clase, dunning, conciliación,
métricas diarias, riesgo de churn, aptos médicos, purga de retención, verificación de backup) con
un requisito claro: **idempotentes, reintentables, con lock para evitar ejecución doble, con log de
inicio/fin/duración y alerta ante fallo**.

§6 deja la implementación abierta: _"BullMQ + Redis **o** cron simple de Railway"_. Hay que
elegir, porque de eso dependen ocho tareas de Fase 1.

El contexto que manda: **un dev, Railway Hobby, sin Redis aprovisionado**. Los jobs de Fase 1
tienen frecuencia de minutos, no de milisegundos, y volumen de decenas de tenants.

## Opciones consideradas

1. **BullMQ + Redis.** Es lo correcto a escala: reintentos con backoff, colas por prioridad,
   dashboard, jobs retrasados. Cuesta un servicio más, una dependencia más de la que depende el
   arranque, y una segunda fuente de verdad operativa.
2. **Cron de Railway** (un servicio por job). Simple, pero cada job es un contenedor que arranca en
   frío, con su propia conexión a Mongo, y catorce servicios en el panel.
3. **Cron in-process con lock en Mongo.** El scheduler vive en la API. La exclusión mutua se
   resuelve con un `findOneAndUpdate` condicionado sobre una colección `JobLock` — el mismo patrón
   atómico que ya se usa para el cupo de una clase (§2.1.5.e), con TTL para que un proceso muerto
   libere el lock solo.

## Decisión

**Opción 3 para Fase 0 y Fase 1.**

- Un registro declarativo de jobs: nombre, expresión de cron, handler, timeout y TTL del lock.
- Adquisición del lock con `findOneAndUpdate` condicionado por `expiresAt`: si dos instancias de la
  API arrancan a la vez, exactamente una corre el job. Es el mismo argumento del ADR-000: la
  atomicidad la garantiza Mongo, no la disciplina del código.
- Cada corrida deja log estructurado (§11.1) con `module: 'jobs'`, `action: <job>`, `durationMs` y
  `errorCode` si falló. Un fallo emite alerta; no se traga en silencio.
- Idempotencia por diseño en cada handler: correr un job dos veces sobre el mismo día no puede
  duplicar efectos. Es requisito del handler, no del runner.
- La variable `JOBS_ENABLED` (ya presente en `.env.example`) permite apagarlos en local y en los
  tests.

**Disparador para migrar a BullMQ:** cuando aparezca alguna de estas tres — jobs que tarden más que
su intervalo, necesidad de reintentos con backoff por ítem (no por corrida), o volumen que exija
paralelizar por tenant. Es una decisión de volumen, no de estética.

## Consecuencias

- **Positivas:** cero infraestructura nueva, cero costo, un solo deployable. Los jobs se testean
  como funciones puras con `mongodb-memory-server`, sin levantar Redis en CI.
- **Negativas:** los jobs comparten proceso con la API — un job pesado compite por el event loop
  con las peticiones. Se mitiga manteniéndolos cortos y moviendo el trabajo pesado
  (`computeMetricsDaily`) a agregaciones de Mongo, que corren en el servidor de base, no en Node.
- Si la API escala a más de una instancia, el lock es lo único que evita ejecución doble: **el test
  de concurrencia del lock es obligatorio**, igual que el de reserva.
- Reiniciar la API durante un job lo corta a la mitad. Por eso todo handler debe ser idempotente y
  reanudable: la próxima corrida termina lo que quedó.

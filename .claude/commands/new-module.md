---
description: Arranca un módulo nuevo del backend con la estructura, los tests y los códigos de error que exige la spec
argument-hint: <nombre-del-modulo> (ej: booking)
---

Arrancá el módulo `$ARGUMENTS` de Laplace. **En este orden, sin saltear pasos.**

1. **Leé la spec.** Buscá `$ARGUMENTS` en `docs/spec/LAPLACE-SPEC.md` y en `docs/adr/`. Listá los
   requisitos que aplican y los estados del módulo según §14. Si algo es ambiguo, preguntá antes de
   escribir código — la spec se actualiza primero.

2. **Declará los códigos de error** del módulo en `docs/errors.md`, con su HTTP, significado y
   mensaje al usuario en español. Es parte del Definition of Ready.

3. **Escribí primero los tests** (usá el subagente `test-writer`), contra una API que todavía no
   existe. Obligatorios: aislamiento de tenant, el camino feliz, y los casos de error con su código
   exacto. Si el módulo toca cupos: concurrencia. Si toca dinero o webhooks: idempotencia.

4. **Estructura.** Creá `apps/api/src/modules/$ARGUMENTS/{domain,application,infrastructure}`:
   - `domain/`: entidades, máquina de estados, reglas de negocio puras. Sin Mongoose, sin Hono.
   - `application/`: casos de uso. Orquestan repositorios y emiten eventos de dominio.
   - `infrastructure/`: modelo de Mongoose, repositorio con inyección de `tenantId`, rutas Hono.

5. **Schemas Zod** en `packages/schemas/src/$ARGUMENTS/`. Fuente única front/back. Los tipos salen
   de `z.infer`, no se escriben a mano.

6. **Contratos hacia afuera.** El módulo se expone por interfaz o por evento de dominio. Prohibido
   importar el modelo de otro módulo.

7. Al terminar, pasá el subagente `spec-reviewer` y escribí la entrada en `docs/BITACORA.md`.

---
description: Redacta una tarea de Laplace con el formato ampliado de la spec (§5.0) y la deja lista para Trello
argument-hint: <descripción corta de la tarea>
---

Redactá la tarea: **$ARGUMENTS**

Usá el formato ampliado de la spec §5 + §5.0. Salida en Markdown, lista para pegar en Trello
(tablero Laplace).

```
title:              imperativo, en español, ≤ 70 caracteres
module:             módulo de la spec (o `infra` / `docs`)
description:        qué y para quién. En resultado observable, no en implementación.
acceptance-criteria: lista Given/When/Then, verificables. Cada una testeable por separado.
example:            un caso concreto con datos reales (nombres, números, fechas es-AR)
story-points:       Fibonacci 1/2/3/5/8/13
depends_on:         [otras tareas o módulos que deben existir antes]
risk:               low | med | high
test_plan:          qué tests la cubren y de qué tipo (unit / integración / e2e)
error-codes:        códigos nuevos `LP-<MOD>-<HTTP>-<NNN>` que introduce, o `ninguno`
data-model-impact:  colecciones o campos nuevos, migración requerida, o `ninguno`
```

Reglas:

- **Toda tarea > 8 puntos se parte** antes de empezar. Si te da 13, devolvé la partición en tareas
  de ≤ 8, no la tarea gigante.
- Antes de estimar, verificá el Definition of Ready (§15): sin criterios verificables, sin ejemplo,
  sin dependencias declaradas y sin códigos de error definidos, la tarea **no está lista**. Decilo.
- Si toca tenant, dinero, permisos o datos de salud → `risk: high` y el `test_plan` incluye
  aislamiento de tenant sí o sí.
- Chequeá contra `docs/spec/LAPLACE-SPEC.md` §12 que la tarea corresponda a la fase en curso. Si es
  de una fase posterior, decilo en vez de redactarla.

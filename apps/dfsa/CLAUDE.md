# apps/dfsa — Dashboard for Super Admin

React + Vite. **Solo desktop.** Único usuario: el Super Admin (SAU). Reglas generales en el
`CLAUDE.md` de la raíz.

## Alcance

Gestión de suscriptores y suscripciones del SaaS · ejercicios globales (`scope: global`) ·
métricas del producto · **dashboard de soporte**: buscar por `requestId` o `errorCode` y ver qué
pasó (spec §11.3).

## Particularidades

- Densidad alta: es una herramienta de trabajo, no una app de uso ocasional.
- El SAU **no** ve datos de miembros de un centro salvo impersonación auditada y con aviso
  (spec §13.2, decisión abierta 7 — confirmar antes de implementar).
- No hay `tenantId` en el contexto: el SAU opera sobre todos los tenants. Todo endpoint que consuma
  desde acá necesita su propia autorización explícita, no alcanza con "está logueado".

Puerto de dev: **5173**.

# apps/dfsm — Dashboard for Suscriptor Manager

React + Vite. Lo usan el Suscriptor Manager (SMU) y el Staff (SSU). Reglas generales en el
`CLAUDE.md` de la raíz.

## Alcance

Clases y horarios · miembros · productos y contratos · cobranza y mora · asistencia · planificación
· métricas del centro.

## Particularidades

- **Permisos por recurso + acción, no por rol fijo.** Los sub-roles (`coach`, `front_desk`,
  `head_coach`, `manager_assistant`) son presets personalizables (spec §1.1). Un `front_desk` no ve
  métricas de negocio; un `coach` sí toma asistencia.
- **Entitlements por plan**: cada feature verifica el plan contratado. El error es
  `LP-ENTL-403-001` con el límite y el plan en el mensaje.
- Alcance por `venueId` para el staff, pero el aislamiento sigue siendo por `tenantId` (ADR-000).
- Densidad alta. Estados vacíos con acción: son el 80% del onboarding percibido.

Puerto de dev: **5174**.

## Qué cambia

<!-- En resultado observable, no en descripción del diff. -->

## Tarjeta de Trello

<!-- Enlace. Si no hay tarjeta, explicar por qué. -->

## Definition of Done — spec §15

- [ ] Cumple todos los criterios de aceptación de la tarjeta
- [ ] Tests unitarios y de integración pasando, con la cobertura de su criticidad
- [ ] **Test de aislamiento de tenant incluido** (si toca datos de un tenant)
- [ ] Validación Zod compartida front/back en `@laplace/schemas`
- [ ] Errores tipados con código, registrados en `docs/errors.md`
- [ ] Logs estructurados en las rutas críticas
- [ ] Estados vacío, de carga y de error implementados
- [ ] Accesible: teclado, foco visible, contraste, labels
- [ ] Responsive verificado (360 / 768 / 1440)
- [ ] Dark y light verificados
- [ ] Documentación y OpenAPI actualizados
- [ ] Entrada en `docs/BITACORA.md` con commit/PR y tarjeta
- [ ] Sin `any`, sin `console.log`, sin TODOs sueltos
- [ ] Desplegado en staging y probado a mano

## Riesgo

- [ ] Toca dinero, permisos, tenancy o datos de salud → **requiere pasar `security-reviewer`**

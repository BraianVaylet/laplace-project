# [LAPLACE - Dashboard For King Admin] — Spec

## 1. Resumen

El DFKA (Dashboard for King Admin) es un dashboard de gestion para el proyecto Laplace, sera utilizado por el creador del proyecto desde el cual podra gestionar el negocio.

## 2. Objetivo / Éxito

- [ ] Criterio 1: Debe poder iniciar sesion dentro del Dashboard for king Admin, debe poder cambiar la contraseña en caso de olvidarla.
- [ ] Criterio 2: Debe poder gestionar las suscripciones. Cambiar el nombre de los packs, los precios y el acceso a los modulos.
- [ ] Criterio 3: Debe poder gestionar los suscriptores, dar de alta, baja y editar sus datos.
- [ ] Criterio 4: Debe poder gestionar las notificaciones, poder notificar a los suscriptores sobre determinados cambios en la plataforma.
- [ ] Criterio 5: Debe poder acceder a estadisticas, cantidad de suscriptores, ingresos, gastos, uso, etc.
- [ ] Criterio 6: Debe poder acceder a un panel de logs en caso de que algun aplicativo falle y sea un error mapeado y logueado en el codigo.

## 3. Fuera de alcance (Non-goals)

- No se debe poder acceder con mas de un usuario, el DFKA solo puede ser accesible por un unico usario, el admin.
- No debe funcionar con real-time.


## 4. Requisitos funcionales

1. Se debe poder modificar los nombres de los planes Basic, Pro y Max.
2. Se debe poder modificar los precios de los planes.
3. Se debe poder cambiar la descripcion de los planes (ej: agregar una nota de que a partir de tal fecha los precios cambiaran, o de que se trata de un precio promocional, etc).
4. Se debe poder gestionar Suscriptores por medio de un CRUD, los suscriptores deben tener los siguientes estados: Enabled, Disabled, Locked.
5. Se debe poder gestionar los pagos de los suscriptores por medio de un CRUD.
6. Se debe poder enviar notificaciones a todos los suscriptores y/o a todos los usuarios de Laplace.
7. Se debe poder acceder a estadisticas de cantidad de suscriptores en funcion del tiempo, candidad de usuarios que tienen asociado cada suscriptor, ingresos por suscripciones, etc.
8. Se debe poder ver los logs de las plataformas DFOW y WAFU siempre y cuando sean errores que fueron logueados en el codigo.
9. Se debe poder habilitar y deshabilitar determinados modulos de las aplicaciones DFOW y WAFU.
10. Bitacora propia: Debe tener una bitacora propia para la DFKA donde se registren cada uno de los cambios que se realizan. En la bitacora general se debe hacer referencia a esta cuando cambia.

## 5. Requisitos no funcionales

- STACK BASE: React, Node, TypeScipt, MongoDB.
- Autenticacion: Clerk (https://clerk.com/)
- Arquitectura: TDD, Modular, API REST, Atomic Design.
- Testing: Estaticos (eslint), unitarios, e2e, coverage mayor al 90%.
- Performance: Alta.
- Seguridad: (auth, validación de input, datos sensibles) seguir las mejores practicas.
- Compatibilidad: debe estar pensado principalmente para desktop.


## 7. Paginas/Modulos

El DFKA debe contar con las siguientes modulos

## 8. Casos borde

Qué pasa si:
- Input vacío / inválido
- Falla la red / servicio externo
- Concurrencia / condiciones de carrera
- Usuario no autorizado

## 9. Plan de implementación (opcional)

Si el trabajo es grande, dividir en pasos/fases verificables, cada uno con su propio criterio de "hecho". Claude Code puede ejecutar fase por fase.

1. Fase 1: ...
2. Fase 2: ...

## 10. Criterios de aceptación / Verificación

Cómo se comprueba que funciona. Preferir pasos ejecutables (tests, comandos, flujo manual en browser).

```bash
# comando de test/verificación
```

- [ ] Test automatizado cubre caso X
- [ ] Verificado manualmente en browser: flujo Y

## 11. Preguntas abiertas

Decisiones pendientes que el usuario debe resolver antes o durante la implementación.

- ¿...?

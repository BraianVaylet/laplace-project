# [LAPLACE - Dashboard For Suscriptor Managers] — Spec

## 1. Resumen

El DFSM (Dashboard for Suscriptor Managers) es un dashboard de gestion para los suscriptores, sera utilizado por el suscriptor que contrata el servicio y le servira para gestionar su centro deportivo.

## 2. Objetivo / Éxito

- [ ] Criterio 1: Debe poder iniciar sesion dentro del Dashboard como Admin o como Suscriptor Manager, debe poder cambiar la contraseña en caso de olvidarla via email.
- [ ] Criterio 2: Debe poder gestionar los usuarios administradores (instructores o administradores de la cuenta), dar alta, baja y modificacion de usuarios administradores.
- [ ] Criterio 3: Debe poder gestionar sus Salas (en caso de que el administrador tenga mas de un centro deportivo en el cual usar la plataforma), dar de alta, baja y editar sus salas.
- [ ] Criterio 4: Debe poder gestionar sus clientes (los usuarios), 
- [ ] Criterio 5: Debe poder acceder a estadisticas, cantidad de suscriptores, ingresos, gastos, uso, etc.
- [ ] Criterio 6: Debe poder acceder a un panel de logs en caso de que algun aplicativo falle y sea un error mapeado y logueado en el codigo.

## 3. Fuera de alcance (Non-goals)

- No se debe poder acceder con mas de un usuario, el DFSA solo puede ser accesible por un unico usario, el admin.
- No debe funcionar con real-time.


## 4. Requisitos funcionales

1. Se debe poder modificar los nombres de los planes Basic, Pro y Max.
2. Se debe poder modificar los precios de los planes.
3. Se debe poder cambiar la descripcion de los planes (ej: agregar una nota de que a partir de tal fecha los precios cambiaran, o de que se trata de un precio promocional, etc).
4. Se debe poder gestionar Suscriptores por medio de un CRUD, los suscriptores deben tener los siguientes estados: Enabled, Disabled, Locked.
5. Se debe poder gestionar los pagos de los suscriptores por medio de un CRUD.
6. Se debe poder enviar notificaciones a todos los suscriptores y/o a todos los usuarios de Laplace.
7. Se debe poder acceder a estadisticas de cantidad de suscriptores en funcion del tiempo, candidad de usuarios que tienen asociado cada suscriptor, ingresos por suscripciones, etc.
8. Se debe poder ver los logs de las plataformas DFSM y WAFM siempre y cuando sean errores que fueron logueados en el codigo.
9. Se debe poder habilitar y deshabilitar determinados modulos de las aplicaciones DFSM y WAFM.
10. Bitacora propia: Debe tener una bitacora propia para la DFSA donde se registren cada uno de los cambios que se realizan. En la bitacora general se debe hacer referencia a esta cuando cambia.

## 5. Requisitos no funcionales

- STACK BASE: React, Node, TypeScipt, MongoDB.
- Autenticacion: Clerk (https://clerk.com/)
- Arquitectura: TDD, Modular, API REST, Atomic Design.
- Testing: Estaticos (eslint), unitarios, e2e, coverage mayor al 90%.
- Performance: Alta.
- Seguridad: (auth, validación de input, datos sensibles) seguir las mejores practicas.
- Compatibilidad: debe estar pensado principalmente para desktop.


## 7. Paginas/Modulos

El DFSA debe contar con las siguientes modulos:
- Login para administrador con recuperacion de cuenta.
- Panel de navegacion lateral que permite navegar entre los diferentes modulos.
- Header con accesos, cierre de session, cambio de tema (claro/oscuro).
- Footer con informacion del proyecto.
- Modulo de Suscriptores.
- Modulo de Ingresos.
- Modulo de Planes.
- Estadisticas.

El Modulo de Suscriptores debe contar con:
- Listado de suscriptores en formato tabla
- CRUD para suscriptores (alta, baja y modificacion)

El Modulo Ingresos no se desarrolla en esta etapa.

EL Modulo Planes debe contar con:
- Informacion de cada uno de los 3 planes. Posibilidad de editarlos
- CRUD para crear nuevos planes personalizados.


## 8. Casos borde

Siempre se deben mostrar mensajes de errores representativos cuando ocurre alguna falla en el sistema, tambien en estos casos:
- Input vacío / inválido
- Falla la red / servicio externo
- Concurrencia / condiciones de carrera
- Usuario no autorizado

## 9. Plan de implementación (opcional)

Dividir el desarrollo en tareas y cargarlas sobre la plataforma trello.
Cada tarea debe contar con titulo, descripcion, ejemplos y criterios de aceptacion.


## 10. Criterios de aceptación / Verificación

Cada criterio de aceptacion debe estar testeado.
Se debe desarrollar siempre bajo TDD.
Se debe incluir test unitarios, e2e, etc. 
Se debe cumplir con un coverage de al menos el 90%.




# [LAPLACE] — Spec


## 1. Resumen

"Laplace project" es un producto para la gestion de centros de deportivos adaptable a actividades como crossfit, Funcional, Hybrid, Hyrox, Pilates, Gimnasios, etc. Cuenta con aplicativos web para su gestion y seguimiento.

### 1.1 Diccionario

#### Tipo de usuarios:
- Super Admin: Super Administrador, es el desarrollador del producto y quien los gestiona. Tiene acceso al DFSA.
- Suscriptor Manager: Es quien contrata el servicio y puede acceder a las aplicaciones y modulos contratados. Tiene acceso al DFSM.
- Suscriptor Staff: Es quien tiene acceso a determinados modulos del producto, el Suscriptor Manager es quien le otorga los permisos. Tiene acceso limitado al DFSM.
- Member: Miembro de un centro deportivo que utiliza el producto, tiene acceso a la webapp. Tiene acceso a la WAFM.

### Componentes:
- DFSA: Dashboard for Super Admin.
- DFSM: Dashboard for Suscriptor Manager.
- WAFM: Webapp for Members.
- Landing: Landing page.

#### Planes:
- Plan: Planes que pueden ser contratados.
- Basic: Plan Basico, el mas economico.
- Pro: Plan Pro, el intermedio.
- Max: Plan Max, el mas completo.

#### Terminologias:
- Laplace: Nombre clave del proyecto de gestion de centros de fitnes.
- Rooms: Salas, un Suscriptor Manager puede tener mas de un centro deportivo asociado a su cuenta.
- Centros: Centro fitnes, deportivo, o donde se realice alguna actividad deportiva.
- Packs: Los centros funcionan con packs de clases, cada pack creado cuenta con un total de clases disponibles, un vencimiento y un costo. Ej: Un centro puede crear un plack de 8 clases con vencimiento de 30 dias a un valor de 60.000 pesos Argentinos. Eso significa que el miembro que le contrate ese pack al centro tendra 30 dias para utilizarlo y solo podra anotarse desde la WAFM a 8 clases.

#### Modulos
- Auth Module: modulo de autheticacion.
- Suscriptors Module: modulo de gestion de suscriptores.
- Suscriptions Module: modulo de gestion de suscripciones.
- Schedule Module: modulo de gestion de horarios y clases.
- Rooms Module: modulo de gestion de salas.
- Members Module: modulo de gestion de miembros.
- Trainning Module: modulo de gestion de ejercicios.
- Packs Module: modulo de gestion de packs de clases.
- Planning Module: modulo de gestion de planificaciones.
- RMs Module: modulo de gestion de cargas y RMs.
- Metrics Module: modulo de gestion de metricas.
- Notifications Module: modulo de notificaciones.

## 2. Objetivo / Éxito

- Laplace es un producto que debe permitir la gestion y seguimiento de centros fitnes y miembros.
- El producto debe contar con 4 aplicativos web. Los aplicativos seran: Dashboard for Super Admin (DFSA), Dashbord for Suscriptor Manager (DFSM), Webapp for Members (WAFM) y Landingpage. 
- La forma de monetizacion sera por medio de suscripciones, un valor mensual dependiendo de los servicios que se contraten. Se tendran 3 tipos de packs: Basic, Pro y Max.
- El DFSA debe ser un dashboard web optimizado para desktop en el cual el Super Admin pueda gestionar a los suscriptores, las suscripciones, los ejercicios y ver metricas del producto.
- El DFSM debe ser un dashboard para los suscriptores que se suscriben a alguno de los planes disponibles, en funcion al plan seleccionado tendran acceso o no a diferentes modulos y funcionalidades de la plataforma.
- LA WAFM debe ser una webapp para el uso de los miembros o atletas, desde la cual pdran gestionar sus clases, RMs y ver estadisticas.
- La landing page debe ser publica y debe explicar y mostrar de que trata y como funciona el producto.

### 2.1 Modulos

1. Auth Module: Se encarga de la uthenticacion y registro de usuarios, se reutiliza para cada uno de los aplicativos y esta basado en Better Auth.
- Registro de usuarios via aplicaciones de terceros (gmail, Outlook, etc).
- Recupero de contraseña.
- Seguridad.
- Velocidad.
- Disponible en: Landing-page, DFSA, DFSM, WAFM.

2. Suscriptors Module: Se encarga del alta de nuevos suscriptores, los nuevos suscriptores pueden ser dados de alta por el Super Admin o desde un formulario en la landingpage. 
- CRUD de suscriptores.
- Cambios de estado (enabled, disabled, blocked).
- Disponible en: DFSA.

3. Suscriptions Module: Se encarga de la gestion de los planes de suscripcion (basic, pro y max). Permite definir su precio, su informacion (la cual se muestra en la landingpage) y que modulos y funcionalidades se incluyen en cada uno de los 3. Se permite crear planes personalizados para suscriptores vip.
- CRUD de suscripciones/planes
- Cambio de informacion de planes (nombre, precio, descripcion, vigencia, tags, que incluye/no incluye (modulos, funcionalidades, limites)).
- Disponible en: DFSA.

4. Schedule Module: Se encarga de la gestion de horarios y clases tanto para los centros como para los miembros.
- CRUD de clases de un centro.
- CRUD de clases de un miembro
- Un centro puede elegir los horarios de atencion (abierto/cerrado), permite fraccionar el dia/semana en clases.
- Un miembro con plan activo puede anotarse a una clase de un centro o modificar o darse de baja de una.
- Disponible en: DFSM (para gestion de clases), WAFM (para gestion de sus packs contratados).

5. Rooms Module: Se encarga de la gestion de Salas para un usuario Suscriptor Manager. Puede crear mas de una sala y administrarlas por separado. Este modulo esta pensado para centros que cuenten con mas de una sucursal y cada uno se necesite gestionar como una unidad de negocio independiente de las demas. Ej: Un Suscriptor Manager puede tener mas de un Box de Crossfit, o puede tener un gimnasio y un centro de pilates, o se puede tratar de una cadena de centros funcionales, etc.
- CRUD de salas.
- Disponible en: DFSM.

6. Members Module: Se encarga de la gestion de los miembros de un centro. Los miembros son los atletas que toman clases de alguna disiplina fitnes en algun centro que tenga contratado el servicio. Son quienes tendran acceso a la WAFM. Pueden estar asociados a mas de un centro, podran desde la WAFM elegir el que quieren usar.
(CONTINAR AQUI!)

## 3. Fuera de alcance (Non-goals)

- No se debe desarrollar ninguna funcionalidad que no este documentada en las specs.
- No se debe seguir malas practicas en desarrollo de software y en seguridad informatica.
- No se debe dejar sin documentar ninguno de los procesos.

## 4. Contexto / Estado actual

- Repo: https://github.com/BraianVaylet/laplace-project

## 5. Requisitos funcionales



## 6. Requisitos no funcionales

### STACK

- React
- Node
- TypeScript
- Mongo DB
- Better Auth (authenticacion)
- Zod (Validaciones)
- Temporal (Fechas)
- Tanstack (Table, Form, Charts, Query, Router and others)
- Motion (animaciones)
- Fontsource (fuentes)
- Zustand (estado global)
- pragmatic-drag-and-drop (drag and drop)
- Nuqs (estados en url)

### Buenas Practicas

- TDD
- SOLID
- DRY

### Arquitectura

- Modular
- APIs REST
- Atomic Design
- Componentes Cross

### Testing

- TDD
- Test estaticos (linters)
- Test unitarios
- Test e2e
- Coverage mayor al 90%





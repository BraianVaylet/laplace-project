# [LAPLACE] — Spec


## 1. Resumen

"Laplace project" es un producto para la gestion de centros de Crossfit adaptable a otras actividades fitnes como Funcional, Hybrid, Hyrox, Gimnasios, etc. Cuenta con aplicativos web para su administracion y seguimiento tanto para el dueño del box como para los usuarios que practican en el. 

## 2. Objetivo / Éxito

El producto permite la gestion de suscripciones para los diferentes dueños de centros deportivos que busquen contratar el servicio. Permite que los suscriptores puedan gestionar sus centros y obtener estadisticas sobre su uso. Los usuarios de estos centros podran hacer uso de una app para registrar sus clases y avances en su practica deportiva.

- [ ] Criterio 1: El producto debe contar con 4 aplicativos web que deben poder utilizarse principalmente desde dispositivos mobiles. Los aplicativos seran: Dashboard for King Admin, Dashbord for Owner, Webapp for Users y Landingpage. La forma de monetizacion sera por medio de suscripciones, un valor mensual dependiendo de los servicios que se contraten. Se tendran 3 tipos de packs: Basic, Pro y Max.
- [ ] Criterio 2: El Dashboard For King Admin (DFKA) sera un panel pensado para el administrador rey del producto (el dueño de Laplace, el rey del producto). En este panel se podra gestionar las suscripciones, los suscriptores, las actualizaciones y las notificaciones. Tambien se podra visualizar los logs y las metricas del producto (uso, usuarios, ganancias, etc). Solo una persona tendra acceso al DFKA, el admin king.
- [ ] Criterio 3: El Dashboard for Owner (DFOW) sera un panel pensado para los suscriptores (dueños de centros deportivos). En este panel se podra gestionar los packs de clases, los horarios, los clientes, las promos, las planificaciones, la imagen de la marca y ver estaditicas como cantidad de clientes, evolucion de sus RMs y ejercicios, ingresos, etc. Este dashboard podra ser accedido por el Owner (quien contrata el servicio), asi como usuarios con roles de administrador (profesores o representantes que tengan permitido entrar en el sistema), el owner puede define a que modulos tienen acceso estos administradores y cuales no.
- [ ] Criterio 4: La WebApp for User (WAFU) sera una webapp pensada para los clientes de los centros deportivos, los usuarios pueden registrarse y acceder a los centros deportivos que esten suscriptos a Laplace. Desde esta webapp podran ver su cuota de clases (packs), gestionar sus clases, sus RMs, sus cargas y mas. La webapp permitira cargar un valor RM para cada ejercicio para luego hacer los calculos de las cargas (65, 75, 85, 90, 95 %, etc). Tambien podran para los ejercicios que no requieran cargas registrar otros parametros como cantidad de repeticiones o tiempos.
- [ ] Citerio 5: La Landingpage se trata de la cara visible y marca del proyecto Laplace en la internet. Se podra ver informacion sobre como funciona el producto y los costos de suscripciones.
- [ ] Criterio 6: Los Planes seran en funcion de las caracteristicas que se ofrecen. El pack Basic solo dara acceso a los modulos de gestion de packs y horarios. El plan Pro tendra acceso a todos los modulos salvo al modulo de planificaciones. Por ultimo, el plan Max tiene acceso a todos los modulos y a nuevos modulos que se desarrollen.

## 3. Fuera de alcance (Non-goals)

- No se debe desarrollar ninguna funcionalidad que no este documentada en las specs.
- No se debe seguir malas practicas en desarrollo de software y en seguridad informatica.
- No se debe dejar sin documentar ninguno de los procesos.

## 4. Contexto / Estado actual

- Repo: https://github.com/BraianVaylet/laplace-project

## 5. Requisitos funcionales

Leer: 
- functional.spec.md
- dfka.func.spec.md
- dfow.func.spec.md
- wafu.func.spec.md
- landing.func.spec.md

## 6. Requisitos no funcionales

Leer: 
- technical.spec.md
- dfka.tech.spec.md
- dfow.tech.spec.md
- wafu.tech.spec.md
- landing.tech.spec.md



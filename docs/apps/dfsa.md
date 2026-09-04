# DFSA — Dashboard for Super Admin

> El panel de Laplace sobre sus clientes. Puerto de desarrollo: **5173**.

## Quién entra

Solo el **super admin (SAU)**. Las rutas de `/api/v1/admin` exigen, además de la sesión, la marca de
super admin **y segundo factor**: es la cuenta que puede mirar a todos los centros, y una cuenta así
protegida solo con contraseña es una cuenta prestada.

## 🔴 Lo que el super admin NO ve

**Datos de socios de ningún centro.** Ve conteos —cuántos socios tiene un centro—, nunca personas
(ADR-004, decisión 7).

Para entrar a la cuenta de un suscriptor hay **un solo camino**: la impersonación. Exige motivo,
dura poco, queda registrada en el log de auditoría **del centro** y le avisa al dueño. Un acceso de
soporte que el dueño de la cuenta no puede ver es indistinguible de una fuga, y la diferencia entre
las dos cosas la tiene que poder ver él, no nosotros.

El buscador de soporte devuelve el código de error, el estado y la ruta. **Nunca el mensaje ni el
`meta`**: ahí puede estar el nombre y el saldo de un socio.

## Pantallas

| Pantalla         | Qué muestra                                                                                                                            |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Suscriptores** | Cada centro con su plan, su estado, su precio congelado y su uso contra los límites. Marca a los que se pasaron: es la señal de upsell |
| **Salud**        | Errores por código en las últimas 24 h, jobs fallidos, webhooks pendientes y el conteo de suscriptores por estado                      |

El buscador de soporte por `requestId` o por código de error vive dentro de Salud.

## Permisos

No usa la matriz de recursos del centro: sus rutas son de plataforma, y el corte es
`isSuperAdmin` + segundo factor.

## Deuda declarada

La pantalla de edición de planes (nombre, precio, descripción y qué incluye) todavía no existe: la
API está, y la entrada está en la navegación. Los webhooks pendientes informan cero hasta la Fase 2,
que es cuando existen.

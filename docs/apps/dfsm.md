# DFSM — Dashboard for Suscriptor Manager

> El escritorio del centro. Lo usan el dueño (SMU) y su staff (SSU). Puerto de desarrollo: **5174**.

## Quién entra y con qué permiso

Los roles son **presets de la matriz recurso × acción**, no jaulas: un centro puede armar el suyo.

| Rol        | Ve plata | Toma asistencia | Crea clases | Da de alta socios |
| ---------- | -------- | --------------- | ----------- | ----------------- |
| Dueño      | sí       | sí              | sí          | sí                |
| Encargado  | no       | sí              | sí          | sí                |
| Mostrador  | sí       | sí              | no          | sí                |
| Head coach | no       | sí              | sí          | no                |
| Coach      | no       | sí              | no          | no                |

🔴 **"No ve plata" quiere decir que la API no se la manda.** El saldo del socio sale `null` para
quien no tiene `billing:read`, el estado de cuenta contesta 403 y el bloque de caja del tablero no
se arma. Esconderlo en la pantalla no esconde nada: quedaría en la respuesta y en el caché del
navegador.

## Pantallas

| Pantalla            | Ruta                     | Qué es                                                                                                                |
| ------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| **Hoy**             | `/`                      | El tablero del día: alertas accionables arriba, después las clases con su ocupación, la gente que entró y la caja     |
| **Primeros pasos**  | `/` (arriba del tablero) | El asistente del centro nuevo. Desaparece solo cuando el centro ya opera                                              |
| **Ficha del socio** | `/miembros/:memberId`    | Todo lo del socio en una pantalla: datos, cuenta, packs, lo que viene, asistencia de 90 días, firmas y notas internas |
| **Lista de clase**  | `/clases/:sessionId`     | La del coach, en mobile: quién está anotado, quién entró, y las alertas al lado del nombre                            |
| **Kiosco**          | `/kiosko`                | La tablet de la entrada. **Sin el chrome del centro**: mostrarle el panel a quien pasa por la puerta sería exponerlo  |
| **Buscador global** | Ctrl+K                   | Por nombre, documento o teléfono — las tres formas en que alguien se identifica en un mostrador                       |

## Decisiones de diseño

- **El home es un tablero, no un menú.** Lo que se ve al abrirlo es lo que hay que hacer hoy.
- **Las alertas van arriba de los números.** Un gráfico se mira; una alerta se toca.
- **Densidad alta**: quien usa esto está trabajando, no explorando.
- **El asistente de primeros pasos va antes del "elegí un centro"**: quien recién se registra no
  tiene ninguna sede, y esa pantalla vacía era el final del camino en el primer día.
- **Cada sección de la ficha es su propio pedido**: si se cae cobranza, el mostrador sigue viendo
  los packs.

## Deuda declarada

Las altas de sede, sala, clase, producto y la venta de packs **existen en la API pero todavía no
tienen pantalla**. El menú y el asistente ya apuntan a sus rutas. Es lo que falta para cerrar del
todo el camino que hoy se recorre por API en los E2E.

# WAFM — Webapp for Members

> La app del socio. Puerto de desarrollo: **5175**.

## Quién entra

El **socio (MU)**, con su propia cuenta. Se asocia al centro con un código de invitación; a partir de
ahí su sesión tiene el rol `member` en esa organización.

🔴 **Ninguna ruta de `/api/v1/my/*` acepta un `memberId`.** Sale de la sesión, siempre. Si lo
aceptara, un socio podría pedir los datos del compañero de al lado y el aislamiento por tenant no lo
taparía: los dos son del mismo centro.

## Pantallas

| Pantalla       | Ruta        | Qué es                                                                                 |
| -------------- | ----------- | -------------------------------------------------------------------------------------- |
| **Inicio**     | `/`         | Lo próximo que tiene reservado y lo que le queda                                       |
| **Horario**    | `/horario`  | La semana del centro, con el cupo de cada clase. Reservar y cancelar                   |
| **Mis packs**  | `/packs`    | Cuántas clases le quedan y hasta cuándo — las dos preguntas que hoy manda por WhatsApp |
| **Mi QR**      | `/qr`       | El código de check-in, **a un toque desde cualquier pantalla**                         |
| **Mi perfil**  | `/perfil`   | Sus datos, su foto, su contacto de emergencia y sus derechos sobre sus datos           |
| **Avisos**     | (en perfil) | Qué quiere recibir y por qué canal                                                     |
| **Pendientes** | (al entrar) | Los documentos que le falta firmar, si el centro los exige                             |

## Decisiones de diseño

- **Mobile first, densidad baja.** Se usa de pie, con una mano, apurado. Todo lo tocable mide al
  menos 44×44 px.
- **Reservar y cancelar son optimistas**, con vuelta atrás y el mensaje del error tipado. Esperar
  dos segundos mirando un spinner para enterarse de que la clase estaba llena es peor que
  enterarse un segundo después de haber creído que entrabas.
- **La política de cancelación se muestra antes de confirmar** (§2.1.5.d): descubrir que perdiste el
  crédito después de cancelar es lo que la hace sentir arbitraria.
- **El horario se ve sin red.** Es PWA, y el horario de mañana no cambió.
- **Los packs vencidos y agotados se muestran igual**: "no te quedan clases" es la explicación de por
  qué no puede reservar.
- **El botón de renovar aparece solo cuando renovar cambia algo.** Antes es ruido.

## Sus datos son suyos

En el perfil, a la vista y no escondidos en un mail a soporte (§9.2, Ley 25.326):

- **Descargar mis datos**: todo lo que el centro guarda, en JSON, en el momento.
- **Pedir la baja**: se registra con fecha y la pantalla dice hasta cuándo se conservan los datos y
  por qué. Decir "listo, borrado" sería mentir: el centro tiene obligaciones sobre lo firmado y lo
  cobrado.

La foto de perfil se valida por **los bytes**, no por la extensión, y su enlace vence a los 15
minutos.

## Errores frecuentes

Los tres que más aparecen, y qué dice la app:

| Código            | Qué pasó            | Qué ofrece                     |
| ----------------- | ------------------- | ------------------------------ |
| `LP-BOOK-409-002` | La clase está llena | Anotarse en la lista de espera |
| `LP-CTRT-402-001` | Sin créditos        | Renovar en el centro           |
| `LP-CTRT-402-002` | El pack venció      | Renovar en el centro           |

El mensaje siempre dice qué puede hacer el usuario.

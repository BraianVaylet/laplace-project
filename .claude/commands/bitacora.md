---
description: Agrega una entrada a docs/BITACORA.md a partir de los cambios recientes
argument-hint: [título de la entrada] (opcional)
allowed-tools: Bash(git log:*), Bash(git diff:*), Bash(git status:*), Read, Edit
---

Agregá una entrada nueva a `docs/BITACORA.md`. Título sugerido: $ARGUMENTS

1. Mirá `git log` y `git diff` para saber qué cambió realmente. No lo asumas.
2. Usá exactamente el formato definido al principio de `docs/BITACORA.md`.
3. Insertá la entrada **arriba de todo** (más nuevo primero), debajo del bloque de formato.
4. **Qué cambió** se escribe en resultado observable, no en descripción del diff.
   Mal: "se agregó el método `createBooking` al servicio".
   Bien: "un miembro ya puede reservar una clase desde la WAFM y se le descuenta el crédito".
5. **Por qué** es el motivo de negocio o técnico, no la repetición del título.
6. Completá `Impacto` con: modelo de datos / API / migración / códigos de error nuevos, o `ninguno`.
7. Si hay commit o PR, referencialo. Si conocés la tarjeta de Trello, enlazala; si no, dejá `—`.
8. No inventes tarjetas, PRs ni fechas. Lo que no sabés va como `—`.

---
description: Crea un ADR nuevo en docs/adr/ con el formato del proyecto
argument-hint: <decisión a documentar>
---

Escribí un ADR para: **$ARGUMENTS**

1. Numeralo con el siguiente correlativo libre en `docs/adr/` (mirá el directorio primero).
   Nombre: `NNN-slug-corto.md`.
2. Antes de escribir, buscá en `docs/spec/LAPLACE-SPEC.md` y en los ADRs existentes si la decisión
   ya está tomada o si contradice una anterior. Si la contradice, el ADR nuevo debe decir cuál
   **supersede** y el viejo pasa a estado `Reemplazada por ADR-NNN`.
3. Formato, igual que los ADRs existentes:

```markdown
# ADR-NNN — <título>

- **Estado:** Propuesta | Aceptada | Reemplazada por ADR-NNN
- **Fecha:** YYYY-MM-DD
- **Spec:** <secciones relacionadas>

## Contexto

El problema y las fuerzas en juego. Sin la solución todavía.

## Opciones consideradas

Al menos dos reales, con su costo. Una opción de paja no es una opción.

## Decisión

Qué se hace, en presente y en imperativo. Las reglas derivadas, si las hay.

## Consecuencias

Lo bueno **y lo malo**. Qué se vuelve difícil a partir de ahora. Qué cuesta revertir.
```

4. Un ADR es corto: si pasa de una carilla, probablemente sean dos decisiones.
5. Si el ADR cambia una regla que está en `CLAUDE.md`, actualizá `CLAUDE.md` en el mismo cambio y
   agregá la entrada en `docs/BITACORA.md`.

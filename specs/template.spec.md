# [Nombre del Proyecto] — Spec

> Instrucciones de uso: completar cada sección. Borrar lo que no aplique. Ser específico y verificable — Claude Code ejecuta lo que está escrito, no lo que se quiso decir.

## 1. Resumen

Qué se construye, en 2-3 frases. Qué problema resuelve y para quién.

## 2. Objetivo / Éxito

Qué significa "terminado". Criterio medible, no vago.

- [ ] Criterio 1
- [ ] Criterio 2

## 3. Fuera de alcance (Non-goals)

Qué NO se va a hacer en esta iteración. Evita que Claude Code expanda el scope solo.

- No se implementa X
- No se soporta Y todavía

## 4. Contexto / Estado actual

- Repo / stack: (lenguajes, frameworks, versiones)
- Código relevante existente: rutas de archivos/carpetas que ya existen y son punto de partida
- Convenciones del proyecto a seguir (estilo, patrones, linters)
- Dependencias externas (APIs, servicios, DB)

## 5. Requisitos funcionales

Lista numerada, cada uno testeable de forma independiente.

1. El sistema debe...
2. Cuando el usuario hace X, debe pasar Y.
3. ...

## 6. Requisitos no funcionales

- Performance: (ej. latencia, carga)
- Seguridad: (auth, validación de input, datos sensibles)
- Compatibilidad: (browsers, OS, versiones)

## 7. Modelo de datos / Interfaces

Definir contratos concretos — esto es lo que más ambigüedad elimina.

```
// Ejemplo: schema, tipos, endpoints, firmas de función
```

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

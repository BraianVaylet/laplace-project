# ADR-005 — Renderizado de la landing: SSG con `vite-react-ssg`

- **Estado:** Aceptada
- **Fecha:** 2026-09-01
- **Spec:** §5.1.4, §0.1.2

## Contexto

La landing es el canal de adquisición del producto: la spec §5.1.4 pide explícitamente
**SSR/SSG + meta tags + sitemap** y advierte que _"si es SPA sin SSR, no rankea"_. También pide
blog/SEO apuntado a términos concretos (`software gestión gimnasio Argentina`,
`sistema para box de crossfit`, `software pilates turnos`).

Hoy `apps/landing` es una SPA de Vite + React 19: sirve un `index.html` vacío que se llena por JS.
Para un buscador eso es una página sin contenido.

Las otras tres aplicaciones (DFSA, DFSM, WAFM) están detrás de login y **no necesitan SSR**: son
SPAs y deben seguir siéndolo. La decisión aplica solo a la landing.

## Opciones consideradas

1. **Migrar la landing a Next.js.** Es la opción con más SEO por default, pero mete un segundo
   framework, un segundo modelo de routing y un segundo runtime de deploy en un monorepo que ya
   está estandarizado en Vite + Tanstack Router. Con un dev, el costo es permanente.
2. **TanStack Start.** Coherente con el resto del stack (§6 ya usa Tanstack Router), pero suma un
   servidor Node para la landing y arrastra su propio ciclo de madurez.
3. **`vite-react-ssg`.** Prerenderiza las rutas a HTML estático en build, conservando el mismo
   Vite, el mismo React 19, el mismo Tailwind v4 y el mismo `vite.config.ts` que ya existe.
   Salida: archivos estáticos, sin servidor.
4. **Dejarla SPA y agregar prerender por servicio externo.** Depende de un tercero y de un costo
   recurrente para resolver algo que el build puede hacer solo.

## Decisión

**Opción 3, `vite-react-ssg`.** La landing se prerenderiza a HTML estático en el build; el resto de
las apps queda como SPA.

- Contenido, meta tags (`title`, `description`, Open Graph), `sitemap.xml` y `robots.txt` salen del
  build, no del runtime.
- Las páginas legales (términos, privacidad) y el futuro blog son rutas estáticas más: sin servidor
  que mantener.
- El formulario de contacto y el CTA de trial siguen siendo llamadas a `/api/v1` desde el cliente;
  no necesitan render en servidor.

## Consecuencias

- **Positivas:** un solo framework y un solo modelo de build en todo el monorepo. Deploy de la
  landing como estáticos: barato, cacheable en CDN y sin superficie de ataque de servidor.
- **Negativas:** sin SSR en request-time, cualquier contenido personalizado por visitante requiere
  hidratación en cliente. Para una landing de producto no es una limitación real.
- El contenido del blog, cuando exista, se resuelve con archivos en el repo (Markdown) y no con un
  CMS: si en algún momento hace falta un CMS con publicación sin deploy, esta decisión se revisa.
- `pnpm build` de la landing pasa a emitir HTML por ruta. El test de la landing debe verificar que
  el HTML generado contiene el `<title>` y la meta description, no solo que el componente renderiza.

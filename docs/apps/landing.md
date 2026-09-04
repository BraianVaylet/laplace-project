# Landing — el sitio público

> La puerta de entrada. Puerto de desarrollo: **5176**.

## Qué es

El sitio que explica el producto y arranca la prueba. **Se prerenderiza a HTML estático** con
`vite-react-ssg`: una SPA sin SSR no rankea, y esta página existe para que la encuentren
(→ [ADR-005](../adr/005-landing-rendering.md)).

## Secciones

| Sección                | Qué dice                                                      |
| ---------------------- | ------------------------------------------------------------- |
| **Precios**            | Los tres planes con lo que incluye cada uno, leídos de la API |
| **Contra la planilla** | Por qué esto y no un Excel compartido                         |
| **Seguridad**          | Qué se hace con los datos, en criollo                         |
| **Pantallas**          | Cómo se ve el producto                                        |
| **Contacto**           | El formulario que genera un interesado en el CRM              |

Y las páginas legales: términos, privacidad y tratamiento de datos.

## Decisiones

- **Los precios salen de la API**, no de un archivo del front: cambiar un precio no puede exigir un
  deploy de la landing.
- **Lo que no se puede afirmar, no se afirma.** Las secciones de testimonios y de capturas del
  producto quedaron **vacías, y la página lo dice**: inventar un testimonio o una captura de algo
  que no existe es mentirle a quien está decidiendo si contrata.
- El formulario de contacto valida en el cliente y en el servidor con el mismo schema.

## SEO

Meta tags por página, `sitemap.xml` y `robots.txt` generados en el build. Los tests verifican el
HTML **prerenderizado**, no el que arma React en el navegador: por eso en el CI el build va antes de
los tests.

## Deuda declarada

El alta self-service todavía no tiene formulario propio en la landing: la API está
(`POST /api/v1/subscribers`, con prueba de 14 días sin tarjeta) y el CTA existe. El formulario de
registro es lo que falta para cerrar el camino completo desde la web.

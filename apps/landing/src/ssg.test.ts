import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAGES, SITE_URL, buildRobots, buildSitemap, seoFor } from './seo.js';

/**
 * F0-14. Se testea el **HTML generado**, no el componente.
 *
 * Es la diferencia que importa: un test de componente pasa igual aunque el
 * prerender no funcione, y entonces la landing se ve bien en el navegador pero
 * el buscador recibe un `<div>` vacio. Lo que §5.1.4 pide es justamente que el
 * contenido este en el HTML servido.
 */
const DIST = resolve(process.cwd(), 'dist');

/**
 * Estas aserciones necesitan el build. En CI el `pnpm build` corre ANTES del
 * `pnpm test:coverage` justamente para que no se salteen; en local, `pnpm test`
 * a secas las saltea y hay un test abajo que lo deja dicho.
 */
const hasBuild = existsSync(resolve(DIST, 'index.html'));

const html = (file: string) => readFileSync(resolve(DIST, file), 'utf8');

describe('metadatos por pagina', () => {
  it('toda pagina declarada tiene titulo y descripcion', () => {
    for (const page of PAGES) {
      expect(page.title.length, page.path).toBeGreaterThan(10);
      expect(page.description.length, page.path).toBeGreaterThan(30);
    }
  });

  it('la home apunta a las busquedas de §5.1.4', () => {
    const home = seoFor('/');

    expect(home.title.toLowerCase()).toContain('gestión');
    expect(`${home.title} ${home.description}`.toLowerCase()).toContain('gimnasio');
    expect(`${home.title} ${home.description}`.toLowerCase()).toContain('argentina');
  });

  it('los titulos no se repiten entre paginas: dos iguales compiten entre si', () => {
    const titles = PAGES.map((page) => page.title);

    expect(new Set(titles).size).toBe(titles.length);
  });

  it('una ruta sin SEO declarado falla ruidosamente en vez de publicarse sin titulo', () => {
    expect(() => seoFor('/inventada')).toThrowError(/PAGES/);
  });
});

describe('sitemap y robots', () => {
  it('el sitemap lista la home', () => {
    expect(buildSitemap('2026-09-01')).toContain(`${SITE_URL}/`);
  });

  it('las paginas legales NO van al sitemap: no aportan y diluyen', () => {
    const sitemap = buildSitemap('2026-09-01');

    expect(sitemap).not.toContain('/terminos');
    expect(sitemap).not.toContain('/privacidad');
  });

  it('es XML valido en su forma basica', () => {
    const sitemap = buildSitemap('2026-09-01');

    expect(sitemap.startsWith('<?xml')).toBe(true);
    expect(sitemap).toContain('<urlset');
    expect(sitemap).toContain('</urlset>');
  });

  it('robots.txt permite indexar y apunta al sitemap', () => {
    const robots = buildRobots();

    expect(robots).toContain('Allow: /');
    expect(robots).toContain(`${SITE_URL}/sitemap.xml`);
  });
});

describe('aviso sobre el build', () => {
  it.skipIf(hasBuild)('las aserciones sobre el HTML necesitan `pnpm build` primero', () => {
    // No falla: solo deja constancia en la salida de por que no corrieron.
    expect(hasBuild).toBe(false);
  });
});

describe.skipIf(!hasBuild)('el HTML que realmente se sirve', () => {
  it('trae el contenido adentro, no un div vacio', () => {
    const index = html('index.html');

    expect(index).toContain('La gestión de tu centro deportivo');
    expect(index).toContain('Probalo 14 días gratis');
    // Sin esto, el buscador ve una pagina en blanco (ADR-005).
    expect(index).not.toMatch(/<div id="root"><\/div>/);
  });

  it('🔴 el formulario de alta está en el HTML servido, no solo en el navegador', () => {
    /*
     * Es la página que convierte (F1-38). Si el contenido lo arma React
     * después, quien entra con una conexión mala ve un rectángulo vacío justo
     * en el momento en que decidió probar el producto.
     */
    const empezar = html('empezar.html');

    expect(empezar).toContain('Probá Laplace 14 días');
    expect(empezar).toContain('Crear mi centro');
    expect(empezar).toContain('Nombre de tu centro');
    expect(empezar).not.toMatch(/<div id="root"><\/div>/);
  });

  it('tiene exactamente UN title, y es el de la ruta', () => {
    const titles = html('index.html').match(/<title[^>]*>[^<]*<\/title>/g) ?? [];

    expect(titles).toHaveLength(1);
    expect(titles[0]).toContain('Software de gestión para gimnasios');
  });

  it('trae la meta description y el canonical', () => {
    const index = html('index.html');

    expect(index).toContain('<meta data-rh="true" name="description"');
    expect(index).toContain(`rel="canonical" href="${SITE_URL}/"`);
  });

  it('trae Open Graph, que es lo que se ve al compartir el link', () => {
    const index = html('index.html');

    expect(index).toContain('property="og:title"');
    expect(index).toContain('property="og:description"');
    expect(index).toContain('content="es_AR"');
  });

  it('cada ruta se prerenderiza a su propio archivo', () => {
    expect(existsSync(resolve(DIST, 'terminos.html'))).toBe(true);
    expect(existsSync(resolve(DIST, 'privacidad.html'))).toBe(true);
  });

  it('cada pagina trae SU titulo, no el de la home', () => {
    expect(html('privacidad.html')).toContain('Política de privacidad');
    expect(html('terminos.html')).toContain('Términos y condiciones');
  });

  it('el idioma esta declarado: es-AR, no un ingles por default', () => {
    expect(html('index.html')).toContain('lang="es-AR"');
  });

  it('hay un solo h1 por pagina', () => {
    const h1s = html('index.html').match(/<h1[\s>]/g) ?? [];

    expect(h1s).toHaveLength(1);
  });

  it('el sitemap y el robots salen en el build', () => {
    expect(existsSync(resolve(DIST, 'sitemap.xml'))).toBe(true);
    expect(existsSync(resolve(DIST, 'robots.txt'))).toBe(true);
  });
});

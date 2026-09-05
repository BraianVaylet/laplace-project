/**
 * Metadatos por ruta. Viven como datos y no dentro de cada pagina para poder
 * generar el sitemap desde lo mismo y para que nadie publique una pagina sin
 * titulo (§5.1.4).
 */
export interface PageSeo {
  path: string;
  title: string;
  description: string;
  /** `false` para las paginas legales: no aportan al SEO y diluyen. */
  inSitemap?: boolean;
}

export const SITE_URL = 'https://laplace.app';

export const PAGES: readonly PageSeo[] = [
  {
    path: '/',
    // Las palabras clave de §5.1.4, en una frase que un humano leeria.
    title: 'Laplace · Software de gestión para gimnasios y boxes en Argentina',
    description:
      'Clases, reservas, packs y cobranza para tu centro deportivo. Precio en pesos, sin dólares. Probalo 14 días gratis, sin tarjeta.',
  },
  {
    path: '/empezar',
    title: 'Probá Laplace 14 días · Sin tarjeta',
    description:
      'Creá tu centro en dos minutos y probá Laplace 14 días. Sin tarjeta, sin llamada de ventas y con precio en pesos.',
  },
  {
    path: '/terminos',
    title: 'Términos y condiciones · Laplace',
    description: 'Términos del servicio de Laplace para centros deportivos.',
    inSitemap: false,
  },
  {
    path: '/privacidad',
    title: 'Política de privacidad · Laplace',
    description:
      'Cómo tratamos los datos personales, en cumplimiento de la Ley 25.326 de Argentina.',
    inSitemap: false,
  },
  {
    path: '/tratamiento-de-datos',
    title: 'Acuerdo de tratamiento de datos · Laplace',
    description:
      'El acuerdo entre Laplace y el centro sobre los datos de sus socios: qué se guarda, por cuánto tiempo y qué se puede pedir.',
    inSitemap: false,
  },
];

export function seoFor(path: string): PageSeo {
  const page = PAGES.find((candidate) => candidate.path === path);
  if (!page) throw new Error(`Falta el SEO de la ruta ${path}. Agregala a PAGES.`);

  return page;
}

/** `sitemap.xml` a partir de las mismas paginas: no puede desincronizarse. */
export function buildSitemap(lastModified: string): string {
  const urls = PAGES.filter((page) => page.inSitemap !== false)
    .map(
      (page) =>
        `  <url>\n    <loc>${SITE_URL}${page.path}</loc>\n    <lastmod>${lastModified}</lastmod>\n  </url>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function buildRobots(): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;
}

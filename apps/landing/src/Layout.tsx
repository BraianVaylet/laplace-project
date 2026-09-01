import { Head } from 'vite-react-ssg';
import { Outlet, useLocation } from 'react-router-dom';
import { Button } from '@laplace/ui';
import { Providers } from './providers.js';
import { SITE_URL, seoFor } from './seo.js';

const SECTIONS = [
  { id: 'producto', label: 'Producto' },
  { id: 'funcionalidades', label: 'Funcionalidades' },
  { id: 'precios', label: 'Precios' },
  { id: 'faq', label: 'Preguntas' },
  { id: 'contacto', label: 'Contacto' },
] as const;

/**
 * Layout de la landing. El `<Head>` se resuelve en el prerender, asi que el
 * titulo y la descripcion viajan **en el HTML**: un buscador los lee sin
 * ejecutar JavaScript (ADR-005).
 */
export function Layout() {
  const { pathname } = useLocation();
  const seo = seoFor(pathname === '' ? '/' : pathname);

  return (
    <Providers>
      <Head>
        <html lang="es-AR" />
        <title>{seo.title}</title>
        <meta name="description" content={seo.description} />
        <link rel="canonical" href={`${SITE_URL}${seo.path}`} />

        <meta property="og:type" content="website" />
        <meta property="og:title" content={seo.title} />
        <meta property="og:description" content={seo.description} />
        <meta property="og:url" content={`${SITE_URL}${seo.path}`} />
        <meta property="og:locale" content="es_AR" />
        <meta name="twitter:card" content="summary_large_image" />
      </Head>

      <div className="bg-bg text-fg flex min-h-dvh flex-col">
        <header className="border-border bg-surface sticky top-0 z-10 flex h-14 items-center gap-4 border-b px-4">
          <a href="/" className="focus-visible:focus-ring rounded font-semibold">
            Laplace
          </a>

          <nav aria-label="Secciones" className="hidden gap-1 md:flex">
            {SECTIONS.map((section) => (
              <a
                key={section.id}
                href={`/#${section.id}`}
                className="text-fg-muted hover:text-fg focus-visible:focus-ring flex h-11 items-center rounded-md px-3 text-sm"
              >
                {section.label}
              </a>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <a
              href="/dfsm"
              className="text-fg-muted hover:text-fg focus-visible:focus-ring flex h-11 items-center rounded-md px-3 text-sm"
            >
              Ingresar
            </a>
            <Button>Probar gratis</Button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-4xl flex-1 p-6">
          <Outlet />
        </main>

        <footer className="border-border text-fg-muted border-t px-4 py-6 text-xs">
          <nav aria-label="Legales" className="mb-2 flex gap-4">
            <a href="/terminos" className="hover:text-fg focus-visible:focus-ring rounded">
              Términos
            </a>
            <a href="/privacidad" className="hover:text-fg focus-visible:focus-ring rounded">
              Privacidad
            </a>
          </nav>
          Laplace · Bahía Blanca, Argentina
        </footer>
      </div>
    </Providers>
  );
}

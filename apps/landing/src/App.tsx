import { Button, Card } from '@laplace/ui';
import { Providers } from './providers.js';

/**
 * Shell de la landing (§5.1.4). Es la única app pública e indexable: el
 * contenido completo y el SEO llegan con F0-14 (SSG) y F1-26.
 */
const SECTIONS = [
  { id: 'producto', label: 'Producto' },
  { id: 'funcionalidades', label: 'Funcionalidades' },
  { id: 'precios', label: 'Precios' },
  { id: 'faq', label: 'Preguntas' },
  { id: 'contacto', label: 'Contacto' },
] as const;

export function App() {
  return (
    <Providers>
      <div className="bg-bg text-fg flex min-h-dvh flex-col">
        <header className="border-border bg-surface sticky top-0 flex h-14 items-center gap-4 border-b px-4">
          <span className="font-semibold">Laplace</span>

          <nav aria-label="Secciones" className="hidden gap-1 md:flex">
            {SECTIONS.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
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
          <section id="producto" className="flex flex-col gap-4 py-12">
            <h1 className="text-3xl font-semibold">
              La gestión de tu centro, en pesos y sin planillas
            </h1>
            <p className="text-fg-muted max-w-prose">
              Clases, reservas, packs y cobranza en un solo lugar. Probalo 14 días gratis, sin
              tarjeta.
            </p>
            <div>
              <Button size="lg">Empezar la prueba</Button>
            </div>
          </section>

          <Card title="En construcción">
            <p className="text-fg-muted text-sm">
              Las secciones completas llegan con F1-26. El SSG, con F0-14.
            </p>
          </Card>
        </main>

        <footer className="border-border text-fg-muted border-t px-4 py-6 text-xs">
          Laplace · Bahía Blanca, Argentina
        </footer>
      </div>
    </Providers>
  );
}

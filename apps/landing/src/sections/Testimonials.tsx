import { useState } from 'react';

/**
 * El carousel de testimonios (§5.1.4).
 *
 * 🔴 **Arranca vacío, y es a propósito.** Un testimonio inventado es una reseña
 * falsa: quien la lee cree que un centro real dijo eso, y decide con eso. La
 * sección existe, el carousel funciona y el contenido lo pone el producto
 * cuando tenga clientes que hayan aceptado prestar su nombre.
 *
 * El carousel es accesible: se mueve con botones de verdad, anuncia el cambio a
 * un lector de pantalla y **no rota solo**. Un carousel que se mueve mientras
 * alguien lee es la forma más común de romper una landing.
 */
export interface Testimonial {
  quote: string;
  author: string;
  center: string;
}

export interface TestimonialsProps {
  /** Se inyectan: acá no se inventa ninguno. */
  items?: readonly Testimonial[];
}

export function Testimonials({ items = [] }: TestimonialsProps = {}) {
  const [indice, setIndice] = useState(0);

  return (
    <section id="testimonios" className="flex flex-col gap-6 py-12">
      <h2 className="text-2xl font-semibold">Lo que dicen los centros</h2>

      {items.length === 0 ? (
        <p className="text-fg-muted max-w-prose">
          Todavía no publicamos testimonios. Cuando los primeros centros quieran prestar su nombre,
          van a estar acá — con nombre y apellido, no inventados.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {/*
           * `aria-live="polite"`: al tocar la flecha, el lector de pantalla
           * anuncia el testimonio nuevo en vez de dejar a la persona sin saber
           * que algo cambió.
           */}
          <blockquote
            aria-live="polite"
            className="border-border bg-surface flex flex-col gap-3 rounded-lg border p-6"
          >
            <p className="text-lg">{items[indice]?.quote}</p>
            <footer className="text-fg-muted text-sm">
              {items[indice]?.author} · {items[indice]?.center}
            </footer>
          </blockquote>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIndice((actual) => (actual - 1 + items.length) % items.length)}
              className="border-border hover:bg-surface-2 focus-visible:focus-ring flex size-11 items-center justify-center rounded-md border"
              aria-label="Testimonio anterior"
            >
              <span aria-hidden="true">‹</span>
            </button>
            <button
              type="button"
              onClick={() => setIndice((actual) => (actual + 1) % items.length)}
              className="border-border hover:bg-surface-2 focus-visible:focus-ring flex size-11 items-center justify-center rounded-md border"
              aria-label="Testimonio siguiente"
            >
              <span aria-hidden="true">›</span>
            </button>
            <p className="text-fg-muted text-sm">
              {indice + 1} de {items.length}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

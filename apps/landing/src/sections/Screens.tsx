/**
 * Las tres pantallas del producto (§5.1.4: "imágenes y detalles de las
 * interfaces").
 *
 * 🔴 No son capturas: son **maquetas dibujadas con CSS**, y se dice. Una
 * captura trucada de una pantalla que todavía no existe le promete al visitante
 * algo que no va a encontrar cuando entre. Cuando haya capturas de verdad,
 * reemplazan estas cajas sin tocar el texto.
 */
const PANTALLAS = [
  {
    id: 'dfsm',
    titulo: 'El tablero del centro',
    para: 'Para vos y tu staff',
    detalle:
      'Abrís y ves el día: las clases con su ocupación, quién entró, lo cobrado y las alertas de quién no viene hace dos semanas.',
    filas: [
      '07:00 · Funcional · 12 de 16',
      '09:00 · Pilates · 6 de 10',
      '19:00 · CrossFit · 16 de 16',
    ],
  },
  {
    id: 'wafm',
    titulo: 'La app del socio',
    para: 'Para tus socios',
    detalle:
      'Se anota, cancela y entra con su QR. Ve sus créditos y cuándo le vence el pack, sin preguntarle a nadie.',
    filas: ['Mi QR', 'Funcional · hoy 19:00 · reservado', 'Pack 8 clases · quedan 5'],
  },
  {
    id: 'kiosko',
    titulo: 'El kiosko de la entrada',
    para: 'Para la puerta',
    detalle:
      'Una tablet en la pared. El socio muestra su QR y entra: no hay planilla ni alguien anotando.',
    filas: ['Acercá tu QR', '✓ Micaela · 19:00 Funcional'],
  },
] as const;

export function Screens() {
  return (
    <section id="pantallas" className="flex flex-col gap-6 py-12">
      <header className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold">Cómo se ve</h2>
        <p className="text-fg-muted max-w-prose">
          Tres pantallas, tres personas distintas: vos, tu socio y la puerta.
        </p>
      </header>

      <ul className="grid gap-4 md:grid-cols-3">
        {PANTALLAS.map((pantalla) => (
          <li key={pantalla.id}>
            <article className="border-border bg-surface flex h-full flex-col gap-3 rounded-lg border p-5">
              <h3 className="text-lg font-semibold">{pantalla.titulo}</h3>
              <p className="text-fg-muted text-xs uppercase tracking-wide">{pantalla.para}</p>

              {/*
               * La maqueta es decorativa: lo que dice ya está en el texto de
               * al lado, así que un lector de pantalla no gana nada leyéndola.
               */}
              <div
                aria-hidden="true"
                className="border-border bg-surface-2 flex flex-col gap-1 rounded-md border p-3 font-mono text-xs"
              >
                {pantalla.filas.map((fila) => (
                  <span key={fila} className="text-fg-muted truncate">
                    {fila}
                  </span>
                ))}
              </div>

              <p className="text-fg-muted text-sm">{pantalla.detalle}</p>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}

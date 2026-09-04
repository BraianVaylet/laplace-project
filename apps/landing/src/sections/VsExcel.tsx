/**
 * La comparativa contra el competidor real (§5.1.4 `[+]`).
 *
 * 🔴 No se compara contra otro software: **se compara contra Excel y
 * WhatsApp**, que es con lo que gestiona de verdad el centro que todavía no
 * nos conoce. Poner una tabla contra tres productos que el visitante nunca
 * evaluó es contestar una pregunta que no se hizo.
 *
 * Y no dice que Excel sea malo: dice qué pasa cuando el box crece. El dueño
 * que llegó hasta acá con una planilla la hizo funcionar, y tratarlo de tonto
 * es la forma más rápida de que cierre la pestaña.
 */
const FILAS = [
  {
    que: 'Anotarse a una clase',
    excel: 'El socio escribe al WhatsApp y alguien anota',
    laplace: 'Se anota solo desde el celular, con cupo y lista de espera',
  },
  {
    que: 'Saber quién debe',
    excel: 'Revisar la planilla y acordarse de mirarla',
    laplace: 'La deuda se calcula sola y aparece en el tablero',
  },
  {
    que: 'Un pack que vence',
    excel: 'Se descubre cuando el socio ya no puede entrar',
    laplace: 'Avisa 7, 3 y 1 día antes, al socio y al centro',
  },
  {
    que: 'Cambiar el horario de una clase',
    excel: 'Un mensaje al grupo y esperar que lo lean',
    laplace: 'Les llega el aviso a los inscriptos, solo a ellos',
  },
  {
    que: 'Cerrar la caja del día',
    excel: 'Sumar a mano lo que se cobró',
    laplace: 'El arqueo sale hecho, por método de pago',
  },
] as const;

export function VsExcel() {
  return (
    <section id="comparativa" className="flex flex-col gap-6 py-12">
      <header className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold">Contra la planilla y el grupo de WhatsApp</h2>
        <p className="text-fg-muted max-w-prose">
          Si tu centro funciona así hoy, funciona: llegaste hasta acá con eso. Lo que sigue es lo
          que empieza a costar caro cuando entra el socio número cuarenta.
        </p>
      </header>

      {/* Scroll propio: la tabla no puede empujar la página a lo ancho en un teléfono. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
          <caption className="sr-only">
            Comparación entre gestionar con Excel y WhatsApp o con Laplace
          </caption>
          <thead>
            <tr className="border-border border-b">
              <th scope="col" className="py-2 pr-4 font-medium">
                Lo que pasa todos los días
              </th>
              <th scope="col" className="py-2 pr-4 font-medium">
                Con Excel y WhatsApp
              </th>
              <th scope="col" className="py-2 font-medium">
                Con Laplace
              </th>
            </tr>
          </thead>
          <tbody>
            {FILAS.map((fila) => (
              <tr key={fila.que} className="border-border border-b">
                <th scope="row" className="py-3 pr-4 font-medium">
                  {fila.que}
                </th>
                <td className="text-fg-muted py-3 pr-4">{fila.excel}</td>
                <td className="py-3">{fila.laplace}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

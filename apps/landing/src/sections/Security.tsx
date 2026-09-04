/**
 * Seguridad y privacidad (§5.1.4 `[+]`, §9).
 *
 * Está en la landing y no escondida en los términos porque es una objeción de
 * venta real: el dueño de un centro está por subir los datos de sus 200 socios
 * — incluidos datos de salud — a un sistema que no conoce.
 *
 * Cada afirmación de acá es algo que el producto **hace**, no algo que suena
 * bien. Si alguna deja de ser cierta, se borra de acá antes que del código.
 */
const PUNTOS = [
  {
    titulo: 'Tus datos son tuyos',
    detalle:
      'Los podés exportar cuando quieras, en un formato que se abre con cualquier planilla. Si te vas, te los llevás.',
  },
  {
    titulo: 'Ley 25.326',
    detalle:
      'Tratamos los datos personales según la ley argentina de protección de datos, con un acuerdo de tratamiento firmado entre tu centro y nosotros.',
  },
  {
    titulo: 'Datos de salud, solo si los querés',
    detalle:
      'La ficha de salud es opcional y la carga el socio, no vos. Nadie está obligado a dar información sensible para poder entrenar.',
  },
  {
    titulo: 'Cada centro ve lo suyo',
    detalle:
      'Los datos de tu centro están separados de los de los demás, y esa separación se verifica en cada versión con tests automáticos.',
  },
  {
    titulo: 'Nunca borramos por falta de pago',
    detalle:
      'Si dejás de pagar, la cuenta se suspende y tus socios y tu agenda siguen ahí. Volvés a pagar y volvés a entrar.',
  },
  {
    titulo: 'El acceso de soporte se avisa',
    detalle:
      'Si necesitamos entrar a tu cuenta para ayudarte, queda registrado con el motivo y te llega un aviso. Sin excepciones.',
  },
] as const;

export function Security() {
  return (
    <section id="seguridad" className="flex flex-col gap-6 py-12">
      <header className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold">Seguridad y privacidad</h2>
        <p className="text-fg-muted max-w-prose">
          Vas a subir los datos de tus socios a un sistema que todavía no conocés. Esto es lo que
          hacemos con ellos.
        </p>
      </header>

      <ul className="grid gap-4 md:grid-cols-2">
        {PUNTOS.map((punto) => (
          <li key={punto.titulo} className="border-border bg-surface rounded-lg border p-5">
            <h3 className="mb-1 font-semibold">{punto.titulo}</h3>
            <p className="text-fg-muted text-sm">{punto.detalle}</p>
          </li>
        ))}
      </ul>

      <p className="text-sm">
        <a
          href="/tratamiento-de-datos"
          className="text-brand-600 focus-visible:focus-ring underline"
        >
          Leer el acuerdo de tratamiento de datos
        </a>
      </p>
    </section>
  );
}

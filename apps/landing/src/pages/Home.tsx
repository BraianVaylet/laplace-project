import { Button, Card } from '@laplace/ui';

/**
 * Home de la landing. Las nueve secciones completas de §5.1.4 llegan con F1-26;
 * lo que ya tiene que estar es el contenido que el buscador indexa y el CTA.
 */
export function Home() {
  return (
    <>
      <section id="producto" className="flex flex-col gap-4 py-12">
        <h1 className="text-3xl font-semibold">
          La gestión de tu centro deportivo, en pesos y sin planillas
        </h1>
        <p className="text-fg-muted max-w-prose">
          Clases, reservas, packs y cobranza en un solo lugar. Para boxes de CrossFit, gimnasios,
          estudios de pilates y centros funcionales. Probalo 14 días gratis, sin tarjeta.
        </p>
        <div>
          <Button size="lg">Empezar la prueba</Button>
        </div>
      </section>

      <section id="funcionalidades" className="flex flex-col gap-4 py-8">
        <h2 className="text-xl font-semibold">Lo que resuelve</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Card title="Reservas sin WhatsApp">
            <p className="text-fg-muted text-sm">
              Tus socios se anotan solos desde el celular. Cupo, lista de espera y cancelaciones con
              reglas claras.
            </p>
          </Card>
          <Card title="Cobranza y mora">
            <p className="text-fg-muted text-sm">
              Quién está al día y quién no, calculado solo. Sin planilla y sin tener que acordarse.
            </p>
          </Card>
          <Card title="Packs y cuotas">
            <p className="text-fg-muted text-sm">
              Packs de clases, cuota mensual libre o limitada, clase suelta y clase de prueba.
            </p>
          </Card>
        </div>
      </section>

      <section id="precios" className="flex flex-col gap-4 py-8">
        <h2 className="text-xl font-semibold">Precios en pesos</h2>
        <p className="text-fg-muted max-w-prose text-sm">
          Sin exposición al dólar. Tres planes: Basic, Pro y Max. El detalle llega pronto.
        </p>
      </section>

      <section id="faq" className="flex flex-col gap-4 py-8">
        <h2 className="text-xl font-semibold">Preguntas</h2>
        <dl className="flex flex-col gap-4">
          <div>
            <dt className="font-medium">¿Necesito tarjeta para probarlo?</dt>
            <dd className="text-fg-muted text-sm">
              No. La prueba es de 14 días y no pedimos datos de pago.
            </dd>
          </div>
          <div>
            <dt className="font-medium">¿Puedo migrar mis socios desde Excel?</dt>
            <dd className="text-fg-muted text-sm">
              Sí. Se importan por CSV, con previsualización fila por fila antes de guardar nada.
            </dd>
          </div>
        </dl>
      </section>

      <section id="contacto" className="flex flex-col gap-4 py-8">
        <h2 className="text-xl font-semibold">Contacto</h2>
        <p className="text-fg-muted text-sm">El formulario llega con F1-26.</p>
      </section>
    </>
  );
}

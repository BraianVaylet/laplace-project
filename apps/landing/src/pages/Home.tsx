import { Button, Card } from '@laplace/ui';
import { ContactForm } from '../sections/ContactForm.js';
import { Pricing } from '../sections/Pricing.js';
import { Screens } from '../sections/Screens.js';
import { Security } from '../sections/Security.js';
import { Social } from '../sections/Social.js';
import { Testimonials } from '../sections/Testimonials.js';
import { VsExcel } from '../sections/VsExcel.js';

/**
 * La home de la landing: las nueve secciones de §5.1.4 más lo que agrega el
 * `[+]` — comparativa contra Excel y WhatsApp, y seguridad y privacidad.
 *
 * El orden no es decorativo: quien llega de una búsqueda quiere saber **qué
 * es**, **si le sirve**, **cuánto sale** y **si puede confiar**, en ese orden.
 * Los precios van antes de las preguntas frecuentes a propósito: el que no
 * encuentra el precio se va a buscarlo a otro lado.
 */
export function Home() {
  return (
    <>
      <section id="producto" className="flex flex-col gap-4 py-12">
        <h1 className="text-3xl font-semibold md:text-4xl">
          La gestión de tu centro deportivo, en pesos y sin planillas
        </h1>
        <p className="text-fg-muted max-w-prose text-lg">
          Clases, reservas, packs y cobranza en un solo lugar. Para boxes de CrossFit, gimnasios,
          estudios de pilates y centros funcionales.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg">Empezar la prueba</Button>
          <span className="text-fg-muted text-sm">14 días gratis · sin tarjeta</span>
        </div>
      </section>

      <section id="funcionalidades" className="flex flex-col gap-6 py-12">
        <header className="flex flex-col gap-2">
          <h2 className="text-2xl font-semibold">Lo que resuelve</h2>
          <p className="text-fg-muted max-w-prose">
            No es un sistema para llenar. Es lo que hoy hacés a mano, hecho solo.
          </p>
        </header>

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
          <Card title="Check-in con QR">
            <p className="text-fg-muted text-sm">
              El socio muestra su código y entra. Sin planilla en la puerta ni alguien anotando.
            </p>
          </Card>
          <Card title="Avisos que salen solos">
            <p className="text-fg-muted text-sm">
              Confirmación de reserva, recordatorio de clase, pack por vencer y aviso de deuda. Sin
              que nadie los escriba.
            </p>
          </Card>
          <Card title="El día, de un vistazo">
            <p className="text-fg-muted text-sm">
              Las clases de hoy, quién entró, lo cobrado y quién no viene hace dos semanas.
            </p>
          </Card>
        </div>
      </section>

      <VsExcel />
      <Screens />
      <Pricing />
      <Testimonials />

      <section id="faq" className="flex flex-col gap-6 py-12">
        <h2 className="text-2xl font-semibold">Preguntas</h2>
        <dl className="flex flex-col gap-5">
          <div>
            <dt className="font-medium">¿Necesito tarjeta para probarlo?</dt>
            <dd className="text-fg-muted text-sm">
              No. La prueba es de 14 días y no pedimos datos de pago. Si al final no te sirve, no
              hacés nada.
            </dd>
          </div>
          <div>
            <dt className="font-medium">¿Puedo migrar mis socios desde Excel?</dt>
            <dd className="text-fg-muted text-sm">
              Sí. Se importan por CSV, con previsualización fila por fila antes de guardar nada.
            </dd>
          </div>
          <div>
            <dt className="font-medium">¿Qué pasa si un mes no puedo pagar?</dt>
            <dd className="text-fg-muted text-sm">
              La cuenta se suspende, pero tus socios y tu agenda siguen ahí. Nunca borramos por
              falta de pago.
            </dd>
          </div>
          <div>
            <dt className="font-medium">¿Mis socios tienen que bajar una app?</dt>
            <dd className="text-fg-muted text-sm">
              No. Entran desde el navegador del celular y, si quieren, la agregan a la pantalla de
              inicio como cualquier app.
            </dd>
          </div>
          <div>
            <dt className="font-medium">¿Sirve si tengo más de una sede?</dt>
            <dd className="text-fg-muted text-sm">
              Sí. Cada sede tiene su agenda, su caja y sus métricas, y el staff puede tener acceso a
              una sola.
            </dd>
          </div>
        </dl>
      </section>

      <Security />
      <Social />
      <ContactForm />
    </>
  );
}

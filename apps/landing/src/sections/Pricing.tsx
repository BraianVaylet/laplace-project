import { LANDING_PLANS, formatArs } from '@laplace/schemas';
import { Badge, Button } from '@laplace/ui';

/**
 * Los precios (§5.1.4).
 *
 * 🔴 **Se prerenderizan.** El número tiene que estar en el HTML servido: quien
 * llega desde una búsqueda compara precios antes de tocar nada, y un precio que
 * aparece después de un `fetch` no lo ve ni el visitante apurado ni el buscador
 * (ADR-005).
 *
 * En pesos y sin asterisco: la competencia cotiza en dólares, y para un centro
 * argentino eso significa no saber cuánto va a pagar el mes que viene.
 */
export function Pricing() {
  return (
    <section id="precios" className="flex flex-col gap-6 py-12">
      <header className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold">Precios en pesos</h2>
        <p className="text-fg-muted max-w-prose">
          Sin dólares y sin sorpresas. Los tres planes incluyen socios, clases, reservas y cobranza:
          lo que cambia es cuánto crecés.
        </p>
      </header>

      <ul className="grid gap-4 md:grid-cols-3">
        {LANDING_PLANS.map((plan) => (
          <li key={plan.planId}>
            <article
              className={[
                'border-border bg-surface flex h-full flex-col gap-4 rounded-lg border p-5',
                plan.featured ? 'border-brand-600 border-2' : '',
              ].join(' ')}
            >
              <header className="flex items-center justify-between gap-2">
                <h3 className="text-lg font-semibold">{plan.name}</h3>
                {plan.featured ? <Badge tone="brand">El más elegido</Badge> : null}
              </header>

              <p className="flex items-baseline gap-1">
                <span className="text-3xl font-semibold">{formatArs(plan.priceCents)}</span>
                <span className="text-fg-muted text-sm">por mes</span>
              </p>

              <p className="text-fg-muted text-sm">{plan.description}</p>

              <ul className="flex flex-col gap-1 text-sm">
                {plan.highlights.map((highlight) => (
                  <li key={highlight} className="flex gap-2">
                    <span aria-hidden="true">·</span>
                    {highlight}
                  </li>
                ))}
              </ul>

              <div className="mt-auto">
                <Button variant={plan.featured ? 'primary' : 'secondary'} className="w-full">
                  Probar 14 días
                </Button>
              </div>
            </article>
          </li>
        ))}
      </ul>

      <p className="text-fg-muted text-sm">
        Todos arrancan con 14 días de prueba, sin tarjeta. Si cambiás de plan, pagás la diferencia
        por los días que quedan del mes, no el mes entero.
      </p>
    </section>
  );
}

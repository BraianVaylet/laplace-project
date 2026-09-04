import { useState, type FormEvent } from 'react';
import { contactRequestSchema, type ContactRequestInput } from '@laplace/schemas';
import { ApiRequestError, type ApiClient } from '@laplace/client';
import { Button, FormField, Input, Textarea } from '@laplace/ui';
import { api } from '../api.js';

/**
 * El formulario de contacto (§5.1.4).
 *
 * Valida con el **mismo schema que el servidor** (ADR-003): nadie ve acá un
 * error que el otro lado no explicó igual, ni al revés.
 *
 * 🔴 La defensa contra bots es un campo escondido, no un captcha. Un captcha le
 * cobra el costo al humano — le hace resolver un rompecabezas para poder
 * escribirnos — y quien quiere escribirnos es exactamente la persona que no
 * queremos perder.
 */
export interface ContactFormProps {
  client?: ApiClient;
}

type Errores = Partial<Record<keyof ContactRequestInput, string>>;

export function ContactForm({ client = api }: ContactFormProps = {}) {
  const [errores, setErrores] = useState<Errores>({});
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  const enviar = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFallo(null);

    const datos = Object.fromEntries(new FormData(event.currentTarget));
    const parsed = contactRequestSchema.safeParse({ ...datos, source: 'landing' });

    if (!parsed.success) {
      setErrores(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
        ),
      );

      return;
    }

    setErrores({});
    setEnviando(true);

    try {
      await client.post('/contact', parsed.data);
      setEnviado(true);
    } catch (error) {
      setFallo(
        error instanceof ApiRequestError
          ? error.message
          : 'No pudimos enviar el mensaje. Probá de nuevo o escribinos por mail.',
      );
    } finally {
      setEnviando(false);
    }
  };

  if (enviado) {
    return (
      <section id="contacto" className="flex flex-col gap-4 py-12">
        <h2 className="text-2xl font-semibold">Gracias</h2>
        <p className="text-fg-muted max-w-prose">
          Recibimos tu mensaje. Te contestamos por mail, normalmente el mismo día.
        </p>
      </section>
    );
  }

  return (
    <section id="contacto" className="flex flex-col gap-6 py-12">
      <header className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold">Escribinos</h2>
        <p className="text-fg-muted max-w-prose">
          ¿Dudas antes de probarlo? Contanos cómo funciona tu centro y te decimos si te sirve.
        </p>
      </header>

      <form onSubmit={enviar} noValidate className="flex max-w-xl flex-col gap-4">
        <FormField label="Tu nombre" {...(errores.name ? { error: errores.name } : {})}>
          <Input name="name" autoComplete="name" required />
        </FormField>

        <FormField label="Tu mail" {...(errores.email ? { error: errores.email } : {})}>
          <Input name="email" type="email" autoComplete="email" required />
        </FormField>

        <FormField
          label="Tu teléfono"
          description="Opcional. Si lo dejás, te podemos llamar."
          {...(errores.phone ? { error: errores.phone } : {})}
        >
          <Input name="phone" type="tel" autoComplete="tel" />
        </FormField>

        <FormField
          label="Tu centro"
          description="Opcional."
          {...(errores.centerName ? { error: errores.centerName } : {})}
        >
          <Input name="centerName" />
        </FormField>

        <FormField label="Tu mensaje" {...(errores.message ? { error: errores.message } : {})}>
          <Textarea name="message" required />
        </FormField>

        {/*
         * 🔴 La trampa. Escondida con `hidden` y fuera del orden de tabulación:
         * una persona no la ve ni la puede tabular, un robot que completa todo
         * lo que encuentra sí. `autoComplete="off"` evita que el navegador la
         * rellene solo y convierta a un humano en sospechoso.
         */}
        <div hidden aria-hidden="true">
          <label htmlFor="website">No completes este campo</label>
          <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
        </div>

        {fallo ? (
          <p role="alert" className="text-danger-500 text-sm">
            {fallo}
          </p>
        ) : null}

        <div>
          <Button type="submit" disabled={enviando}>
            {enviando ? 'Enviando…' : 'Enviar'}
          </Button>
        </div>
      </form>
    </section>
  );
}

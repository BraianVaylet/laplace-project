import { useCallback, useEffect, useRef, useState } from 'react';
import { Temporal } from '@js-temporal/polyfill';
import { createOfflineQueue, localStorageQueue, type ApiClient } from '@laplace/client';
import { Badge, Card } from '@laplace/ui';
import { api } from './api.js';

/**
 * El tablet-kiosko de la puerta (§2.1.18).
 *
 * No lee la cámara: un lector de QR de hardware "escribe" el código en el
 * input enfocado y manda un Enter, como un lector de código de barras. Es el
 * mismo patrón que cualquier kiosko de retail, y no depende de una librería de
 * cámara ni de permisos del navegador.
 *
 * 🔴 **Sin red no se cae.** El WiFi del gimnasio es el peor lugar para
 * depender de la conexión: la tablet está lejos del router, y cuando se corta
 * hay gente esperando para entrar. Cada escaneo se encola **antes** de
 * intentar mandarlo (`@laplace/client`'s `createOfflineQueue`), así que un
 * corte a mitad de camino no pierde el check-in — y el reintento lleva la
 * misma clave de idempotencia, así que tampoco lo duplica.
 */
export interface KioskProps {
  client?: ApiClient;
}

interface Resultado {
  id: number;
  estado: 'ok' | 'encolado' | 'error';
  mensaje: string;
}

let contador = 0;

export function Kiosk({ client = api }: KioskProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [enLinea, setEnLinea] = useState(() => navigator.onLine);
  const [pendientes, setPendientes] = useState(0);
  const [ultimos, setUltimos] = useState<Resultado[]>([]);

  const anotar = useCallback((estado: Resultado['estado'], mensaje: string) => {
    setUltimos((previos) => [{ id: ++contador, estado, mensaje }, ...previos].slice(0, 5));
  }, []);

  const cola = useRef(
    createOfflineQueue({
      storage: localStorageQueue('laplace.kiosk.queue'),
      send: (item) => client.post(item.path, item.body, { idempotencyKey: item.idempotencyKey }),
      now: () => Temporal.Now.instant().toString(),
      onDropped: (_item, reason) => {
        anotar(
          'error',
          reason === 'rejected'
            ? 'Un código no se pudo registrar: pedile a la persona que muestre uno nuevo.'
            : 'No se pudo sincronizar un escaneo después de varios intentos.',
        );
      },
    }),
  ).current;

  const sincronizar = useCallback(async () => {
    const resultado = await cola.flush();
    setPendientes(cola.pending().length);

    if (resultado.sent > 0) {
      anotar(
        'ok',
        `Se sincronizaron ${resultado.sent} check-in${resultado.sent === 1 ? '' : 's'} pendientes.`,
      );
    }
  }, [cola, anotar]);

  useEffect(() => {
    setPendientes(cola.pending().length);
    // Lo que haya quedado de la última visita se intenta mandar apenas se
    // abre la pantalla: no hay que esperar a que se corte la red de nuevo.
    void sincronizar();

    const alVolver = () => {
      setEnLinea(true);
      void sincronizar();
    };
    const alPerder = () => setEnLinea(false);

    window.addEventListener('online', alVolver);
    window.addEventListener('offline', alPerder);

    // El lector de la puerta necesita el foco puesto para "escribir" el código.
    inputRef.current?.focus();

    return () => {
      window.removeEventListener('online', alVolver);
      window.removeEventListener('offline', alPerder);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- corre una sola vez al montar; `sincronizar` es estable.
  }, []);

  const escanear = async (token: string) => {
    cola.enqueue({ path: '/check-in-tokens/redeem', body: { token } });
    setPendientes(cola.pending().length);

    const resultado = await cola.flush();
    setPendientes(cola.pending().length);

    if (resultado.sent > 0) anotar('ok', 'Check-in registrado.');
    else if (resultado.pending > 0)
      anotar('encolado', 'Sin conexión: se va a registrar apenas vuelva el WiFi.');
    // Si quedó en 0/0/dropped, `onDropped` ya avisó el motivo.
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6">
      <Badge tone={enLinea ? 'success' : 'warning'}>{enLinea ? 'Conectado' : 'Sin conexión'}</Badge>

      <h1 className="text-fg text-2xl font-semibold">Escaneá tu QR</h1>

      <form
        className="w-full max-w-sm"
        onSubmit={(event) => {
          event.preventDefault();
          const valor = inputRef.current?.value.trim();
          if (!valor) return;

          void escanear(valor);
          if (inputRef.current) inputRef.current.value = '';
        }}
      >
        <label className="sr-only" htmlFor="kiosk-token">
          Código escaneado
        </label>
        {/*
         * Sin autocompletar y sin corrección: es un input hecho para que un
         * lector de hardware lo llene, no para que una persona lo tipee letra
         * por letra.
         */}
        <input
          id="kiosk-token"
          ref={inputRef}
          type="text"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className="border-border bg-surface text-fg h-14 w-full rounded-md border px-4 text-center text-lg"
          onBlur={() => inputRef.current?.focus()}
        />
      </form>

      {pendientes > 0 && (
        <p className="text-fg-muted text-sm">
          {pendientes} escaneo{pendientes === 1 ? '' : 's'} esperando para sincronizar.
        </p>
      )}

      {ultimos.length > 0 && (
        <Card className="w-full max-w-sm">
          <ul className="flex flex-col gap-2" aria-label="Últimos escaneos">
            {ultimos.map((item) => (
              <li key={item.id} className="flex items-center gap-2 text-sm">
                <Badge
                  tone={
                    item.estado === 'ok'
                      ? 'success'
                      : item.estado === 'encolado'
                        ? 'warning'
                        : 'danger'
                  }
                >
                  {item.estado === 'ok'
                    ? 'Listo'
                    : item.estado === 'encolado'
                      ? 'En cola'
                      : 'Error'}
                </Badge>
                <span className="text-fg-muted truncate">{item.mensaje}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

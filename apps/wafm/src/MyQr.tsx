import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { Temporal } from '@js-temporal/polyfill';
import type { QrToken } from '@laplace/schemas';
import { ApiRequestError, type ApiClient } from '@laplace/client';
import { Card, ErrorState, Skeleton } from '@laplace/ui';
import { api } from './api.js';

/**
 * "Mi QR" (§2.1.18): el código que el socio le muestra a la tablet de la
 * puerta. Vale **30 segundos y un solo uso**, así que se renueva solo mientras
 * la pantalla queda abierta — nadie tiene que tocar "actualizar" antes de
 * entrar.
 *
 * Es la pantalla en 1 tap desde el home (§2.1.18): no pide nada, no confirma
 * nada, se abre y ya está mostrando el código.
 *
 * El QR se dibuja con `<rect>` de React a partir de la matriz de módulos, y no
 * inyectando el SVG que devuelve la librería como HTML: el string generado no
 * pasa por ningún parser de marcado, así que no hay superficie de inyección
 * que auditar.
 */
export interface MyQrProps {
  /**
   * El cliente de API. Se inyecta para poder probar la pantalla sin red: el
   * singleton de `api.ts` captura el `fetch` del entorno al crearse, así que
   * sustituirlo después no alcanzaría.
   */
  client?: ApiClient;
}

interface QrMatrix {
  size: number;
  /** `true` = módulo oscuro, en el mismo orden que `BitMatrix.data`. */
  dark: boolean[];
}

export function MyQr({ client = api }: MyQrProps) {
  const [segundosRestantes, setSegundosRestantes] = useState(0);

  const token = useQuery({
    queryKey: ['check-in-token'],
    queryFn: () => client.post<QrToken>('/check-in-tokens'),
    // Nunca se sirve del caché: cada apertura de la pantalla tiene que pedir un
    // token nuevo, porque el de la vez anterior ya venció hace rato.
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  const matrix = useMemo<QrMatrix | null>(() => {
    if (!token.data) return null;

    const { modules } = QRCode.create(token.data.token, { errorCorrectionLevel: 'M' });
    const dark: boolean[] = [];
    for (let row = 0; row < modules.size; row++) {
      for (let col = 0; col < modules.size; col++) dark.push(Boolean(modules.get(row, col)));
    }

    return { size: modules.size, dark };
  }, [token.data]);

  // Cuenta atrás y pide un token nuevo apenas este vence: es lo que hace que
  // "se renueva solo" sea cierto y no una promesa vacía.
  useEffect(() => {
    if (!token.data) return;

    const vence = Temporal.Instant.from(token.data.expiresAt);
    const tick = () => {
      const restantes = Math.ceil(vence.since(Temporal.Now.instant()).total({ unit: 'seconds' }));
      setSegundosRestantes(Math.max(0, restantes));
      if (restantes <= 0) void token.refetch();
    };

    tick();
    const id = setInterval(tick, 1000);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `token.refetch` es estable entre renders; agregarlo reinicia el timer en cada tick.
  }, [token.data]);

  if (token.isPending) {
    return (
      <div
        className="flex flex-col items-center gap-4"
        aria-busy="true"
        aria-label="Generando tu QR"
      >
        <Skeleton className="h-64 w-64" />
      </div>
    );
  }

  if (token.isError) {
    return (
      <ErrorState
        title="No pudimos generar tu QR"
        message={mensajeDe(token.error)}
        onRetry={() => void token.refetch()}
        {...accionDe(token.error)}
      />
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <Card className="flex flex-col items-center gap-3 p-6">
        {/*
         * El fondo es blanco fijo, no del tema: un lector de QR necesita
         * contraste alto y un margen claro alrededor del código, y en modo
         * oscuro un QR sobre `bg-surface` puede no tener ninguno.
         */}
        <div
          role="img"
          aria-label="Código QR para tu check-in"
          className="h-56 w-56 rounded-md bg-white p-2"
        >
          {matrix && (
            <svg
              viewBox={`0 0 ${matrix.size} ${matrix.size}`}
              className="h-full w-full"
              shapeRendering="crispEdges"
            >
              {matrix.dark.map((esOscuro, index) =>
                esOscuro ? (
                  <rect
                    key={index}
                    x={index % matrix.size}
                    y={Math.floor(index / matrix.size)}
                    width={1}
                    height={1}
                    fill="#000"
                  />
                ) : null,
              )}
            </svg>
          )}
        </div>
        <p className="text-fg-muted text-sm" aria-hidden="true">
          {segundosRestantes > 0 ? `Se renueva en ${segundosRestantes}s` : 'Renovando…'}
        </p>
      </Card>
      <p className="text-fg-muted max-w-prose text-center text-sm">
        Mostrale este código a la tablet de la entrada. Se renueva solo, así que no hace falta que
        hagas nada más.
      </p>
    </div>
  );
}

/** El mensaje del envelope §5.0, o uno genérico si ni siquiera hubo respuesta. */
function mensajeDe(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;

  return 'Revisá la conexión y volvé a intentar.';
}

/** Qué puede hacer el usuario. Sale del `action` del envelope (§5.0). */
function accionDe(error: unknown) {
  return error instanceof ApiRequestError && error.action ? { action: error.action } : {};
}

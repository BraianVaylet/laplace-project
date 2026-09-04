import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MemberSearchHit } from '@laplace/schemas';
import { ApiRequestError, type ApiClient } from '@laplace/client';
import { Input } from '@laplace/ui';
import { api } from './api.js';

/**
 * El buscador global del DFSM (§5.1.2).
 *
 * Se abre con **⌘K / Ctrl+K** porque quien atiende el mostrador tiene las manos
 * en el teclado y a alguien esperando del otro lado: soltar el teclado, buscar
 * el mouse y apuntar a un campo es exactamente el tiempo que no hay.
 *
 * Busca por nombre, documento o teléfono — las tres formas en las que una
 * persona se identifica en un mostrador.
 */
export interface MemberSearchProps {
  client?: ApiClient;
  /** Qué hacer con el socio elegido. Lo decide quien monta el buscador. */
  onPick?: (member: MemberSearchHit) => void;
}

/** Menos de dos letras no busca: con una sola, el resultado es el padrón entero. */
const MIN_TERM = 2;

export function MemberSearch({ client = api, onPick }: MemberSearchProps = {}) {
  const [abierto, setAbierto] = useState(false);
  const [termino, setTermino] = useState('');
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const atajo = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setAbierto(true);
      }
      if (event.key === 'Escape') setAbierto(false);
    };

    window.addEventListener('keydown', atajo);

    return () => window.removeEventListener('keydown', atajo);
  }, []);

  // El foco va al campo al abrir: abrirlo y tener que hacer clic adentro sería
  // el mismo problema que el atajo vino a resolver.
  useEffect(() => {
    if (abierto) campo.current?.focus();
  }, [abierto]);

  const busqueda = useQuery({
    queryKey: ['member-search', termino],
    queryFn: () =>
      client.get<MemberSearchHit[]>(`/members/search?q=${encodeURIComponent(termino)}`),
    enabled: abierto && termino.trim().length >= MIN_TERM,
  });

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="border-border bg-surface-2 text-fg-muted hover:bg-surface-3 focus-visible:focus-ring flex h-11 items-center gap-2 rounded-md border px-3 text-sm"
      >
        Buscar socio
        <kbd className="border-border rounded border px-1 text-xs">Ctrl K</kbd>
      </button>
    );
  }

  const resultados = busqueda.data ?? [];

  return (
    <div className="relative">
      <label>
        <span className="sr-only">Buscar socio por nombre, documento o teléfono</span>
        <Input
          ref={campo}
          value={termino}
          onChange={(event) => setTermino(event.currentTarget.value)}
          onBlur={() => setAbierto(false)}
          placeholder="Nombre, documento o teléfono"
          aria-label="Buscar socio"
        />
      </label>

      {termino.trim().length >= MIN_TERM && (
        <ul
          aria-label="Resultados"
          className="border-border bg-surface-2 absolute z-10 mt-1 flex w-full flex-col rounded-md border shadow-lg"
        >
          {busqueda.isError && (
            <li className="text-fg-muted px-3 py-2 text-sm">{mensajeDe(busqueda.error)}</li>
          )}
          {!busqueda.isError && resultados.length === 0 && !busqueda.isPending && (
            <li className="text-fg-muted px-3 py-2 text-sm">Nadie con ese nombre.</li>
          )}
          {resultados.map((socio) => (
            <li key={socio.memberId}>
              {/*
                Sin `onPick`, el resultado es un **enlace a su ficha**: es lo
                que se espera de un buscador, y de paso se puede abrir en otra
                pestaña o copiar. Con `onPick`, decide quien lo monta.
              */}
              {onPick ? (
                <button
                  type="button"
                  // `onMouseDown` y no `onClick`: el `onBlur` del campo cierra
                  // la lista antes de que el clic llegue a soltarse.
                  onMouseDown={() => onPick(socio)}
                  className="hover:bg-surface-3 focus-visible:focus-ring flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left"
                >
                  <span className="text-fg text-sm font-medium">{socio.fullName}</span>
                  <span className="text-fg-muted text-sm">{socio.hint}</span>
                </button>
              ) : (
                <a
                  href={`/miembros/${socio.memberId}`}
                  className="hover:bg-surface-3 focus-visible:focus-ring flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left"
                >
                  <span className="text-fg text-sm font-medium">{socio.fullName}</span>
                  <span className="text-fg-muted text-sm">{socio.hint}</span>
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function mensajeDe(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;

  return 'No pudimos buscar. Revisá la conexión.';
}

import { useUiStore } from '@laplace/client';

export interface Venue {
  id: string;
  name: string;
}

/**
 * Selector de centro del header (§5.1.2).
 *
 * **Aparece solo cuando hay mas de uno.** Con una sola sede — el 90% de los
 * casos — un desplegable con una opcion es ruido que ocupa lugar y sugiere una
 * decision que no existe.
 *
 * El centro elegido persiste entre recargas: es el contexto con el que se opera,
 * y volver a elegirlo en cada visita es de las cosas que mas molestan.
 */
export function VenueSelector({ venues }: { venues: readonly Venue[] }) {
  const { activeVenueId, setActiveVenueId } = useUiStore();

  if (venues.length < 2) return null;

  return (
    <label className="text-sm">
      <span className="sr-only">Centro activo</span>
      <select
        value={activeVenueId ?? venues[0]?.id}
        onChange={(event) => setActiveVenueId(event.target.value)}
        className="bg-surface-2 border-border text-fg focus-visible:focus-ring h-11 rounded-md border px-3"
      >
        {venues.map((venue) => (
          <option key={venue.id} value={venue.id}>
            {venue.name}
          </option>
        ))}
      </select>
    </label>
  );
}

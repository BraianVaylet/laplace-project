import { create, type StateCreator } from 'zustand';

/**
 * Zustand es **solo estado de UI** (spec §6): sidebar, modales, filtros no
 * urleables, el Venue activo.
 *
 * La frontera esta escrita en la spec porque duplicar estado de servidor aca
 * genera bugs de sincronizacion imposibles de rastrear: dos fuentes de verdad
 * para el mismo dato y ninguna forma de saber cual quedo vieja.
 *
 * - Estado del servidor → Tanstack Query
 * - Filtros que van en la URL → Nuqs
 * - Lo demas → aca
 */
export function createUiStore<T>(initializer: StateCreator<T>) {
  return create<T>(initializer);
}

export interface UiState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;

  /** El centro con el que se esta operando. Persiste entre recargas (§5.1.2). */
  activeVenueId: string | null;
  setActiveVenueId: (venueId: string | null) => void;
}

const ACTIVE_VENUE_KEY = 'laplace.activeVenue';
const SIDEBAR_KEY = 'laplace.sidebarCollapsed';

function read(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, value);
  } catch {
    // Modo privado o cookies bloqueadas: no persiste, pero no rompe.
  }
}

export const useUiStore = createUiStore<UiState>((set) => ({
  sidebarCollapsed: read(SIDEBAR_KEY) === 'true',
  toggleSidebar: () =>
    set((state) => {
      const next = !state.sidebarCollapsed;
      write(SIDEBAR_KEY, String(next));
      return { sidebarCollapsed: next };
    }),
  setSidebarCollapsed: (collapsed) => {
    write(SIDEBAR_KEY, String(collapsed));
    set({ sidebarCollapsed: collapsed });
  },

  activeVenueId: read(ACTIVE_VENUE_KEY),
  setActiveVenueId: (venueId) => {
    write(ACTIVE_VENUE_KEY, venueId);
    set({ activeVenueId: venueId });
  },
}));

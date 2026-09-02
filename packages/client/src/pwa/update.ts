/**
 * Aviso de actualización de la PWA (§5.1.3).
 *
 * La v1 pide un popup **bloqueante**: no se puede cerrar hasta actualizar. Es
 * aceptable, y el `[+]` agrega la condición sin la cual es peligroso: **un
 * escape a los 30 segundos**.
 *
 * El motivo es concreto. El popup se cierra cuando el service worker nuevo toma
 * control. Si el SW falla — y falla más seguido de lo que uno quisiera — el
 * usuario queda encerrado en un cartel, sin poder reservar, sin poder hacer
 * nada, y sin entender por qué. El escape convierte un bug de service worker en
 * una molestia de treinta segundos.
 */
export const UPDATE_ESCAPE_MS = 30_000;

export type UpdateState =
  | { status: 'idle' }
  | { status: 'available' }
  /** Aplicando: el popup no se puede cerrar todavía. */
  | { status: 'updating'; startedAt: number }
  /** Se pasó el plazo: se habilita el escape. */
  | { status: 'stuck'; startedAt: number };

export interface UpdateController {
  /** Lo llama el registro del service worker cuando hay una versión nueva. */
  onAvailable(): void;
  /** Lo dispara el botón "Actualizar". */
  apply(now: number): void;
  /** Se evalúa con un temporizador mientras está en `updating`. */
  tick(now: number): void;
  state(): UpdateState;
  /**
   * `true` si el popup puede cerrarse. Es `false` mientras la actualización va
   * bien, y `true` recién cuando se pasó el plazo.
   */
  canDismiss(): boolean;
  dismiss(): void;
}

export interface UpdateControllerDeps {
  /** Aplica la actualización: `skipWaiting()` + `clients.claim()`. */
  activate: () => void | Promise<void>;
  onChange?: (state: UpdateState) => void;
  escapeMs?: number;
}

export function createUpdateController({
  activate,
  onChange,
  escapeMs = UPDATE_ESCAPE_MS,
}: UpdateControllerDeps): UpdateController {
  let state: UpdateState = { status: 'idle' };

  const set = (next: UpdateState) => {
    state = next;
    onChange?.(next);
  };

  return {
    onAvailable() {
      if (state.status === 'idle') set({ status: 'available' });
    },

    apply(now) {
      if (state.status !== 'available') return;
      set({ status: 'updating', startedAt: now });
      void activate();
    },

    tick(now) {
      if (state.status !== 'updating') return;
      if (now - state.startedAt >= escapeMs) set({ status: 'stuck', startedAt: state.startedAt });
    },

    state() {
      return state;
    },

    canDismiss() {
      // Bloqueante mientras hay algo que actualizar y el SW responde. Cuando se
      // pasa el plazo, el usuario recupera el control.
      return state.status === 'idle' || state.status === 'stuck';
    },

    dismiss() {
      if (state.status === 'stuck') set({ status: 'idle' });
    },
  };
}

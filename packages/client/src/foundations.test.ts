import { afterEach, describe, expect, it } from 'vitest';
import { ApiRequestError, NetworkError } from './api/client.js';
import { commonMessages, createTranslator } from './i18n/index.js';
import { createQueryClient } from './query/client.js';
import { useUiStore } from './state/store.js';

describe('i18n', () => {
  const t = createTranslator({
    'booking.full': 'La clase está completa.',
    'booking.confirmed': 'Reservaste {clase} para el {fecha}.',
    'credits.left': 'Te quedan {n} clases.',
  }).t;

  it('traduce una clave', () => {
    expect(t('booking.full')).toBe('La clase está completa.');
  });

  it('interpola valores', () => {
    expect(t('booking.confirmed', { clase: 'Funcional', fecha: '15/03' })).toBe(
      'Reservaste Funcional para el 15/03.',
    );
  });

  it('interpola numeros', () => {
    expect(t('credits.left', { n: 3 })).toBe('Te quedan 3 clases.');
  });

  it('una clave que falta devuelve la clave, no una pantalla en blanco ni un crash', () => {
    // Un texto feo se ve y se arregla; una pantalla vacia o un error, no.
    expect(t('no.existe')).toBe('no.existe');
  });

  it('una variable que falta deja el placeholder, no un "undefined" en pantalla', () => {
    expect(t('credits.left', {})).toBe('Te quedan {n} clases.');
  });

  it('sin variables devuelve la plantilla tal cual', () => {
    expect(t('credits.left')).toBe('Te quedan {n} clases.');
  });

  it('el locale por default es es-AR', () => {
    expect(createTranslator({}).locale).toBe('es-AR');
  });

  it('los textos transversales estan y son strings no vacios', () => {
    const vacios = Object.entries(commonMessages).filter(([, value]) => value.trim().length === 0);

    expect(vacios).toEqual([]);
    expect(Object.keys(commonMessages).length).toBeGreaterThan(10);
  });

  it('el texto de soporte incluye el hueco del codigo de error', () => {
    expect(commonMessages['state.error.support']).toContain('{code}');
  });
});

describe('defaults de Tanstack Query', () => {
  const retryOf = (client: ReturnType<typeof createQueryClient>) =>
    client.getDefaultOptions().queries?.retry as (count: number, error: Error) => boolean;

  const apiError = (status: number) =>
    new ApiRequestError({
      code: 'LP-BOOK-409-002',
      status,
      message: 'x',
      requestId: 'r',
      timestamp: 't',
    });

  it('no reintenta un 409: la clase va a seguir llena la segunda vez', () => {
    expect(retryOf(createQueryClient())(0, apiError(409))).toBe(false);
  });

  it('no reintenta un 403: los permisos no cambian por insistir', () => {
    expect(retryOf(createQueryClient())(0, apiError(403))).toBe(false);
  });

  it('reintenta un 500, que si puede ser pasajero', () => {
    expect(retryOf(createQueryClient())(0, apiError(500))).toBe(true);
  });

  it('reintenta un 429, pero no para siempre', () => {
    const retry = retryOf(createQueryClient());

    expect(retry(0, apiError(429))).toBe(true);
    expect(retry(5, apiError(429))).toBe(false);
  });

  it('reintenta un corte de red: el socio esta en el sotano del gimnasio', () => {
    const retry = retryOf(createQueryClient());

    expect(retry(0, new NetworkError('req-1'))).toBe(true);
    expect(retry(9, new NetworkError('req-1'))).toBe(false);
  });

  it('un error desconocido no se reintenta', () => {
    expect(retryOf(createQueryClient())(0, new Error('cualquier cosa'))).toBe(false);
  });

  it('las mutaciones NO se reintentan solas: duplicarian una reserva o un cobro', () => {
    expect(createQueryClient().getDefaultOptions().mutations?.retry).toBe(false);
  });

  it('los datos quedan frescos un rato: sin eso parpadea al cambiar de pestaña', () => {
    expect(createQueryClient().getDefaultOptions().queries?.staleTime).toBeGreaterThan(0);
  });
});

describe('estado de UI en Zustand', () => {
  afterEach(() => {
    globalThis.localStorage?.clear();
    useUiStore.setState({ sidebarCollapsed: false, activeVenueId: null });
  });

  it('el sidebar arranca desplegado', () => {
    expect(useUiStore.getState().sidebarCollapsed).toBe(false);
  });

  it('se pliega y se despliega', () => {
    useUiStore.getState().toggleSidebar();
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);

    useUiStore.getState().toggleSidebar();
    expect(useUiStore.getState().sidebarCollapsed).toBe(false);
  });

  it('el estado del sidebar se recuerda: plegarlo en cada visita es molesto', () => {
    useUiStore.getState().setSidebarCollapsed(true);

    expect(globalThis.localStorage.getItem('laplace.sidebarCollapsed')).toBe('true');
  });

  it('el Venue activo se guarda: es el contexto con el que se opera (§5.1.2)', () => {
    useUiStore.getState().setActiveVenueId('ven_centro');

    expect(useUiStore.getState().activeVenueId).toBe('ven_centro');
    expect(globalThis.localStorage.getItem('laplace.activeVenue')).toBe('ven_centro');
  });

  it('poner el Venue en null lo borra en vez de guardar la cadena "null"', () => {
    useUiStore.getState().setActiveVenueId('ven_centro');
    useUiStore.getState().setActiveVenueId(null);

    expect(globalThis.localStorage.getItem('laplace.activeVenue')).toBeNull();
  });

  it('solo guarda estado de UI: no hay lugar para datos del servidor', () => {
    // La frontera de §6: Query = servidor, Zustand = UI. Si aparece un campo
    // como `members` o `bookings` aca, algo se cruzo de lado.
    const keys = Object.keys(useUiStore.getState()).filter(
      (key) => typeof useUiStore.getState()[key as never] !== 'function',
    );

    expect(keys.sort()).toEqual(['activeVenueId', 'sidebarCollapsed']);
  });
});

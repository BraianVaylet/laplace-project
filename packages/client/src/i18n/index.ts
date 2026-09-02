/**
 * i18n desde el dia 1, aunque hoy solo haya es-AR (spec §3.1).
 *
 * No es especulacion: agregarlo despues obliga a revisar cada string de las
 * cuatro apps, que es exactamente el trabajo que esto evita. Lo que si se evita
 * es traer una libreria de i18n completa para un solo idioma — cuando entre el
 * segundo, esta interfaz se reemplaza sin tocar las pantallas.
 */
export type Locale = 'es-AR';

export const DEFAULT_LOCALE: Locale = 'es-AR';

/** Diccionario plano. Las claves son jerarquicas por convencion: `booking.full`. */
export type Messages = Record<string, string>;

export interface Translator {
  /** Traduce, interpolando `{clave}`. Si falta la clave, devuelve la clave. */
  t: (key: string, values?: Record<string, string | number>) => string;
  locale: Locale;
}

export function createTranslator(messages: Messages, locale: Locale = DEFAULT_LOCALE): Translator {
  return {
    locale,
    t(key, values) {
      /*
       * Falta la clave: se devuelve la clave misma, no un string vacio ni una
       * excepcion. Un texto feo en pantalla se ve y se arregla; una pantalla en
       * blanco o un crash, no.
       */
      const template = messages[key] ?? key;

      if (!values) return template;

      return template.replace(/\{(\w+)\}/g, (match, name: string) =>
        values[name] === undefined ? match : String(values[name]),
      );
    },
  };
}

/** Textos transversales. Cada modulo suma los suyos. */
export const commonMessages: Messages = {
  'action.save': 'Guardar',
  'action.cancel': 'Cancelar',
  'action.retry': 'Reintentar',
  'action.back': 'Volver',
  'action.close': 'Cerrar',
  'action.search': 'Buscar',

  'state.loading': 'Cargando…',
  'state.empty': 'No hay nada para mostrar',
  'state.error.title': 'Algo salió mal',
  'state.error.network': 'No pudimos conectarnos. Revisá tu conexión.',
  'state.error.support': 'Si sigue pasando, compartí el código {code} con soporte.',

  'nav.home': 'Inicio',
  'nav.schedule': 'Horario',
  'nav.members': 'Miembros',
  'nav.settings': 'Configuración',

  'theme.dark': 'Oscuro',
  'theme.light': 'Claro',
  'theme.system': 'Sistema',
};

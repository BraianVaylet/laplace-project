/**
 * Lo que Rooms necesita de otros módulos, expresado como interfaz.
 *
 * ADR-003: un módulo no importa el modelo ni el repositorio de otro. El punto de
 * composición conecta estos puertos con quien los sepa contestar; mientras el
 * módulo que contesta no exista, se usa el default de abajo y queda anotado.
 */

/** ¿Existe esa sede en este tenant? Lo contesta Venues. */
export interface VenueLookup {
  exists(venuePublicId: string): Promise<boolean>;
}

/**
 * Cuántas sesiones futuras tiene una sala. Lo contesta Schedule (F1-12).
 *
 * Hasta que exista, el default responde 0: hoy no hay sesiones en la base, así
 * que ninguna sala tendría por qué estar bloqueada. El día que Schedule entre,
 * se cambia una línea en el punto de composición y el bloqueo empieza a aplicar
 * sin tocar este módulo.
 */
export interface FutureSessionCounter {
  countFutureSessions(roomPublicId: string): Promise<number>;
}

export const NO_SESSIONS_YET: FutureSessionCounter = {
  countFutureSessions: () => Promise.resolve(0),
};

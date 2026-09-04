/**
 * Las dos defensas del formulario público (§5.1.4).
 *
 * Ninguna de las dos le pide nada al humano. Un captcha traslada el costo a
 * quien quiere escribirnos, y quien quiere escribirnos es exactamente la
 * persona que no queremos perder.
 */

/**
 * 🔴 ¿Lo llenó un bot?
 *
 * El campo `website` está escondido por CSS y sin `label`: una persona no lo
 * ve, un robot que completa todo lo que encuentra sí. Que venga con cualquier
 * cosa adentro es la señal.
 */
export function looksAutomated(honeypot: string | undefined): boolean {
  return honeypot !== undefined && honeypot.trim().length > 0;
}

/**
 * Un mensaje con demasiados enlaces es publicidad, no una consulta.
 *
 * Tres es el corte: alguien puede pegar el link de su gimnasio y el de su
 * Instagram sin ser spam; cinco links en diez líneas no es una persona
 * preguntando cuánto sale.
 */
export const MAX_LINKS = 3;

const LINK = /https?:\/\/|www\./gi;

export function countLinks(message: string): number {
  return message.match(LINK)?.length ?? 0;
}

export function looksLikeSpam(message: string): boolean {
  return countLinks(message) > MAX_LINKS;
}

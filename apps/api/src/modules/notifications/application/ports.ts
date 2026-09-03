/**
 * Puertos de salida de Notifications. Se inyectan: **ningún test manda un
 * mail**, y el proveedor real se cambia sin tocar el motor (§2.1.14).
 */

export interface OutgoingEmail {
  to: string;
  subject: string;
  body: string;
}

/**
 * El proveedor de mail. Que `send` falle es parte del contrato, no una
 * excepción rara: es exactamente lo que el backoff existe para atender.
 */
export interface NotificationMailer {
  send(email: OutgoingEmail): Promise<void>;
}

/**
 * A quién le mandamos y en qué zona horaria vive (la ventana de silencio es la
 * del centro, no la del servidor).
 *
 * Es un puerto y no una consulta a Members porque Notifications no importa el
 * modelo de otro módulo (ADR-003): quien arma el módulo le pasa cómo resolverlo.
 */
export interface NotificationRecipient {
  userId: string;
  name: string;
  email: string | null;
}

export interface RecipientLookup {
  /** `null` cuando el socio no tiene cuenta: no hay a quién avisarle todavía. */
  byMemberId(memberId: string): Promise<NotificationRecipient | null>;
}

/** La zona del centro. Sin sede conocida, el que llama decide el default. */
export interface TimeZoneLookup {
  ofVenue(venueId: string): Promise<string | null>;
}

/**
 * Implementación de desarrollo: deja el aviso en el log en vez de mandarlo.
 * En staging y prod se reemplaza por el proveedor real (§6: Resend).
 */
export function createLoggingMailer(log: (msg: string, meta: object) => void): NotificationMailer {
  return {
    send(email) {
      log('Aviso por mail (modo dev, no se envió)', {
        module: 'notifications',
        action: 'sendEmail',
        meta: { to: email.to, subject: email.subject },
      });

      return Promise.resolve();
    },
  };
}

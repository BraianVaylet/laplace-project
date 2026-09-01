/**
 * Puertos de salida del modulo de auth. Se inyectan: ningun test toca la red y
 * el proveedor de mail se cambia sin tocar el dominio.
 */

export interface VerificationEmail {
  to: string;
  /** Enlace completo de verificacion, ya firmado por Better Auth. */
  url: string;
  token: string;
}

export interface EmailSender {
  sendVerification(email: VerificationEmail): Promise<void>;
}

/**
 * Implementacion de desarrollo: deja el enlace en el log en vez de mandarlo.
 * En staging y prod se reemplaza por el proveedor real (spec §6: Resend).
 */
export function createLoggingEmailSender(log: (msg: string, meta: object) => void): EmailSender {
  return {
    sendVerification(email) {
      log('Mail de verificacion (modo dev, no se envio)', {
        module: 'auth',
        action: 'sendVerificationEmail',
        meta: { to: email.to, url: email.url },
      });
      return Promise.resolve();
    },
  };
}

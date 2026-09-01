import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import type { Db } from 'mongodb';
import type { EmailSender } from './ports.js';

/** Prefijo de las rutas de auth. Spec §5.0: todo cuelga de /api/v1, sin excepciones. */
export const AUTH_BASE_PATH = '/api/v1/auth';

export interface AuthDeps {
  /** Se reutiliza la conexion de Mongoose: una sola pool, no dos clientes. */
  db: Db;
  secret: string;
  baseURL: string;
  trustedOrigins: string[];
  emailSender: EmailSender;
}

/**
 * Better Auth es la base de identidad del producto (spec §2.1.1). El plugin de
 * organizaciones, el RBAC y el endurecimiento (rate limit, 2FA, magic link)
 * entran en F0-02 y F0-03; esta fabrica queda abierta para recibirlos.
 */
export function createAuth({ db, secret, baseURL, trustedOrigins, emailSender }: AuthDeps) {
  return betterAuth({
    database: mongodbAdapter(db),
    secret,
    baseURL,
    basePath: AUTH_BASE_PATH,
    trustedOrigins,

    emailAndPassword: {
      enabled: true,
      /**
       * El login NO exige email verificado: la spec §2.1.1 pide la verificacion
       * antes de RESERVAR, no antes de entrar. El corte lo hace el guard
       * `requireVerifiedEmail`, que responde LP-AUTH-403-004.
       */
      requireEmailVerification: false,
      minPasswordLength: 8,
    },

    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, url, token }) => {
        await emailSender.sendVerification({ to: user.email, url, token });
      },
    },

    user: { modelName: 'user' },
    session: { modelName: 'session' },
    account: { modelName: 'account' },
    verification: { modelName: 'verification' },
  });
}

export type Auth = ReturnType<typeof createAuth>;

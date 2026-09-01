import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { magicLink } from 'better-auth/plugins/magic-link';
import { organization } from 'better-auth/plugins/organization';
import { twoFactor } from 'better-auth/plugins/two-factor';
import type { Db } from 'mongodb';
import { ORG_ROLES, ac } from './permissions.js';
import type { EmailSender } from './ports.js';

/** Prefijo de las rutas de auth. Spec §5.0: todo cuelga de /api/v1, sin excepciones. */
export const AUTH_BASE_PATH = '/api/v1/auth';

/** Login: 5 por minuto y por IP (spec §9.1). */
export const LOGIN_RATE_LIMIT = { window: 60, max: 5 } as const;

export interface AuthDeps {
  /** Se reutiliza la conexion de Mongoose: una sola pool, no dos clientes. */
  db: Db;
  secret: string;
  baseURL: string;
  trustedOrigins: string[];
  emailSender: EmailSender;
  /** El rate limit se apaga solo en los tests que no lo estan probando. */
  rateLimitEnabled?: boolean;
}

/**
 * Better Auth es la base de identidad del producto (spec §2.1.1).
 * La Organization ES el tenant (ADR-000).
 */
export function createAuth({
  db,
  secret,
  baseURL,
  trustedOrigins,
  emailSender,
  rateLimitEnabled = true,
}: AuthDeps) {
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

    /**
     * Spec §9.1: rate limit en login, registro y recupero. Persistido en Mongo
     * para que sobreviva a un reinicio y valga para todas las instancias — en
     * memoria, reiniciar la API es la forma mas facil de saltearlo.
     */
    rateLimit: {
      enabled: rateLimitEnabled,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { ...LOGIN_RATE_LIMIT },
        '/sign-in/magic-link': { ...LOGIN_RATE_LIMIT },
        '/sign-up/email': { window: 3600, max: 10 },
        '/forget-password': { window: 3600, max: 5 },
        '/two-factor/verify-totp': { window: 60, max: 5 },
      },
    },

    user: {
      modelName: 'user',
      additionalFields: {
        /**
         * El SAU (§1.1). `input: false` es lo importante: si fuera escribible,
         * cualquiera se haria super admin en el propio registro.
         */
        isSuperAdmin: { type: 'boolean', defaultValue: false, input: false },
      },
    },

    plugins: [
      /**
       * Multi-tenancy sobre el plugin de organizaciones (spec §2.1.1): las
       * organizaciones, los miembros y las invitaciones ya estan resueltos, no
       * se reinventan. Lo propio es la matriz de permisos de `permissions.ts`.
       */
      organization({
        ac,
        roles: ORG_ROLES,
        /** Quien crea el centro es su SMU: dueño, sin techo. */
        creatorRole: 'owner',
      }),

      /** TOTP: opcional para el SMU, obligatorio para el SAU (lo exige `requireTwoFactor`). */
      twoFactor({ issuer: 'Laplace' }),

      /** Menos friccion en mobile para el socio (§2.1.1). Un solo uso, vida corta. */
      magicLink({
        expiresIn: 300,
        sendMagicLink: async ({ email, url, token }) => {
          await emailSender.sendMagicLink({ to: email, url, token });
        },
      }),
    ],

    session: { modelName: 'session' },
    account: { modelName: 'account' },
    verification: { modelName: 'verification' },
  });
}

export type Auth = ReturnType<typeof createAuth>;

import { z } from 'zod';

/**
 * Validacion del entorno en el arranque. Si falta una variable, el proceso no
 * levanta: es preferible fallar en el deploy que a las 3 AM con un undefined.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['dev', 'staging', 'prod']).default('dev'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((v) =>
      v
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),
  MONGODB_URI: z.string().min(1),
  MONGODB_DB_NAME: z.string().min(1).default('laplace_dev'),
  // Better Auth firma sesiones y tokens con esto. 32 bytes minimo.
  BETTER_AUTH_SECRET: z.string().min(32, 'Generalo con: openssl rand -base64 32'),
  BETTER_AUTH_URL: z.string().url(),
  /**
   * 🔴 El rate limit de auth (§9.1). Se puede apagar **solo en dev**, y el
   * schema lo rechaza en cualquier otro lado: es la defensa contra el ataque de
   * fuerza bruta, y una variable mal puesta en prod la dejaría sin efecto en
   * silencio.
   *
   * Lo necesita el arnés de E2E, que crea decenas de cuentas desde una sola IP.
   */
  AUTH_RATE_LIMIT: z.enum(['on', 'off']).default('on'),
  // Se apagan en local para no correr jobs contra la base de desarrollo.
  JOBS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

const guardedEnvSchema = envSchema.refine(
  (env) => env.AUTH_RATE_LIMIT === 'on' || env.APP_ENV === 'dev',
  {
    message: 'AUTH_RATE_LIMIT solo se puede apagar en dev.',
    path: ['AUTH_RATE_LIMIT'],
  },
);

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = guardedEnvSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Configuracion de entorno invalida:\n  ${detail}`);
  }
  return parsed.data;
}

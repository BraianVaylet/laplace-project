import { createMiddleware } from 'hono/factory';
import { AppError } from '../http/errors.js';
import type { Auth } from './auth.js';

/** Lo que el resto de la app necesita saber del usuario autenticado. */
export interface AuthUser {
  id: string;
  email: string;
  emailVerified: boolean;
}

export type SessionEnv = {
  Variables: {
    auth: Auth;
    userId: string;
    authUser: AuthUser;
  };
};

/**
 * Resuelve la sesion desde la cookie y la deja en el contexto. Sin sesion
 * valida, corta con LP-AUTH-401-005.
 *
 * La autorizacion real se resuelve SIEMPRE en el servidor (spec §2.1.1): lo que
 * el cliente diga sobre su rol o su tenant no se lee nunca.
 */
export const requireSession = createMiddleware<SessionEnv>(async (c, next) => {
  const auth = c.get('auth');
  if (!auth) {
    throw new AppError({
      code: 'LP-SYS-500-001',
      status: 500,
      message: 'Ocurrió un error. Compartí el código con soporte.',
      meta: { reason: 'la app se construyó sin instancia de auth' },
    });
  }

  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    throw new AppError({
      code: 'LP-AUTH-401-005',
      status: 401,
      message: 'Tu sesión expiró.',
      action: 'Entrá de nuevo.',
    });
  }

  c.set('userId', session.user.id);
  c.set('authUser', {
    id: session.user.id,
    email: session.user.email,
    emailVerified: session.user.emailVerified,
  });

  await next();
});

/**
 * Exige email verificado. Spec §2.1.1: verificacion obligatoria antes de
 * reservar. Va siempre DESPUES de `requireSession`.
 */
export const requireVerifiedEmail = createMiddleware<SessionEnv>(async (c, next) => {
  const user = c.get('authUser');
  if (!user?.emailVerified) {
    throw new AppError({
      code: 'LP-AUTH-403-004',
      status: 403,
      message: 'Verificá tu email antes de continuar.',
      action: 'Revisá tu casilla; si no llegó, pedí que te lo reenviemos.',
    });
  }

  await next();
});

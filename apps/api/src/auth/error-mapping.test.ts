import { describe, expect, it } from 'vitest';
import { mapAuthError } from './error-mapping.js';

/**
 * Better Auth responde con su propio formato de error, en ingles. La spec §5.0
 * exige que TODA la API responda con el envelope unificado y en es-AR, asi que
 * sus errores se traducen antes de salir. Esta tabla es esa traduccion.
 */
describe('traduccion de los errores de Better Auth', () => {
  it('credenciales invalidas se traducen a LP-AUTH-401-001', () => {
    const mapped = mapAuthError(401, { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid' });

    expect(mapped.code).toBe('LP-AUTH-401-001');
    expect(mapped.status).toBe(401);
  });

  it('no revela si el email existe: el mensaje de credenciales es el mismo en los dos casos', () => {
    const wrongPassword = mapAuthError(401, { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'x' });
    const noSuchUser = mapAuthError(401, { code: 'USER_NOT_FOUND', message: 'y' });

    expect(noSuchUser.code).toBe(wrongPassword.code);
    expect(noSuchUser.message).toBe(wrongPassword.message);
  });

  it('email ya registrado se traduce a LP-AUTH-409-009 con HTTP 409', () => {
    const mapped = mapAuthError(422, { code: 'USER_ALREADY_EXISTS', message: 'exists' });

    expect(mapped.code).toBe('LP-AUTH-409-009');
    expect(mapped.status).toBe(409);
    expect(mapped.action).toBeDefined();
  });

  it('un 401 sin codigo conocido se trata como sesion invalida', () => {
    const mapped = mapAuthError(401, {});

    expect(mapped.code).toBe('LP-AUTH-401-005');
    expect(mapped.status).toBe(401);
  });

  it('demasiados intentos se traduce a LP-AUTH-429-003', () => {
    const mapped = mapAuthError(429, { message: 'Too many requests' });

    expect(mapped.code).toBe('LP-AUTH-429-003');
    expect(mapped.status).toBe(429);
  });

  it('un error desconocido cae en LP-SYS-500-001, nunca en un codigo inventado', () => {
    const mapped = mapAuthError(500, { code: 'SOMETHING_WE_DID_NOT_MAP', message: 'boom' });

    expect(mapped.code).toBe('LP-SYS-500-001');
    expect(mapped.status).toBe(500);
  });

  it('nunca devuelve el mensaje en ingles de Better Auth', () => {
    const cases: Array<[number, Record<string, unknown>]> = [
      [401, { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' }],
      [422, { code: 'USER_ALREADY_EXISTS', message: 'User already exists' }],
      [500, { code: 'UNKNOWN', message: 'Internal server error' }],
    ];

    for (const [status, body] of cases) {
      const mapped = mapAuthError(status, body);
      expect(mapped.message).not.toBe(body['message']);
      expect(mapped.message.length).toBeGreaterThan(0);
    }
  });

  it('un cuerpo que no es un objeto no rompe la traduccion', () => {
    expect(mapAuthError(500, null).code).toBe('LP-SYS-500-001');
    expect(mapAuthError(500, 'texto plano').code).toBe('LP-SYS-500-001');
  });
});

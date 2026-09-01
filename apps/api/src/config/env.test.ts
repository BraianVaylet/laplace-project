import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

/**
 * Si falta una variable, el proceso no levanta. Es preferible fallar en el
 * deploy que a las 3 AM con un `undefined` en el medio de una reserva.
 */
const VALID = {
  MONGODB_URI: 'mongodb://localhost:27017/laplace',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:3000',
};

describe('validacion del entorno', () => {
  it('con lo minimo, levanta con los defaults', () => {
    const env = loadEnv(VALID);

    expect(env.NODE_ENV).toBe('development');
    expect(env.APP_ENV).toBe('dev');
    expect(env.API_PORT).toBe(3000);
    expect(env.MONGODB_DB_NAME).toBe('laplace_dev');
    expect(env.JOBS_ENABLED).toBe(true);
  });

  it('sin MONGODB_URI no arranca', () => {
    const { MONGODB_URI: _, ...sinMongo } = VALID;

    expect(() => loadEnv(sinMongo)).toThrowError(/MONGODB_URI/);
  });

  it('sin BETTER_AUTH_SECRET no arranca', () => {
    const { BETTER_AUTH_SECRET: _, ...sinSecreto } = VALID;

    expect(() => loadEnv(sinSecreto)).toThrowError(/BETTER_AUTH_SECRET/);
  });

  it('un secreto corto no pasa: firma sesiones y tokens', () => {
    expect(() => loadEnv({ ...VALID, BETTER_AUTH_SECRET: 'corto' })).toThrowError(
      /BETTER_AUTH_SECRET/,
    );
  });

  it('una BETTER_AUTH_URL que no es URL no pasa', () => {
    expect(() => loadEnv({ ...VALID, BETTER_AUTH_URL: 'no-es-una-url' })).toThrowError(
      /BETTER_AUTH_URL/,
    );
  });

  it('el mensaje nombra TODAS las variables que faltan, no la primera', () => {
    try {
      loadEnv({});
      expect.unreachable('tenia que lanzar');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('MONGODB_URI');
      expect(message).toContain('BETTER_AUTH_SECRET');
      expect(message).toContain('BETTER_AUTH_URL');
    }
  });

  it('los origenes de CORS se parsean separados por coma y sin espacios sueltos', () => {
    const env = loadEnv({
      ...VALID,
      CORS_ORIGINS: 'http://localhost:5173, http://localhost:5174 ,http://localhost:5175',
    });

    expect(env.CORS_ORIGINS).toEqual([
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:5175',
    ]);
  });

  it('un CORS_ORIGINS con comas de mas no deja un origen vacio', () => {
    const env = loadEnv({ ...VALID, CORS_ORIGINS: 'http://localhost:5173,,' });

    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173']);
  });

  it('el puerto llega como string y sale como numero', () => {
    expect(loadEnv({ ...VALID, API_PORT: '8080' }).API_PORT).toBe(8080);
  });

  it('un puerto invalido no pasa', () => {
    expect(() => loadEnv({ ...VALID, API_PORT: 'ocho mil' })).toThrowError(/API_PORT/);
    expect(() => loadEnv({ ...VALID, API_PORT: '-1' })).toThrowError(/API_PORT/);
  });

  it('JOBS_ENABLED=false apaga los jobs', () => {
    expect(loadEnv({ ...VALID, JOBS_ENABLED: 'false' }).JOBS_ENABLED).toBe(false);
  });

  it('un APP_ENV desconocido no pasa: staging y prod no pueden ser un typo', () => {
    expect(() => loadEnv({ ...VALID, APP_ENV: 'produccion' })).toThrowError(/APP_ENV/);
  });
});

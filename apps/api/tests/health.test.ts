import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/observability/logger.js';

const logger = createLogger({ env: 'test', level: 'silent', service: 'api' });
const app = createApp({ logger, corsOrigins: ['http://localhost:5173'] });

describe('health checks', () => {
  it('GET /health responde ok sin depender de Mongo', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: 'ok' });
  });

  it('GET /ready responde 503 si no hay conexion a Mongo', async () => {
    const res = await app.request('/ready');
    expect(res.status).toBe(503);
  });
});

describe('contrato transversal de la API', () => {
  it('devuelve el requestId recibido en el header de respuesta', async () => {
    const res = await app.request('/health', { headers: { 'x-request-id': 'req-abc' } });
    expect(res.headers.get('x-request-id')).toBe('req-abc');
  });

  it('genera un requestId cuando el cliente no manda ninguno', async () => {
    const res = await app.request('/health');
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('una ruta inexistente devuelve el envelope de error, no un 404 pelado', async () => {
    const res = await app.request('/api/v1/no-existe');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('LP-SYS-404-002');
  });
});

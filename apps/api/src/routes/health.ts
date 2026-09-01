import { Hono } from 'hono';
import mongoose from 'mongoose';

/**
 * /health  = liveness (el proceso responde)
 * /ready   = readiness (ademas hay conexion viva a Mongo)
 * Spec §6 — Precisiones de infra.
 */
export const healthRoutes = new Hono()
  .get('/health', (c) => c.json({ status: 'ok' }))
  .get('/ready', async (c) => {
    const connected = mongoose.connection.readyState === 1;
    if (!connected) {
      return c.json({ status: 'unavailable', mongo: 'disconnected' }, 503);
    }
    return c.json({ status: 'ok', mongo: 'connected' });
  });

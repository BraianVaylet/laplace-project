import { Temporal } from '@js-temporal/polyfill';
import pino, { type Logger } from 'pino';

/**
 * Formato de log unico del proyecto. Spec §11.1.
 * Nunca loguear passwords, tokens, datos de salud ni datos de tarjeta.
 */
export interface LogContext {
  module?: string;
  action?: string;
  requestId?: string;
  tenantId?: string;
  venueId?: string;
  userId?: string;
  durationMs?: number;
  errorCode?: string;
  meta?: Record<string, unknown>;
}

const REDACTED = [
  'req.headers.authorization',
  'req.headers.cookie',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.cardNumber',
  '*.health',
];

export function createLogger(opts: {
  env: string;
  level: string;
  service?: string;
  pretty?: boolean;
}): Logger {
  return pino({
    level: opts.level,
    base: { env: opts.env, service: opts.service ?? 'api' },
    timestamp: () => `,"ts":"${Temporal.Now.instant().toString()}"`,
    messageKey: 'msg',
    redact: { paths: REDACTED, censor: '[REDACTED]' },
    ...(opts.pretty ? { transport: { target: 'pino-pretty' } } : {}),
  });
}

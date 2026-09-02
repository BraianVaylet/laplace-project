import { Temporal } from '@js-temporal/polyfill';
import type { ApiError, ErrorCode } from '@laplace/schemas';

/**
 * Error tipado de Laplace. Spec §5.0: try/catch + error tipado + codigo +
 * log estructurado + respuesta HTTP normalizada. Un catch que solo loguea
 * no cumple el DoD.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly action?: string;
  readonly meta?: Record<string, unknown>;

  constructor(args: {
    code: ErrorCode;
    status: number;
    message: string;
    action?: string;
    meta?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(args.message, args.cause === undefined ? undefined : { cause: args.cause });
    this.name = 'AppError';
    this.code = args.code;
    this.status = args.status;
    if (args.action !== undefined) this.action = args.action;
    if (args.meta !== undefined) this.meta = args.meta;
  }
}

/** Error generico para lo no controlado. El usuario comparte el code con soporte. */
export const UNHANDLED = {
  code: 'LP-SYS-500-001' as ErrorCode,
  status: 500,
  message: 'Ocurrio un error. Compartí el código con soporte.',
};

/** Arma el envelope unificado de la spec §5.0. */
export function toErrorEnvelope(error: unknown, requestId: string): ApiError {
  const timestamp = Temporal.Now.instant().toString();

  if (error instanceof AppError) {
    return {
      success: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.action === undefined ? {} : { action: error.action }),
        requestId,
        timestamp,
      },
    };
  }

  return {
    success: false,
    error: {
      code: UNHANDLED.code,
      message: UNHANDLED.message,
      requestId,
      timestamp,
    },
  };
}

export function statusOf(error: unknown): number {
  return error instanceof AppError ? error.status : UNHANDLED.status;
}

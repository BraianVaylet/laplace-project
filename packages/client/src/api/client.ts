import { Temporal } from '@js-temporal/polyfill';
import { apiErrorSchema, type ApiError, type ErrorCode } from '@laplace/schemas';

/**
 * Error de la API, ya tipado. **Nunca un string suelto**: el `code` y el
 * `requestId` son lo que el usuario le pasa a soporte (spec §5), asi que tienen
 * que sobrevivir el viaje desde el backend hasta la pantalla.
 */
export class ApiRequestError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  /** Que puede hacer el usuario. Sale del `action` del envelope §5.0. */
  readonly action: string | undefined;
  readonly requestId: string;
  readonly timestamp: string;

  constructor(args: {
    code: ErrorCode;
    status: number;
    message: string;
    action?: string | undefined;
    requestId: string;
    timestamp: string;
  }) {
    super(args.message);
    this.name = 'ApiRequestError';
    this.code = args.code;
    this.status = args.status;
    this.action = args.action;
    this.requestId = args.requestId;
    this.timestamp = args.timestamp;
  }

  /** `true` si el error es de esta familia. Ej: `error.is('LP-BOOK')`. */
  is(prefix: string): boolean {
    return this.code.startsWith(prefix);
  }
}

/** Cuando ni siquiera hubo respuesta: sin red, DNS caido, CORS. */
export class NetworkError extends Error {
  readonly requestId: string;

  constructor(requestId: string, cause?: unknown) {
    super('No pudimos conectarnos. Revisá tu conexión.');
    this.name = 'NetworkError';
    this.requestId = requestId;
    this.cause = cause;
  }
}

export const REQUEST_ID_HEADER = 'x-request-id';
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

export interface ApiClientOptions {
  baseUrl: string;
  /** Inyectable para los tests. Por defecto, el `fetch` del entorno. */
  fetchImpl?: typeof fetch;
  /** Genera el requestId que viaja al backend. Inyectable para poder aseverarlo. */
  newRequestId?: () => string;
  /** Se llama ante cualquier error, para el toast global y para Sentry. */
  onError?: (error: ApiRequestError | NetworkError) => void;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** Obligatoria en reservas, pagos y check-in (§5.0). */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

function buildUrl(baseUrl: string, path: string, query: RequestOptions['query']): string {
  const url = new URL(path.replace(/^\//, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  return url.toString();
}

/**
 * Cliente de la API de Laplace.
 *
 * Dos cosas que hace y que no son negociables:
 * 1. **Manda un `requestId` en cada pedido** y lo devuelve en el error. Es lo
 *    que permite que soporte encuentre qué pasó exactamente (§11.3).
 * 2. **Traduce el envelope de error a un error tipado.** Sin esto, cada
 *    pantalla parsea el JSON a mano y alguna lo parsea mal justo el día que
 *    falla algo.
 */
export function createApiClient({
  baseUrl,
  fetchImpl,
  newRequestId = () => globalThis.crypto.randomUUID(),
  onError,
}: ApiClientOptions) {
  const doFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const requestId = newRequestId();
    const headers: Record<string, string> = { [REQUEST_ID_HEADER]: requestId };

    /*
     * 🔴 Un cuerpo binario viaja tal cual. Serializarlo como JSON convertiria
     * una foto en `{}`, y el servidor — que mira los bytes para saber que
     * formato es — recibiria dos llaves en vez de una imagen.
     *
     * El `content-type` de un binario lo decide el servidor mirando el
     * contenido, asi que aca no se declara ninguno: declararlo seria repetir lo
     * que quien sube el archivo ya podria mentir.
     */
    const esBinario = isBinaryBody(options.body);
    if (options.body !== undefined && !esBinario) headers['content-type'] = 'application/json';
    if (options.idempotencyKey) headers[IDEMPOTENCY_KEY_HEADER] = options.idempotencyKey;

    let response: Response;
    try {
      response = await doFetch(buildUrl(baseUrl, path, options.query), {
        method: options.method ?? 'GET',
        headers,
        // La sesion viaja en cookie: sin esto el backend no ve al usuario.
        credentials: 'include',
        ...(options.body === undefined
          ? {}
          : { body: esBinario ? (options.body as BodyInit) : JSON.stringify(options.body) }),
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (cause) {
      // Un abort no es un fallo de red: lo pidio el propio cliente.
      if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;

      const error = new NetworkError(requestId, cause);
      onError?.(error);
      throw error;
    }

    if (response.ok) {
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    }

    throw toApiError(await safeJson(response), response.status, requestId, onError);
  }

  return {
    get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
      request<T>(path, { ...options, method: 'GET' }),
    post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
      request<T>(path, { ...options, method: 'POST', body }),
    patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
      request<T>(path, { ...options, method: 'PATCH', body }),
    put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>) =>
      request<T>(path, { ...options, method: 'PUT', body }),
    delete: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
      request<T>(path, { ...options, method: 'DELETE' }),
    request,
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/**
 * Lo que se manda sin tocar: los cuerpos que ya son bytes. Todo lo demas va
 * como JSON, que es el 99% de los pedidos del producto.
 */
function isBinaryBody(body: unknown): boolean {
  return (
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    (typeof Blob !== 'undefined' && body instanceof Blob) ||
    (typeof FormData !== 'undefined' && body instanceof FormData)
  );
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function toApiError(
  body: unknown,
  status: number,
  requestId: string,
  onError: ApiClientOptions['onError'],
): ApiRequestError {
  const parsed = apiErrorSchema.safeParse(body);

  /*
   * Si la respuesta no trae el envelope — un 502 del proxy, un HTML de error —
   * igual se devuelve un ApiRequestError con codigo generico. La pantalla no
   * tiene que saber distinguir esos casos.
   */
  const envelope: ApiError['error'] = parsed.success
    ? parsed.data.error
    : {
        code: 'LP-SYS-500-001' as ErrorCode,
        message: 'Ocurrió un error. Compartí el código con soporte.',
        requestId,
        timestamp: Temporal.Now.instant().toString(),
      };

  const error = new ApiRequestError({
    code: envelope.code,
    status,
    message: envelope.message,
    action: envelope.action,
    // Manda el del backend si lo trae; si no, el que se generó al salir.
    requestId: envelope.requestId || requestId,
    timestamp: envelope.timestamp,
  });

  onError?.(error);
  return error;
}

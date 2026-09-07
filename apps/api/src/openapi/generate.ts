import { z, type ZodType } from 'zod';
import { apiErrorSchema, type ErrorCode } from '@laplace/schemas';
import type { RouteSpec } from '../http/route-registry.js';

/**
 * Genera el OpenAPI desde los schemas Zod del registro de rutas.
 *
 * ADR-003: la doc **se genera, no se escribe a mano** — escrita a mano se
 * desactualiza siempre, y una doc que miente es peor que no tener doc. Zod 4
 * emite JSON Schema nativo, asi que no hace falta un segundo lugar donde
 * declarar la forma de cada payload.
 */
export interface OpenApiOptions {
  title: string;
  version: string;
  description?: string;
  servers?: Array<{ url: string; description?: string }>;
}

type JsonObject = Record<string, unknown>;

const ERROR_SCHEMA_REF = '#/components/schemas/ApiError';

/** `/api/v1/members/:id` → `/api/v1/members/{id}`, que es lo que espera OpenAPI. */
export function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

export function pathParamNames(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1] as string);
}

function toSchema(schema: ZodType): JsonObject {
  return z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'input' }) as JsonObject;
}

function parametersFor(spec: RouteSpec): JsonObject[] {
  const parameters: JsonObject[] = [];

  const declared = spec.request?.params ? toSchema(spec.request.params) : undefined;
  const declaredProps = (declared?.['properties'] ?? {}) as Record<string, JsonObject>;

  for (const name of pathParamNames(spec.path)) {
    parameters.push({
      name,
      in: 'path',
      required: true,
      schema: declaredProps[name] ?? { type: 'string' },
    });
  }

  if (spec.request?.query) {
    const query = toSchema(spec.request.query);
    const required = (query['required'] ?? []) as string[];

    for (const [name, schema] of Object.entries(
      (query['properties'] ?? {}) as Record<string, JsonObject>,
    )) {
      parameters.push({ name, in: 'query', required: required.includes(name), schema });
    }
  }

  return parameters;
}

/**
 * Lo que devuelve toda validacion de entrada: `parseQuery` para la query y
 * `validated` para el body (`http/validate.ts`).
 */
const INVALID_INPUT_CODE = 'LP-SYS-422-006' satisfies ErrorCode;

/**
 * Los codigos que la ruta declara, mas los que se deducen de su forma.
 *
 * `LP-SYS-422-006` sale del spec y no de cada `errorCodes` a mano: una ruta que
 * declara `query` o `body` valida esa entrada, y por lo tanto puede
 * rechazarla con 422. Repetirlo a mano se olvidaba — cuando se corrigio, un
 * tercio de las rutas registradas no lo declaraba y su doc mentia por omision.
 *
 * Es aditivo: los codigos que no se deducen de la forma de la ruta —
 * `LP-SYS-422-006` por `Idempotency-Key` faltante, sin ir mas lejos — se siguen
 * declarando a mano, y el `Set` evita que salgan repetidos.
 */
function errorCodesOf(spec: RouteSpec): ErrorCode[] {
  const declared = spec.errorCodes ?? [];
  const validatesInput = spec.request?.query !== undefined || spec.request?.body !== undefined;

  return [...new Set(validatesInput ? [...declared, INVALID_INPUT_CODE] : declared)];
}

function responsesFor(spec: RouteSpec): JsonObject {
  const responses: JsonObject = {};

  const okStatus = String(spec.response?.status ?? (spec.method === 'POST' ? 201 : 200));
  responses[okStatus] = {
    description: 'OK',
    ...(spec.response
      ? { content: { 'application/json': { schema: toSchema(spec.response.schema) } } }
      : {}),
  };

  /**
   * El envelope de error de §5.0 figura como respuesta posible de TODA ruta, con
   * los codigos que esa ruta puede devolver escritos en la descripcion: es lo
   * que le permite a soporte saber que esperar sin leer el codigo.
   */
  const codes = errorCodesOf(spec);
  const byStatus = new Map<string, string[]>();

  for (const code of codes) {
    const status = code.split('-')[2] ?? '500';
    byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
  }
  if (!byStatus.has('500')) byStatus.set('500', ['LP-SYS-500-001']);

  for (const [status, statusCodes] of byStatus) {
    responses[status] = {
      description: `Error. Códigos posibles: ${statusCodes.join(', ')}`,
      content: { 'application/json': { schema: { $ref: ERROR_SCHEMA_REF } } },
    };
  }

  return responses;
}

export function generateOpenApiDocument(
  routes: readonly RouteSpec[],
  options: OpenApiOptions,
): JsonObject {
  const paths: JsonObject = {};

  for (const spec of routes) {
    const path = toOpenApiPath(spec.path);
    const existing = (paths[path] ?? {}) as JsonObject;

    existing[spec.method.toLowerCase()] = {
      summary: spec.summary ?? `${spec.method} ${spec.path}`,
      ...(spec.tags?.length ? { tags: [...spec.tags] } : {}),
      ...(spec.tenantScoped ? { security: [{ sessionCookie: [] }] } : {}),
      parameters: parametersFor(spec),
      ...(spec.request?.body
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: toSchema(spec.request.body) } },
            },
          }
        : {}),
      responses: responsesFor(spec),
    };

    paths[path] = existing;
  }

  return {
    openapi: '3.0.3',
    info: {
      title: options.title,
      version: options.version,
      ...(options.description === undefined ? {} : { description: options.description }),
    },
    ...(options.servers?.length ? { servers: options.servers } : {}),
    paths,
    components: {
      schemas: { ApiError: toSchema(apiErrorSchema) },
      securitySchemes: {
        sessionCookie: { type: 'apiKey', in: 'cookie', name: 'better-auth.session_token' },
      },
    },
  };
}

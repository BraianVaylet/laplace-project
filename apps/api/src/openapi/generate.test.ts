import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { RouteSpec } from '../http/route-registry.js';
import { generateOpenApiDocument, pathParamNames, toOpenApiPath } from './generate.js';

const options = { title: 'Laplace API', version: '1.0.0' };

const memberSchema = z.object({
  publicId: z.string(),
  firstName: z.string(),
  lastName: z.string(),
});

const routes: RouteSpec[] = [
  {
    method: 'GET',
    path: '/api/v1/members/:id',
    tenantScoped: true,
    summary: 'Ficha del miembro',
    tags: ['members'],
    request: { params: z.object({ id: z.string() }) },
    response: { status: 200, schema: memberSchema },
    errorCodes: ['LP-MEMB-404-003', 'LP-AUTH-403-002'],
  },
  {
    method: 'POST',
    path: '/api/v1/members',
    tenantScoped: true,
    summary: 'Dar de alta un miembro',
    tags: ['members'],
    request: { body: z.object({ firstName: z.string().min(1), docId: z.string().optional() }) },
    response: { status: 201, schema: memberSchema },
    errorCodes: ['LP-MEMB-409-001', 'LP-ENTL-403-001'],
  },
  {
    method: 'GET',
    path: '/api/v1/members',
    tenantScoped: true,
    summary: 'Listado de miembros',
    tags: ['members'],
    request: { query: z.object({ cursor: z.string().optional(), limit: z.coerce.number() }) },
    response: { status: 200, schema: z.object({ items: z.array(memberSchema) }) },
  },
];

const doc = () => generateOpenApiDocument(routes, options);

/** Navega el documento sin encadenar casts: si falta un tramo, falla con nombre. */
function dig(root: unknown, ...keys: string[]): unknown {
  let current: unknown = root;
  for (const key of keys) {
    if (typeof current !== 'object' || current === null) {
      throw new Error(`no se llego a ${keys.join(' → ')}: se corto en "${key}"`);
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** La operacion de un metodo sobre un path del registro. */
function operation(path: string, method: string): Record<string, unknown> {
  const found = dig(doc(), 'paths', toOpenApiPath(path), method);
  if (typeof found !== 'object' || found === null) {
    throw new Error(`el documento no tiene ${method.toUpperCase()} ${path}`);
  }
  return found as Record<string, unknown>;
}

const parametersOf = (path: string, method: string) =>
  operation(path, method)['parameters'] as Array<Record<string, unknown>>;

describe('conversion de paths', () => {
  it('los parametros de Hono pasan al formato de OpenAPI', () => {
    expect(toOpenApiPath('/api/v1/members/:id')).toBe('/api/v1/members/{id}');
    expect(toOpenApiPath('/api/v1/venues/:venueId/rooms/:roomId')).toBe(
      '/api/v1/venues/{venueId}/rooms/{roomId}',
    );
  });

  it('un path sin parametros queda igual', () => {
    expect(toOpenApiPath('/api/v1/members')).toBe('/api/v1/members');
  });

  it('se leen los nombres de los parametros', () => {
    expect(pathParamNames('/api/v1/venues/:venueId/rooms/:roomId')).toEqual(['venueId', 'roomId']);
  });
});

describe('documento generado', () => {
  it('es un OpenAPI 3 con su info', () => {
    expect(doc()['openapi']).toBe('3.0.3');
    expect(doc()['info']).toMatchObject({ title: 'Laplace API', version: '1.0.0' });
  });

  it('toda ruta del registro figura en el documento', () => {
    for (const route of routes) {
      expect(
        () => operation(route.path, route.method.toLowerCase()),
        `${route.method} ${route.path}`,
      ).not.toThrow();
    }
  });

  it('dos metodos sobre el mismo path conviven', () => {
    expect(operation('/api/v1/members', 'get')).toBeDefined();
    expect(operation('/api/v1/members', 'post')).toBeDefined();
  });

  it('el body sale del schema Zod, sin duplicar la definicion', () => {
    const schema = dig(
      operation('/api/v1/members', 'post'),
      'requestBody',
      'content',
      'application/json',
      'schema',
    ) as Record<string, unknown>;

    expect(schema['type']).toBe('object');
    expect(Object.keys(schema['properties'] as object)).toContain('firstName');
    expect(schema['required']).toEqual(['firstName']);
  });

  it('los parametros de path quedan como requeridos', () => {
    expect(parametersOf('/api/v1/members/:id', 'get')).toContainEqual(
      expect.objectContaining({ name: 'id', in: 'path', required: true }),
    );
  });

  it('los de query salen del schema, con su obligatoriedad', () => {
    const params = parametersOf('/api/v1/members', 'get');

    expect(params).toContainEqual(
      expect.objectContaining({ name: 'cursor', in: 'query', required: false }),
    );
    expect(params).toContainEqual(
      expect.objectContaining({ name: 'limit', in: 'query', required: true }),
    );
  });
});

describe('el envelope de error, en todas las rutas', () => {
  it('esta declarado como componente', () => {
    expect(dig(doc(), 'components', 'schemas', 'ApiError')).toBeDefined();
  });

  it('toda ruta puede devolverlo', () => {
    for (const route of routes) {
      const responses = operation(route.path, route.method.toLowerCase())['responses'] as Record<
        string,
        unknown
      >;

      expect(
        Object.keys(responses).some((status) => Number(status) >= 400),
        route.path,
      ).toBe(true);
    }
  });

  it('los codigos declarados aparecen en la respuesta de su status', () => {
    const get = operation('/api/v1/members/:id', 'get');

    expect(dig(get, 'responses', '404', 'description')).toContain('LP-MEMB-404-003');
    expect(dig(get, 'responses', '403', 'description')).toContain('LP-AUTH-403-002');
  });

  it('el 500 generico esta siempre, aunque la ruta no declare codigos', () => {
    expect(dig(operation('/api/v1/members', 'get'), 'responses', '500', 'description')).toContain(
      'LP-SYS-500-001',
    );
  });

  it('las respuestas de error referencian el componente, no lo copian', () => {
    expect(
      dig(
        operation('/api/v1/members/:id', 'get'),
        'responses',
        '404',
        'content',
        'application/json',
        'schema',
        '$ref',
      ),
    ).toBe('#/components/schemas/ApiError');
  });
});

describe('seguridad', () => {
  it('las rutas con tenant declaran que necesitan sesion', () => {
    expect(operation('/api/v1/members/:id', 'get')['security']).toEqual([{ sessionCookie: [] }]);
  });

  it('el esquema de seguridad esta declarado', () => {
    expect(dig(doc(), 'components', 'securitySchemes', 'sessionCookie')).toMatchObject({
      in: 'cookie',
    });
  });
});

describe('el POST documenta 201 por default', () => {
  it('porque crear devuelve el recurso creado', () => {
    expect(dig(operation('/api/v1/members', 'post'), 'responses', '201')).toBeDefined();
  });
});

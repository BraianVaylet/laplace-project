import { describe, expect, it, vi } from 'vitest';
import {
  ApiRequestError,
  IDEMPOTENCY_KEY_HEADER,
  NetworkError,
  REQUEST_ID_HEADER,
  createApiClient,
} from './client.js';

const BASE = 'http://localhost:3000/api/v1';

/** Un `fetch` de mentira que devuelve lo que el test le diga y guarda lo que recibio. */
function stubFetch(responder: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return responder(url, init ?? {});
  }) as typeof fetch;

  return { fetchImpl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const errorEnvelope = (code: string, message: string, extra: Record<string, unknown> = {}) => ({
  success: false,
  error: {
    code,
    message,
    requestId: 'req-del-backend',
    timestamp: '2026-09-01T10:00:00Z',
    ...extra,
  },
});

const client = (
  responder: Parameters<typeof stubFetch>[0],
  options: Partial<Parameters<typeof createApiClient>[0]> = {},
) => {
  const { fetchImpl, calls } = stubFetch(responder);
  return {
    api: createApiClient({
      baseUrl: BASE,
      fetchImpl,
      newRequestId: () => 'req-generado',
      ...options,
    }),
    calls,
  };
};

describe('camino feliz', () => {
  it('devuelve el cuerpo parseado', async () => {
    const { api } = client(() => json({ items: [{ publicId: 'mem_1' }] }));

    await expect(api.get('/members')).resolves.toEqual({ items: [{ publicId: 'mem_1' }] });
  });

  it('arma bien la URL sin importar las barras', async () => {
    const { api, calls } = client(() => json({}));

    await api.get('/members');
    await api.get('members');

    expect(calls[0]?.url).toBe(`${BASE}/members`);
    expect(calls[1]?.url).toBe(`${BASE}/members`);
  });

  it('pasa los filtros como query string', async () => {
    const { api, calls } = client(() => json({}));

    await api.get('/members', { query: { status: 'active', limit: 20, archived: false } });

    const url = new URL(calls[0]?.url as string);
    expect(url.searchParams.get('status')).toBe('active');
    expect(url.searchParams.get('limit')).toBe('20');
    expect(url.searchParams.get('archived')).toBe('false');
  });

  it('omite los filtros sin valor: `?tag=undefined` no filtra nada', async () => {
    const { api, calls } = client(() => json({}));

    await api.get('/members', { query: { status: 'active', tag: undefined } });

    expect(new URL(calls[0]?.url as string).searchParams.has('tag')).toBe(false);
  });

  it('manda el body como JSON', async () => {
    const { api, calls } = client(() => json({}, 201));

    await api.post('/members', { firstName: 'Micaela' });

    expect(calls[0]?.init.body).toBe('{"firstName":"Micaela"}');
    expect((calls[0]?.init.headers as Record<string, string>)['content-type']).toBe(
      'application/json',
    );
  });

  it('un 204 no intenta parsear un cuerpo que no existe', async () => {
    const { api } = client(() => new Response(null, { status: 204 }));

    await expect(api.delete('/members/mem_1')).resolves.toBeUndefined();
  });

  it('manda la cookie de sesion: sin eso el backend no ve al usuario', async () => {
    const { api, calls } = client(() => json({}));

    await api.get('/members');

    expect(calls[0]?.init.credentials).toBe('include');
  });
});

describe('requestId', () => {
  it('viaja en cada pedido', async () => {
    const { api, calls } = client(() => json({}));

    await api.get('/members');

    expect((calls[0]?.init.headers as Record<string, string>)[REQUEST_ID_HEADER]).toBe(
      'req-generado',
    );
  });

  it('el error trae el del backend, que es el que quedo en su log', async () => {
    const { api } = client(() =>
      json(errorEnvelope('LP-BOOK-409-002', 'La clase está completa.'), 409),
    );

    await expect(api.post('/bookings')).rejects.toMatchObject({ requestId: 'req-del-backend' });
  });

  it('si el backend no lo devuelve, queda el que se genero al salir', async () => {
    const { api } = client(() => new Response('502 Bad Gateway', { status: 502 }));

    await expect(api.get('/members')).rejects.toMatchObject({ requestId: 'req-generado' });
  });

  it('cada pedido genera el suyo', async () => {
    let n = 0;
    const { api, calls } = client(() => json({}), { newRequestId: () => `req-${++n}` });

    await api.get('/members');
    await api.get('/venues');

    const ids = calls.map((c) => (c.init.headers as Record<string, string>)[REQUEST_ID_HEADER]);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('errores de la API', () => {
  it('el envelope se traduce a un error tipado, no a un string suelto', async () => {
    const { api } = client(() =>
      json(
        errorEnvelope('LP-BOOK-409-002', 'La clase está completa.', {
          action: 'Podés sumarte a la lista de espera.',
        }),
        409,
      ),
    );

    try {
      await api.post('/bookings');
      expect.unreachable('tenia que lanzar');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiRequestError);
      const apiError = error as ApiRequestError;
      expect(apiError.code).toBe('LP-BOOK-409-002');
      expect(apiError.status).toBe(409);
      expect(apiError.message).toBe('La clase está completa.');
      expect(apiError.action).toBe('Podés sumarte a la lista de espera.');
    }
  });

  it('sin `action`, queda undefined y no un string vacio', async () => {
    const { api } = client(() => json(errorEnvelope('LP-AUTH-401-001', 'Datos incorrectos.'), 401));

    await expect(api.post('/auth')).rejects.toMatchObject({ action: undefined });
  });

  it('una respuesta que NO trae el envelope igual da un error tipado', async () => {
    const { api } = client(() => new Response('<html>502</html>', { status: 502 }));

    try {
      await api.get('/members');
      expect.unreachable('tenia que lanzar');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiRequestError);
      expect((error as ApiRequestError).code).toBe('LP-SYS-500-001');
      expect((error as ApiRequestError).status).toBe(502);
    }
  });

  it('un envelope malformado tampoco rompe: la pantalla no distingue esos casos', async () => {
    const { api } = client(() => json({ success: false, error: { nada: true } }, 500));

    await expect(api.get('/members')).rejects.toBeInstanceOf(ApiRequestError);
  });

  it('`is()` deja preguntar por familia de error', async () => {
    const { api } = client(() => json(errorEnvelope('LP-CTRT-402-001', 'Sin créditos.'), 402));

    try {
      await api.post('/bookings');
      expect.unreachable('tenia que lanzar');
    } catch (error) {
      expect((error as ApiRequestError).is('LP-CTRT')).toBe(true);
      expect((error as ApiRequestError).is('LP-BOOK')).toBe(false);
    }
  });

  it('el onError global se entera, para el toast y para Sentry', async () => {
    const onError = vi.fn();
    const { api } = client(() => json(errorEnvelope('LP-CTRT-402-001', 'Sin créditos.'), 402), {
      onError,
    });

    await api.post('/bookings').catch(() => undefined);

    expect(onError).toHaveBeenCalledOnce();
    expect((onError.mock.calls[0]?.[0] as ApiRequestError).code).toBe('LP-CTRT-402-001');
  });
});

describe('fallos de red', () => {
  it('sin respuesta se distingue de un error de la API', async () => {
    const { api } = client(() => {
      throw new TypeError('Failed to fetch');
    });

    try {
      await api.get('/members');
      expect.unreachable('tenia que lanzar');
    } catch (error) {
      expect(error).toBeInstanceOf(NetworkError);
      expect(error).not.toBeInstanceOf(ApiRequestError);
      expect((error as NetworkError).message).toContain('conexión');
    }
  });

  it('un abort NO es un fallo de red: lo pidio el propio cliente', async () => {
    const { api } = client(() => {
      throw new DOMException('The operation was aborted.', 'AbortError');
    });

    await expect(api.get('/members')).rejects.toBeInstanceOf(DOMException);
  });

  it('el abort no dispara el onError global: no hay nada que avisarle al usuario', async () => {
    const onError = vi.fn();
    const { api } = client(
      () => {
        throw new DOMException('aborted', 'AbortError');
      },
      { onError },
    );

    await api.get('/members').catch(() => undefined);

    expect(onError).not.toHaveBeenCalled();
  });
});

describe('idempotencia', () => {
  it('la clave viaja en su header (§5.0: obligatoria en reservas, pagos y check-in)', async () => {
    const { api, calls } = client(() => json({}, 201));

    await api.post('/bookings', { sessionId: 'ses_1' }, { idempotencyKey: 'bkg-abc-123' });

    expect((calls[0]?.init.headers as Record<string, string>)[IDEMPOTENCY_KEY_HEADER]).toBe(
      'bkg-abc-123',
    );
  });

  it('sin clave, no se manda el header vacio', async () => {
    const { api, calls } = client(() => json({}, 201));

    await api.post('/members', { firstName: 'Micaela' });

    expect(
      (calls[0]?.init.headers as Record<string, string>)[IDEMPOTENCY_KEY_HEADER],
    ).toBeUndefined();
  });
});

describe('metodos', () => {
  it.each([
    ['get', 'GET'],
    ['post', 'POST'],
    ['patch', 'PATCH'],
    ['put', 'PUT'],
    ['delete', 'DELETE'],
  ] as const)('%s usa %s', async (method, expected) => {
    const { api, calls } = client(() => json({}));

    await (api[method] as (path: string) => Promise<unknown>)('/x');

    expect(calls[0]?.init.method).toBe(expected);
  });
});

describe('cuerpos binarios', () => {
  it('🔴 un ArrayBuffer viaja tal cual, no como JSON', async () => {
    /*
     * Serializarlo convertiria una foto en `{}`, y el servidor — que mira los
     * bytes para saber que formato es — recibiria dos llaves.
     */
    const { api, calls } = client(() => json({}));
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;

    await api.request('/my/avatar', { method: 'POST', body: bytes });

    expect(calls[0]?.init.body).toBe(bytes);
  });

  it('un binario NO declara content-type: lo decide el servidor mirando los bytes', async () => {
    const { api, calls } = client(() => json({}));

    await api.request('/my/avatar', { method: 'POST', body: new Uint8Array([1, 2, 3]) });

    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['content-type']).toBeUndefined();
  });

  it('un objeto comun sigue yendo como JSON', async () => {
    const { api, calls } = client(() => json({}));

    await api.post('/x', { hola: 'mundo' });

    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(calls[0]?.init.body).toBe('{"hola":"mundo"}');
  });
});

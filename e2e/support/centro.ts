import type { APIRequestContext, BrowserContext } from '@playwright/test';
import { request } from '@playwright/test';

/**
 * Lo que los tres caminos críticos necesitan tener armado antes de empezar.
 *
 * 🔴 **Lo que se hace por API acá es lo que todavía no tiene pantalla**, no lo
 * que da pereza clickear. El DFSM no tiene alta de sede, de clase, de producto
 * ni de contrato: esas pantallas son deuda declarada de F1-06 y de F1-30. Lo
 * que sí tiene pantalla se recorre por pantalla, que es de lo que trata un E2E.
 *
 * Cuando esas altas existan, cada llamada de acá se reemplaza por sus clics y
 * el resto del test no se toca.
 */
/*
 * Con barra al final a propósito: Playwright resuelve la ruta relativa con
 * `new URL()`, y sin la barra `products` reemplazaría el último segmento del
 * prefijo en vez de colgarse de él.
 */
const API = 'http://localhost:3000/api/v1/';

/** Único por corrida: los tests comparten base y corren en paralelo. */
let contador = 0;
const unico = (prefijo: string) => `${prefijo}-${Date.now().toString(36)}-${++contador}`;

export const CLAVE = 'unaClaveLargaYSegura123';

export interface Sesion {
  api: APIRequestContext;
  email: string;
  cookies: string;
}

async function nuevaSesion(email: string): Promise<Sesion> {
  /*
   * 🔴 El `Origin` no es decorativo: Better Auth rechaza con 403 lo que no
   * viene de un origen confiable, que es la defensa contra CSRF. Un pedido sin
   * origen no es "un test", es exactamente la forma del ataque — así que el
   * arnés se presenta como la app que está representando.
   */
  const api = await request.newContext({
    baseURL: API,
    extraHTTPHeaders: { origin: 'http://localhost:5174' },
  });
  const res = await api.post('auth/sign-up/email', {
    data: { email, password: CLAVE, name: email.split('@')[0] },
  });
  if (!res.ok()) throw new Error(`registro de ${email}: ${res.status()} ${await res.text()}`);

  const cookies = (await api.storageState()).cookies
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');

  return { api, email, cookies };
}

/**
 * Pasa la sesión de la API al navegador. La cookie se emite para `localhost` y
 * las cookies no distinguen puerto, así que la misma sirve para el front y para
 * la API — que es exactamente como funciona en el navegador de verdad.
 */
export async function autenticar(context: BrowserContext, sesion: Sesion): Promise<void> {
  const estado = await sesion.api.storageState();
  await context.addCookies(
    estado.cookies.map((cookie) => ({ ...cookie, domain: 'localhost', path: '/' })),
  );
}

async function json<T>(
  api: APIRequestContext,
  method: 'post' | 'get',
  path: string,
  data?: unknown,
) {
  const res = method === 'get' ? await api.get(path) : await api.post(path, { data: data ?? {} });
  if (!res.ok()) throw new Error(`${path}: ${res.status()} ${await res.text()}`);

  return (await res.json()) as T;
}

/** Deja el centro como activo en la sesión: sin esto todo contesta 403. */
async function activar(sesion: Sesion, organizationId: string): Promise<void> {
  const res = await sesion.api.post('auth/organization/set-active', { data: { organizationId } });
  if (!res.ok()) throw new Error(`set-active: ${res.status()} ${await res.text()}`);
}

export interface Centro {
  smu: Sesion;
  organizationId: string;
  venueId: string;
  roomId: string;
}

/** Un centro con su suscripción y su sede. Es el punto de partida de todo. */
export async function centroConSede(
  nombre: string,
  bookingPolicy?: Record<string, unknown>,
): Promise<Centro> {
  const slug = unico(nombre);
  const smu = await nuevaSesion(`${slug}@laplace.test`);

  const suscripcion = await json<{ organizationId: string }>(smu.api, 'post', 'subscribers', {
    centerName: `Box ${slug}`,
    slug,
  });
  await activar(smu, suscripcion.organizationId);

  const sede = await json<{ publicId: string }>(smu.api, 'post', 'venues', {
    name: `Box ${slug}`,
    address: 'Alsina 123, Bahía Blanca',
    timeZone: 'America/Argentina/Buenos_Aires',
    ...(bookingPolicy ? { bookingPolicy } : {}),
  });

  const salas = await json<{ items: Array<{ publicId: string }> }>(
    smu.api,
    'get',
    `rooms?venueId=${sede.publicId}`,
  );

  return {
    smu,
    organizationId: suscripcion.organizationId,
    venueId: sede.publicId,
    roomId: salas.items[0]?.publicId ?? '',
  };
}

/** Corre un job del arnés, opcionalmente con el reloj adelantado. */
export async function correrJob(nombre: string, now?: string): Promise<void> {
  const api = await request.newContext({ baseURL: 'http://localhost:3099' });
  const res = await api.post(`/jobs/${nombre}${now ? `?now=${encodeURIComponent(now)}` : ''}`);
  if (!res.ok()) throw new Error(`job ${nombre}: ${res.status()} ${await res.text()}`);
  await api.dispose();
}

/** Una clase suelta que arranca dentro de `minutos`. */
export async function claseEn(
  centro: Centro,
  minutos: number,
  opciones: { nombre?: string; capacidad?: number } = {},
): Promise<{ sessionId: string; startAt: string }> {
  const startAt = new Date(Date.now() + minutos * 60_000).toISOString();
  const sesion = await json<{ publicId: string; startAt: string }>(
    centro.smu.api,
    'post',
    'sessions',
    {
      venueId: centro.venueId,
      roomId: centro.roomId,
      name: opciones.nombre ?? 'Funcional',
      categoryId: 'funcional',
      startAt,
      durationMin: 60,
      capacity: opciones.capacidad ?? 12,
    },
  );

  return { sessionId: sesion.publicId, startAt: sesion.startAt };
}

/** Un socio con cuenta propia y un pack activo, como lo vende el mostrador. */
export async function socioConPack(
  centro: Centro,
  nombre: string,
  creditos = 8,
): Promise<{ socio: Sesion; memberId: string }> {
  const codigo = await json<{ code: string }>(centro.smu.api, 'post', 'invite-codes', {
    venueId: centro.venueId,
    maxUses: 5,
    expiresAt: '2030-12-31T00:00:00Z',
  });

  const socio = await nuevaSesion(`${unico(nombre)}@laplace.test`);
  const canje = await json<{ memberId: string; organizationId: string }>(
    socio.api,
    'post',
    'invite-codes/redeem',
    { code: codigo.code, firstName: nombre, lastName: 'Socio' },
  );
  await activar(socio, canje.organizationId);

  const producto = await json<{ publicId: string }>(centro.smu.api, 'post', 'products', {
    name: `Pack ${creditos} clases`,
    type: 'class_pack',
    priceCents: 6_000_000,
    credits: creditos,
    durationDays: 60,
    venueIds: [centro.venueId],
  });
  const contrato = await json<{ publicId: string }>(centro.smu.api, 'post', 'contracts', {
    memberId: canje.memberId,
    productId: producto.publicId,
    venueId: centro.venueId,
  });
  await json(centro.smu.api, 'post', `contracts/${contrato.publicId}/activate`);

  return { socio, memberId: canje.memberId };
}

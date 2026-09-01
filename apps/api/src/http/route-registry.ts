import type { ZodType } from 'zod';
import type { ErrorCode } from '@laplace/schemas';
import type { PermissionRequest } from '../auth/permissions.js';

/**
 * Registro de rutas de negocio. Existe para que la suite de aislamiento
 * (`tests/tenant-isolation.test.ts`) pueda recorrerlas todas sin que nadie
 * tenga que acordarse de sumarlas a mano.
 *
 * **Una ruta bajo `/api/v1` que no este registrada rompe el CI.** Es a
 * proposito: el olvido tipico no es escribir mal el aislamiento, es agregar un
 * endpoint y no testearlo.
 */
export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RouteSpec {
  method: HttpMethod;
  /** Path completo, con los parametros como `:id`. Ej: `/api/v1/members/:id`. */
  path: string;
  /** Permiso que exige, si exige alguno. Documenta la matriz de F0-02. */
  permission?: PermissionRequest;
  /**
   * `false` solo para rutas que de verdad no tocan datos de un tenant
   * (health, catalogos globales de solo lectura). Cada `false` es una excepcion
   * y hay que poder justificarla en la revision.
   */
  tenantScoped: boolean;
  /**
   * Como atacar la ruta desde otro tenant: siembra un recurso del tenant
   * victima y devuelve el path concreto. `null` para las no scoped.
   */
  isolationFixture?: IsolationFixture | undefined;

  // ── Documentacion (F0-09) ────────────────────────────────────────────────
  /**
   * El OpenAPI se genera desde estos schemas Zod, no se escribe a mano
   * (ADR-003): escrito a mano se desactualiza siempre.
   */
  summary?: string | undefined;
  tags?: readonly string[] | undefined;
  request?:
    | {
        params?: ZodType | undefined;
        query?: ZodType | undefined;
        body?: ZodType | undefined;
      }
    | undefined;
  response?: { status: number; schema: ZodType } | undefined;
  /** Codigos de `docs/errors.md` que esta ruta puede devolver. */
  errorCodes?: readonly ErrorCode[] | undefined;
}

export interface IsolationSeedContext {
  /** Contexto del tenant victima, ya abierto: lo sembrado le pertenece a el. */
  victimTenantId: string;
}

export interface IsolationAttack {
  /** Path concreto que el atacante va a pedir, con los IDs de la victima. */
  path: string;
  body?: unknown;
}

export type IsolationFixture = (context: IsolationSeedContext) => Promise<IsolationAttack>;

const registry = new Map<string, RouteSpec>();

const keyOf = (method: HttpMethod, path: string) => `${method} ${path}`;

export function registerRoute(spec: RouteSpec): RouteSpec {
  registry.set(keyOf(spec.method, spec.path), spec);
  return spec;
}

export function registerRoutes(specs: RouteSpec[]): RouteSpec[] {
  for (const spec of specs) registerRoute(spec);
  return specs;
}

export function allRegisteredRoutes(): RouteSpec[] {
  return [...registry.values()];
}

export function findRegisteredRoute(method: string, path: string): RouteSpec | undefined {
  return registry.get(keyOf(method.toUpperCase() as HttpMethod, path));
}

/** Solo para los tests: deja el registro como estaba. */
export function resetRouteRegistry(): void {
  registry.clear();
}

/**
 * Rutas bajo `/api/v1` que no son de negocio y por eso no se registran:
 * las de Better Auth, que traen su propio aislamiento por sesion, y la doc.
 */
export const UNREGISTERED_PREFIXES = ['/api/v1/auth', '/api/v1/docs', '/api/v1/openapi'] as const;

export function requiresRegistration(path: string): boolean {
  if (!path.startsWith('/api/v1')) return false;
  return !UNREGISTERED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

import { createAccessControl } from 'better-auth/plugins/access';

/**
 * Matriz de permisos de Laplace: recurso + accion, no rol fijo (spec §1.1).
 *
 * ⚠️ `member`, `organization` e `invitation` estan **reservados por Better
 * Auth**: son la gestion de accesos del staff (quien pertenece a la
 * organizacion y con que rol). El socio del centro — el `Member` de §5.2.2 —
 * se llama aca `athlete`, justamente para no pisarlos: si el socio se llamara
 * `member`, darle `member.create` a un recepcionista para que dé de alta socios
 * le daria tambien permiso para invitar usuarios staff.
 */
export const LAPLACE_STATEMENT = {
  // ── Gestion de accesos (Better Auth) ──────────────────────────────────────
  organization: ['update', 'delete'],
  member: ['create', 'update', 'delete'],
  invitation: ['create', 'cancel'],

  // ── Negocio ───────────────────────────────────────────────────────────────
  /** El socio del centro. `Member` en el modelo de datos (§5.2.2). */
  athlete: ['create', 'read', 'update', 'archive', 'import'],
  /** Notas internas del staff. Nunca visibles para el socio (§2.1.7). */
  athleteNote: ['read', 'write'],
  venue: ['create', 'read', 'update', 'archive'],
  room: ['create', 'read', 'update', 'archive'],
  product: ['create', 'read', 'update', 'archive'],
  contract: ['create', 'read', 'freeze', 'adjust', 'cancel'],
  classSession: ['create', 'read', 'update', 'cancel'],
  booking: ['create', 'read', 'cancel', 'createForOther'],
  attendance: ['read', 'checkIn'],
  waiver: ['read', 'publish', 'accept'],
  /**
   * `read` es la campana y las preferencias propias: siempre sobre el usuario
   * de la sesion, nunca sobre otro. `manageTemplates` es editar los textos que
   * salen a nombre del centro, y `viewDeliveryLog` es ver los avisos de TODOS
   * — la respuesta a "no me llego", que incluye montos de cuotas ajenas.
   */
  notification: ['read', 'manageTemplates', 'viewDeliveryLog'],
  billing: ['read', 'charge', 'collect', 'refund'],
  /** Ingresos, morosidad, churn. El staff no accede (§2.1.12). */
  businessMetrics: ['read'],
  planning: ['create', 'read', 'update', 'publish'],
  exercise: ['create', 'read', 'update'],
  result: ['create', 'read'],
  health: ['read'],
} as const;

export const ac = createAccessControl(LAPLACE_STATEMENT);

/** Todo lo declarado en el statement, para el rol que no tiene techo. */
const everything = Object.fromEntries(
  Object.entries(LAPLACE_STATEMENT).map(([resource, actions]) => [resource, [...actions]]),
) as { [K in keyof typeof LAPLACE_STATEMENT]: Array<(typeof LAPLACE_STATEMENT)[K][number]> };

/** El SMU: dueño de la cuenta, sin techo dentro de su organizacion. */
const owner = ac.newRole(everything);

/**
 * Todo salvo metricas de negocio y facturacion (§1.1). Tampoco gestiona
 * accesos: invitar y quitar usuarios staff es del owner.
 */
const managerAssistant = ac.newRole({
  athlete: ['create', 'read', 'update', 'archive', 'import'],
  athleteNote: ['read', 'write'],
  venue: ['read', 'update'],
  room: ['create', 'read', 'update', 'archive'],
  product: ['create', 'read', 'update', 'archive'],
  contract: ['create', 'read', 'freeze', 'adjust', 'cancel'],
  classSession: ['create', 'read', 'update', 'cancel'],
  booking: ['create', 'read', 'cancel', 'createForOther'],
  attendance: ['read', 'checkIn'],
  waiver: ['read', 'publish'],
  notification: ['read', 'manageTemplates', 'viewDeliveryLog'],
  planning: ['create', 'read', 'update', 'publish'],
  exercise: ['create', 'read', 'update'],
  result: ['create', 'read'],
});

/** Ve sus clases, toma asistencia, carga resultados y ve la salud de sus atletas (§1.1). */
const coach = ac.newRole({
  athlete: ['read'],
  athleteNote: ['read', 'write'],
  venue: ['read'],
  room: ['read'],
  product: ['read'],
  contract: ['read'],
  classSession: ['read'],
  booking: ['create', 'read', 'cancel'],
  attendance: ['read', 'checkIn'],
  waiver: ['read'],
  notification: ['read'],
  planning: ['read'],
  exercise: ['read'],
  result: ['create', 'read'],
  health: ['read'],
});

/** Coach + CRUD de planificaciones y ejercicios (§1.1). */
const headCoach = ac.newRole({
  athlete: ['read'],
  athleteNote: ['read', 'write'],
  venue: ['read'],
  room: ['read'],
  product: ['read'],
  contract: ['read'],
  classSession: ['create', 'read', 'update', 'cancel'],
  booking: ['create', 'read', 'cancel'],
  attendance: ['read', 'checkIn'],
  waiver: ['read'],
  notification: ['read'],
  planning: ['create', 'read', 'update', 'publish'],
  exercise: ['create', 'read', 'update'],
  result: ['create', 'read'],
  health: ['read'],
});

/** Mostrador: alta de socios, venta de packs, cobros y check-in manual (§1.1). */
const frontDesk = ac.newRole({
  athlete: ['create', 'read', 'update'],
  athleteNote: ['read', 'write'],
  venue: ['read'],
  room: ['read'],
  product: ['read'],
  contract: ['create', 'read', 'freeze'],
  classSession: ['read'],
  booking: ['create', 'read', 'cancel', 'createForOther'],
  attendance: ['read', 'checkIn'],
  waiver: ['read'],
  notification: ['read'],
  /** Cobra y ve el estado de cuenta para poder cobrar. El reembolso es del owner. */
  billing: ['read', 'charge', 'collect'],
  exercise: ['read'],
});

/** El socio (MU): opera sobre lo suyo desde la WAFM. */
const member = ac.newRole({
  product: ['read'],
  classSession: ['read'],
  booking: ['create', 'read', 'cancel'],
  /** Ve sus documentos pendientes y los firma. Nunca publica (§2.1.20). */
  waiver: ['read', 'accept'],
  notification: ['read'],
  planning: ['read'],
  exercise: ['read'],
  result: ['create', 'read'],
});

export const ORG_ROLES = {
  owner,
  manager_assistant: managerAssistant,
  head_coach: headCoach,
  coach,
  front_desk: frontDesk,
  member,
} as const;

export type OrgRoleName = keyof typeof ORG_ROLES;

export const ORG_ROLE_NAMES = Object.keys(ORG_ROLES) as OrgRoleName[];

export type PermissionRequest = {
  [K in keyof typeof LAPLACE_STATEMENT]?: Array<(typeof LAPLACE_STATEMENT)[K][number]>;
};

/**
 * Resuelve la autorizacion. **Siempre en el servidor** (spec §2.1.1): lo que el
 * cliente diga sobre su rol no se lee nunca; `checkRolePermission` en el front
 * solo decide si se pinta el boton.
 *
 * Alcanza con que uno de los roles lo permita, y se exigen TODAS las acciones
 * pedidas. Un rol desconocido no autoriza y no rompe: fallar cerrado.
 */
export function authorize(roleNames: readonly string[], request: PermissionRequest): boolean {
  return roleNames.some((name) => {
    const role = ORG_ROLES[name as OrgRoleName];
    return role ? role.authorize(request).success : false;
  });
}

/** Los roles que un miembro puede tener, tal como se guardan (coma-separados). */
export function parseRoleNames(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
}

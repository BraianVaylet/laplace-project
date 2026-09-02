import { Temporal } from '@js-temporal/polyfill';
import type { CreateInviteCodeInput, RedeemInviteCodeInput, RedeemResult } from '@laplace/schemas';
import { AppError } from '../../../http/errors.js';
import { fromBsonDate, toBsonDate } from '../../../persistence/bson-date.js';
import { runWithTenant } from '../../../tenancy/context.js';
import type { Page } from '../../../tenancy/repository.js';
import { generateInviteCode, resolveInviteCodeStatus } from '../domain/invite-code.js';
import type { InviteCodeDoc } from '../infrastructure/invite-code.model.js';
import type { InviteCodeRepository } from '../infrastructure/invite-code.repository.js';
import type { MemberRepository } from '../infrastructure/member.repository.js';

/** Cuántas veces se reintenta si el código generado ya existía. */
const GENERATION_ATTEMPTS = 5;

/**
 * Suma al usuario a la organización del centro. Lo contesta Better Auth desde
 * el punto de composición: el módulo no conoce la librería de identidad.
 */
export interface OrganizationMembershipPort {
  add(params: { userId: string; organizationId: string }): Promise<void>;
}

export interface InviteCodeServiceDeps {
  codes: InviteCodeRepository;
  members: MemberRepository;
  memberships: OrganizationMembershipPort;
  now?: (() => Temporal.Instant) | undefined;
}

export class InviteCodeService {
  private readonly codes: InviteCodeRepository;
  private readonly members: MemberRepository;
  private readonly memberships: OrganizationMembershipPort;
  private readonly now: () => Temporal.Instant;

  constructor(deps: InviteCodeServiceDeps) {
    this.codes = deps.codes;
    this.members = deps.members;
    this.memberships = deps.memberships;
    this.now = deps.now ?? (() => Temporal.Now.instant());
  }

  async create(input: CreateInviteCodeInput): Promise<InviteCodeDoc> {
    const expiresAt = Temporal.Instant.from(input.expiresAt);
    if (Temporal.Instant.compare(expiresAt, this.now()) <= 0) {
      throw new AppError({
        code: 'LP-MEMB-422-005',
        status: 422,
        message: 'El código no es válido, ya venció o se agotó.',
        meta: { reason: 'la fecha de vencimiento ya pasó' },
      });
    }

    /*
     * El indice unico global de `code` hace que un choque sea practicamente
     * imposible (31^8 combinaciones), pero "practicamente" no es "nunca": si
     * choca, se reintenta en vez de devolverle un 500 al centro.
     */
    let lastError: unknown;
    for (let attempt = 0; attempt < GENERATION_ATTEMPTS; attempt += 1) {
      try {
        return await this.codes.create({
          code: generateInviteCode(),
          venueId: input.venueId,
          maxUses: input.maxUses,
          usedCount: 0,
          expiresAt: toBsonDate(expiresAt),
          revokedAt: null,
        } as Partial<InviteCodeDoc>);
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        lastError = error;
      }
    }

    throw new AppError({
      code: 'LP-SYS-500-001',
      status: 500,
      message: 'Ocurrió un error. Compartí el código con soporte.',
      meta: { reason: 'no se pudo generar un código único' },
      cause: lastError,
    });
  }

  async list(cursor?: string, limit?: number): Promise<Page<InviteCodeDoc>> {
    return this.codes.list(
      {},
      {
        sortField: 'createdAt',
        direction: 'desc',
        ...(cursor ? { cursor } : {}),
        ...(limit ? { limit } : {}),
      },
    );
  }

  /**
   * Corta el código de inmediato. No toca a quienes ya lo usaron: son socios del
   * centro por derecho propio, y desasociarlos por revocar un código sería un
   * efecto que nadie pidió.
   */
  async revoke(publicId: string): Promise<InviteCodeDoc> {
    const code = await this.codes.findByPublicId(publicId);
    if (!code) throw notFound(publicId);

    const updated = await this.codes.updateByPublicId(publicId, {
      $set: { revokedAt: toBsonDate(this.now()) },
    });
    if (!updated) throw notFound(publicId);

    return updated;
  }

  /**
   * Canje. Ocurre **antes** de que la persona pertenezca a ningún centro: el
   * tenant sale del código, que es el único dato que hay.
   *
   * El consumo del uso es atómico (`findOneAndUpdate` con `$expr`), así que dos
   * canjes simultáneos del último lugar no pueden ganar los dos.
   */
  async redeem(input: RedeemInviteCodeInput, userId: string): Promise<RedeemResult> {
    const { code } = input;
    const consumed = await this.codes.consumeGlobally(code, this.now());

    /*
     * Un solo error para vencido, agotado, revocado e inexistente (§11.2). Es
     * deliberadamente ambiguo: distinguirlos le diria a quien prueba codigos al
     * azar cuales existen.
     */
    if (!consumed) throw invalidCode();

    const tenantId = String(consumed['tenantId']);

    try {
      const member = await runWithTenant(
        { tenantId, userId, requestId: `redeem-${code}` },
        async () => {
          const existing = await this.members.findOne({ userId });
          // Canjear dos veces no crea dos fichas: la persona ya es socia.
          if (existing) return existing;

          return this.members.create({
            venueIds: [consumed.venueId],
            userId,
            firstName: input.firstName,
            lastName: input.lastName,
            status: 'lead',
            flags: { debtor: false, suspended: false },
            tags: [],
            balanceCents: 0,
            joinedAt: toBsonDate(this.now()),
            lastAttendanceAt: null,
            notes: [],
          } as never);
        },
      );

      await this.memberships.add({ userId, organizationId: tenantId });

      return {
        memberId: String(member['publicId']),
        venueId: consumed.venueId,
        organizationId: tenantId,
      };
    } catch (error) {
      /*
       * El uso ya se consumio. Se devuelve para que un fallo posterior no le
       * queme un lugar al centro. No es una transaccion: F1-14 introduce esa
       * plumbing cuando la necesite de verdad, y acá el peor caso de que la
       * compensacion tambien falle es un cupo de menos, no un dato inconsistente.
       */
      await this.codes.releaseGlobally(code).catch(() => undefined);
      throw error;
    }
  }

  /** El estado que ve el staff. Es derivado, no un campo guardado. */
  statusOf(code: InviteCodeDoc): ReturnType<typeof resolveInviteCodeStatus> {
    return resolveInviteCodeStatus(
      {
        revokedAt: code.revokedAt ? fromBsonDate(code.revokedAt) : null,
        expiresAt: fromBsonDate(code.expiresAt),
        usedCount: code.usedCount,
        maxUses: code.maxUses,
      },
      this.now(),
    );
  }
}

function notFound(publicId: string): AppError {
  return new AppError({
    code: 'LP-MEMB-404-003',
    status: 404,
    message: 'No encontramos ese código.',
    meta: { publicId },
  });
}

function invalidCode(): AppError {
  return new AppError({
    code: 'LP-MEMB-422-005',
    status: 422,
    message: 'El código no es válido, ya venció o se agotó.',
    action: 'Pedile al centro un código nuevo.',
  });
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}

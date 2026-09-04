import type { Temporal } from '@js-temporal/polyfill';
import {
  IMPERSONATION_MINUTES,
  type ChangeSubscriberStatusInput,
  type FiscalData,
  type Impersonation,
  type ImpersonateInput,
  type Plan,
  type PlanChangeResult,
  type SignUpSubscriberInput,
  type SubscriberStatus,
  type Subscription,
  type SubscriptionPlanId,
  type UpdatePlanPriceInput,
} from '@laplace/schemas';
import type { AuditWriter } from '../../../audit/audit-log.js';
import type { DomainEventBus } from '../../../events/bus.js';
import { AppError } from '../../../http/errors.js';
import { fromBsonDate, toBsonDate } from '../../../persistence/bson-date.js';
import { runWithTenant } from '../../../tenancy/context.js';
import {
  assertFitsInPlan,
  assertTransition,
  assertValidCuit,
  periodEndsAt,
  planChangeKindOf,
  prorate,
  trialEndsAt,
} from '../domain/subscription.js';
import type { PlanDoc, SubscriptionDoc } from '../infrastructure/susc.model.js';
import type { PlanRepository, SubscriptionRepository } from '../infrastructure/susc.repository.js';
import type { OrganizationCreator, PlanLimitsLookup, UsageLookup } from './ports.js';

export interface SuscServiceDeps {
  subscriptions: SubscriptionRepository;
  plans: PlanRepository;
  organizations: OrganizationCreator;
  usage: UsageLookup;
  limits: PlanLimitsLookup;
  audit: AuditWriter;
  events: DomainEventBus;
  now: () => Temporal.Instant;
}

/**
 * El ciclo de vida del suscriptor (§2.1.3) y de su plan (§2.1.4).
 *
 * 🔴 **Nunca se borra por falta de pago.** Suspender es cambiar un estado: los
 * socios, la agenda y la caja del centro siguen exactamente donde estaban, y
 * el día que paga vuelve a entrar y encuentra todo. Es una promesa del
 * producto, no un detalle de implementación.
 */
export class SuscService {
  constructor(private readonly deps: SuscServiceDeps) {}

  // ── Alta ──────────────────────────────────────────────────────────────────

  /**
   * El alta self-service de la landing (§2.1.3). **Sin tarjeta** (ADR-004):
   * pedirla acá es la forma más rápida de perder a quien quería probar.
   */
  async signUp(input: SignUpSubscriberInput, ownerUserId: string): Promise<Subscription> {
    const plan = await this.planOrFail(input.planId);
    const slug = input.slug ?? slugify(input.centerName);

    const { organizationId } = await this.deps.organizations.create({
      name: input.centerName,
      slug,
      ownerUserId,
    });

    const ahora = this.deps.now();
    const creada = await this.deps.subscriptions.create({
      organizationId,
      centerName: input.centerName,
      planId: input.planId,
      // El precio queda congelado desde el minuto cero (§2.1.4).
      priceSnapshotCents: plan.priceCents,
      timeZone: input.timeZone,
      trialEndsAt: trialEndsAt(ahora, input.timeZone),
      currentPeriodEndsAt: periodEndsAt(ahora, input.timeZone),
    });

    if (!creada) {
      throw new AppError({
        code: 'LP-SUSC-409-002',
        status: 409,
        message: 'Ya hay una cuenta con ese nombre.',
        meta: { organizationId },
      });
    }

    return toResponse(creada);
  }

  async mine(organizationId: string): Promise<Subscription> {
    return toResponse(await this.orFail(organizationId));
  }

  // ── Planes ────────────────────────────────────────────────────────────────

  /** El catálogo que muestra la landing. Público: no exige sesión. */
  async catalog(): Promise<Plan[]> {
    return (await this.deps.plans.all()).map(toPlanResponse);
  }

  /**
   * 🔴 Cambiar el precio del plan **no** cambia lo que paga quien ya está
   * suscripto (§2.1.4). Esto toca el catálogo y nada más: los
   * `priceSnapshotCents` existentes ni se miran.
   */
  async updatePlanPrice(planId: SubscriptionPlanId, input: UpdatePlanPriceInput): Promise<Plan> {
    const plan = await this.planOrFail(planId);

    const guardado = await this.deps.plans.save({
      ...plan,
      priceCents: input.priceCents,
      effectiveFrom: input.effectiveFrom,
    });

    return toPlanResponse(guardado);
  }

  /**
   * Cambiar de plan (§2.1.4): **subir es inmediato y con prorrateo; bajar es
   * al fin del ciclo**, y antes se valida que lo que ya tiene entre en el plan
   * nuevo.
   *
   * El downgrade queda pendiente en vez de aplicarse: quien pagó el mes de Pro
   * tiene derecho a usarlo hasta que termine.
   */
  async changePlan(organizationId: string, to: SubscriptionPlanId): Promise<PlanChangeResult> {
    const actual = await this.orFail(organizationId);
    const destino = await this.planOrFail(to);
    const kind = planChangeKindOf(actual.planId, to);
    const ahora = this.deps.now();

    if (kind === 'same') {
      return {
        subscription: toResponse(actual),
        kind,
        proratedCents: 0,
        effectiveAt: ahora.toString(),
      };
    }

    if (kind === 'downgrade') {
      // Se valida ANTES de agendar el cambio: descubrirlo el día del corte
      // dejaría al centro con la cuenta rota y sin margen para arreglarlo.
      assertFitsInPlan(to, await this.deps.usage.of(organizationId), this.deps.limits.of(to));

      const actualizada = await this.deps.subscriptions.update(organizationId, {
        pendingPlanId: to,
      });

      return {
        subscription: toResponse(actualizada ?? actual),
        kind,
        proratedCents: 0,
        effectiveAt: (actual.currentPeriodEndsAt
          ? fromBsonDate(actual.currentPeriodEndsAt)
          : ahora
        ).toString(),
      };
    }

    const proratedCents = prorate({
      fromPriceCents: actual.priceSnapshotCents,
      toPriceCents: destino.priceCents,
      now: ahora,
      periodEndsAt: actual.currentPeriodEndsAt
        ? fromBsonDate(actual.currentPeriodEndsAt)
        : periodEndsAt(ahora, actual.timeZone),
      timeZone: actual.timeZone,
    });

    const actualizada = await this.deps.subscriptions.update(organizationId, {
      planId: to,
      // El precio nuevo pasa a ser el suyo: es el que acaba de aceptar.
      priceSnapshotCents: destino.priceCents,
      pendingPlanId: null,
    });

    await this.deps.events.emit('subscription.plan_changed', {
      organizationId,
      from: actual.planId,
      to,
      proratedCents,
    });

    return {
      subscription: toResponse(actualizada ?? actual),
      kind,
      proratedCents,
      effectiveAt: ahora.toString(),
    };
  }

  // ── Estado ────────────────────────────────────────────────────────────────

  async changeStatus(
    organizationId: string,
    input: ChangeSubscriberStatusInput,
  ): Promise<Subscription> {
    const actual = await this.orFail(organizationId);
    assertTransition(actual.status, input.to);

    const actualizada = await this.deps.subscriptions.update(organizationId, {
      status: input.to,
      // Salir del trial lo cierra: no se vuelve a probar (§14).
      ...(input.to !== 'trial' && actual.status === 'trial' ? { trialEndsAt: null } : {}),
    });

    await this.recordStatusChange(organizationId, actual.status, input.to, input.reason);

    return toResponse(actualizada ?? actual);
  }

  /**
   * El job que cierra los trials vencidos (§2.1.3).
   *
   * Pasa a `suspended`, **no borra nada**: los 40 socios y la agenda del centro
   * siguen ahí, y el día que elige un plan vuelve a entrar y los encuentra.
   */
  async expireTrials(): Promise<number> {
    const vencidos = await this.deps.subscriptions.expiredTrials(this.deps.now());
    let suspendidos = 0;

    for (const suscripcion of vencidos) {
      await this.deps.subscriptions.update(suscripcion.organizationId, { status: 'suspended' });
      await this.recordStatusChange(
        suscripcion.organizationId,
        'trial',
        'suspended',
        'El trial de 14 días terminó sin plan contratado.',
      );
      suspendidos += 1;
    }

    return suspendidos;
  }

  /** El job que aplica los downgrades cuando el ciclo pagado termina. */
  async applyPendingPlanChanges(): Promise<number> {
    const pendientes = await this.deps.subscriptions.duePlanChanges(this.deps.now());
    let aplicados = 0;

    for (const suscripcion of pendientes) {
      const destino = suscripcion.pendingPlanId;
      if (!destino) continue;

      const plan = await this.deps.plans.find(destino);
      if (!plan) continue;

      await this.deps.subscriptions.update(suscripcion.organizationId, {
        planId: destino,
        priceSnapshotCents: plan.priceCents,
        pendingPlanId: null,
        currentPeriodEndsAt: toBsonDate(periodEndsAt(this.deps.now(), suscripcion.timeZone)),
      });

      await this.deps.events.emit('subscription.plan_changed', {
        organizationId: suscripcion.organizationId,
        from: suscripcion.planId,
        to: destino,
        proratedCents: 0,
      });

      aplicados += 1;
    }

    return aplicados;
  }

  // ── Datos fiscales ────────────────────────────────────────────────────────

  /** CUIT, razón social y condición de IVA, para el comprobante del SaaS (§2.1.3). */
  async setFiscal(organizationId: string, fiscal: FiscalData): Promise<Subscription> {
    await this.orFail(organizationId);
    assertValidCuit(fiscal.cuit);

    const actualizada = await this.deps.subscriptions.update(organizationId, { fiscal });

    return toResponse(actualizada as SubscriptionDoc);
  }

  // ── Impersonación ─────────────────────────────────────────────────────────

  /**
   * 🔴 El SAU entra a la cuenta de un suscriptor para dar soporte (§2.1.3,
   * ADR-004).
   *
   * Exige motivo, dura poco, queda en el `AuditLog` **del centro** y le avisa
   * al SMU. Un acceso de soporte que el dueño de la cuenta no puede ver es
   * indistinguible de una fuga, y la diferencia entre las dos cosas la tiene
   * que poder ver él, no nosotros.
   */
  async impersonate(input: ImpersonateInput, actorUserId: string): Promise<Impersonation> {
    const suscripcion = await this.orFail(input.organizationId);
    const desde = this.deps.now();
    const hasta = desde.add({ minutes: IMPERSONATION_MINUTES });

    await runWithTenant(
      {
        tenantId: input.organizationId,
        userId: actorUserId,
        requestId: `impersonation-${desde.epochMilliseconds}`,
      },
      async () => {
        await this.deps.audit.record({
          action: 'organization.impersonated',
          targetType: 'organization',
          targetId: input.organizationId,
          reason: input.reason,
          after: { expiresAt: hasta.toString() },
        });

        await this.deps.events.emit('organization.impersonated', {
          organizationId: input.organizationId,
          reason: input.reason,
          expiresAt: hasta.toString(),
        });
      },
    );

    return {
      organizationId: suscripcion.organizationId,
      reason: input.reason,
      startedAt: desde.toString(),
      expiresAt: hasta.toString(),
    };
  }

  // ── Internos ──────────────────────────────────────────────────────────────

  private async orFail(organizationId: string): Promise<SubscriptionDoc> {
    const suscripcion = await this.deps.subscriptions.ofOrganization(organizationId);
    if (suscripcion) return suscripcion;

    throw new AppError({
      code: 'LP-SYS-404-002',
      status: 404,
      message: 'No encontramos esa suscripción.',
      meta: { organizationId },
    });
  }

  private async planOrFail(planId: SubscriptionPlanId): Promise<PlanDoc> {
    const plan = await this.deps.plans.find(planId);
    if (plan) return plan;

    throw new AppError({
      code: 'LP-SUBS-422-001',
      status: 422,
      message: `No existe el plan ${planId}.`,
      meta: { planId },
    });
  }

  private async recordStatusChange(
    organizationId: string,
    from: SubscriberStatus,
    to: SubscriberStatus,
    reason?: string,
  ): Promise<void> {
    await runWithTenant(
      {
        tenantId: organizationId,
        userId: 'system:subscription',
        requestId: `subscription-${organizationId}-${to}`,
      },
      async () => {
        await this.deps.audit.record({
          action: 'subscription.status_changed',
          targetType: 'organization',
          targetId: organizationId,
          // El motivo es obligatorio en el log: un cambio de estado sin
          // explicacion no le sirve a nadie el dia que alguien pregunte.
          reason: reason ?? `Cambio de estado a ${to}.`,
          before: { status: from },
          after: { status: to },
        });

        await this.deps.events.emit('subscription.status_changed', {
          organizationId,
          from,
          to,
        });
      },
    );
  }
}

function toResponse(doc: SubscriptionDoc): Subscription {
  return {
    organizationId: doc.organizationId,
    centerName: doc.centerName,
    status: doc.status,
    planId: doc.planId,
    priceSnapshotCents: doc.priceSnapshotCents,
    currency: doc.currency as 'ARS',
    timeZone: doc.timeZone,
    trialEndsAt: doc.trialEndsAt ? fromBsonDate(doc.trialEndsAt).toString() : null,
    currentPeriodEndsAt: doc.currentPeriodEndsAt
      ? fromBsonDate(doc.currentPeriodEndsAt).toString()
      : null,
    pendingPlanId: doc.pendingPlanId,
    fiscal: doc.fiscal,
  };
}

function toPlanResponse(doc: PlanDoc): Plan {
  return {
    planId: doc.planId,
    name: doc.name,
    priceCents: doc.priceCents,
    currency: doc.currency as 'ARS',
    description: doc.description,
    highlights: doc.highlights,
  };
}

/**
 * El slug de la organización a partir del nombre del centro. Sin acentos y sin
 * espacios: va en la URL, y "Box Toro Bahía" tiene que poder escribirse.
 */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

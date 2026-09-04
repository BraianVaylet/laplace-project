import type { Temporal } from '@js-temporal/polyfill';
import type { SubscriptionPlanId } from '@laplace/schemas';
import { toBsonDate } from '../../../persistence/bson-date.js';
import { PlanModel, SubscriptionModel, type PlanDoc, type SubscriptionDoc } from './susc.model.js';

/** Falla cuando ya existe una suscripción para esa organización. */
function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}

/**
 * Acceso a las colecciones de plataforma.
 *
 * 🔴 **No hereda de `TenantRepository`** y no puede: estas filas no son de un
 * tenant, son sobre los tenants. El acotamiento es por `organizationId`
 * explícito, y quien lo pasa lo saca de la sesión — nunca del pedido
 * (ADR-000). Cada método lo recibe como primer argumento para que eso quede a
 * la vista en cada llamada.
 */
export class SubscriptionRepository {
  async ofOrganization(organizationId: string): Promise<SubscriptionDoc | null> {
    return SubscriptionModel.findOne({ organizationId }).lean<SubscriptionDoc>().exec();
  }

  /** `null` cuando ya había una: dos suscripciones de una organización no existen. */
  async create(data: {
    organizationId: string;
    centerName: string;
    planId: SubscriptionPlanId;
    priceSnapshotCents: number;
    timeZone: string;
    trialEndsAt: Temporal.Instant;
    currentPeriodEndsAt: Temporal.Instant;
  }): Promise<SubscriptionDoc | null> {
    try {
      const created = await SubscriptionModel.create({
        organizationId: data.organizationId,
        centerName: data.centerName,
        status: 'trial',
        planId: data.planId,
        priceSnapshotCents: data.priceSnapshotCents,
        currency: 'ARS',
        timeZone: data.timeZone,
        trialEndsAt: toBsonDate(data.trialEndsAt),
        currentPeriodEndsAt: toBsonDate(data.currentPeriodEndsAt),
        pendingPlanId: null,
        fiscal: null,
      });

      return created.toObject();
    } catch (error) {
      if (isDuplicateKey(error)) return null;

      throw error;
    }
  }

  async update(
    organizationId: string,
    patch: Partial<SubscriptionDoc>,
  ): Promise<SubscriptionDoc | null> {
    return SubscriptionModel.findOneAndUpdate({ organizationId }, { $set: patch }, { new: true })
      .lean<SubscriptionDoc>()
      .exec();
  }

  /** Los trials que ya se vencieron. Los busca el job, sin contexto de tenant. */
  async expiredTrials(now: Temporal.Instant, limit = 500): Promise<SubscriptionDoc[]> {
    return SubscriptionModel.find({ status: 'trial', trialEndsAt: { $lte: toBsonDate(now) } })
      .limit(limit)
      .lean<SubscriptionDoc[]>()
      .exec();
  }

  /** Los downgrades cuyo ciclo ya terminó: es cuando el plan baja de verdad. */
  async duePlanChanges(now: Temporal.Instant, limit = 500): Promise<SubscriptionDoc[]> {
    return SubscriptionModel.find({
      pendingPlanId: { $ne: null },
      currentPeriodEndsAt: { $lte: toBsonDate(now) },
    })
      .limit(limit)
      .lean<SubscriptionDoc[]>()
      .exec();
  }
}

export class PlanRepository {
  async all(): Promise<PlanDoc[]> {
    return PlanModel.find().sort({ priceCents: 1 }).lean<PlanDoc[]>().exec();
  }

  async find(planId: SubscriptionPlanId): Promise<PlanDoc | null> {
    return PlanModel.findOne({ planId }).lean<PlanDoc>().exec();
  }

  /**
   * Guarda el plan, creándolo si no estaba. El catálogo lo siembra el arranque
   * y lo edita el SAU: en los dos casos la operación es "que quede así".
   */
  async save(data: PlanDoc): Promise<PlanDoc> {
    return PlanModel.findOneAndUpdate(
      { planId: data.planId },
      { $set: data },
      { new: true, upsert: true },
    )
      .lean<PlanDoc>()
      .exec();
  }
}

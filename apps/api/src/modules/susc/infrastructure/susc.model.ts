import mongoose, { Schema, type Model } from 'mongoose';
import {
  CURRENCIES,
  IVA_CONDITIONS,
  SUBSCRIBER_STATUSES,
  type IvaCondition,
  type SubscriberStatus,
  type SubscriptionPlanId,
} from '@laplace/schemas';
import { COLLECTIONS } from '../../../persistence/collections.js';

/**
 * Modelos de Suscriptions. **Solo los usa el repositorio** (ADR-000).
 *
 * 🔴 **No llevan `tenantPlugin`, y es a propósito.** Estas dos colecciones no
 * son datos *de* un centro: son datos *sobre* los centros. La suscripción es
 * la relación entre Laplace y el suscriptor, y el SAU la consulta cruzando
 * todos ellos — acotarla por `tenantId` haría imposible el panel del DFSA.
 *
 * Son colecciones de plataforma, como `jobLock` o `loginAttempt`. Se acotan por
 * `organizationId` explícito, que es su clave natural, y ninguna ruta de un
 * suscriptor puede leer la fila de otro: eso lo garantiza el servicio, que
 * saca el `organizationId` de la sesión y nunca del pedido (ADR-000).
 *
 * Tampoco llevan `publicId`: su clave es la que ya tienen. Un identificador
 * más sería uno más que mantener sincronizado sin que nadie lo dicte por
 * teléfono.
 */
export interface SubscriptionDoc extends Record<string, unknown> {
  organizationId: string;
  centerName: string;
  status: SubscriberStatus;
  planId: SubscriptionPlanId;
  /** Lo que este suscriptor paga, congelado al contratar (§2.1.4). */
  priceSnapshotCents: number;
  currency: string;
  timeZone: string;
  trialEndsAt: Date | null;
  currentPeriodEndsAt: Date | null;
  /** El plan al que baja al terminar el ciclo, si pidió bajar. */
  pendingPlanId: SubscriptionPlanId | null;
  fiscal: { cuit: string; businessName: string; ivaCondition: IvaCondition } | null;
  /**
   * Cuándo se dio de alta, con el reloj inyectable. **No se usa `createdAt`**:
   * Mongoose lo escribe con el reloj de pared, así que ningún test puede
   * moverlo, y de acá sale la métrica de §2.0 (F1-23 ya tropezó con esto).
   */
  signedUpAt: Date | null;
  /**
   * El asistente de §2.1.3. Guarda **solo lo que el usuario declara** —qué
   * salteó— y los dos hechos que no se pueden recalcular: cuándo terminó y
   * cuándo publicó su primera clase. El resto del progreso sale del estado
   * real del centro, contado en el momento.
   */
  onboarding: {
    skippedSteps: string[];
    completedAt: Date | null;
    firstClassPublishedAt: Date | null;
  };
}

const subscriptionSchema = new Schema<SubscriptionDoc>(
  {
    organizationId: { type: String, required: true },
    centerName: { type: String, required: true },
    status: { type: String, required: true, enum: SUBSCRIBER_STATUSES, default: 'trial' },
    planId: { type: String, required: true },
    priceSnapshotCents: { type: Number, required: true },
    currency: { type: String, required: true, enum: CURRENCIES, default: 'ARS' },
    timeZone: { type: String, required: true },
    trialEndsAt: { type: Date, required: false, default: null },
    currentPeriodEndsAt: { type: Date, required: false, default: null },
    pendingPlanId: { type: String, required: false, default: null },
    fiscal: {
      type: {
        cuit: { type: String, required: true },
        businessName: { type: String, required: true },
        ivaCondition: { type: String, required: true, enum: IVA_CONDITIONS },
      },
      required: false,
      default: null,
    },
    signedUpAt: { type: Date, required: false, default: null },
    onboarding: {
      type: {
        skippedSteps: { type: [String], required: true, default: [] },
        completedAt: { type: Date, required: false, default: null },
        firstClassPublishedAt: { type: Date, required: false, default: null },
      },
      required: true,
      default: () => ({ skippedSteps: [], completedAt: null, firstClassPublishedAt: null }),
    },
  },
  { collection: COLLECTIONS.subscription, timestamps: true },
);

export const SubscriptionModel: Model<SubscriptionDoc> =
  (mongoose.models[COLLECTIONS.subscription] as Model<SubscriptionDoc> | undefined) ??
  mongoose.model<SubscriptionDoc>(COLLECTIONS.subscription, subscriptionSchema);

/**
 * El catálogo de planes. Lo edita el SAU y lo lee la landing.
 *
 * El precio de acá es el **vigente para quien contrata hoy**. Lo que paga
 * quien ya está suscripto vive en su `priceSnapshotCents`, y cambiar este
 * número no lo toca (§2.1.4).
 */
export interface PlanDoc extends Record<string, unknown> {
  planId: SubscriptionPlanId;
  name: string;
  priceCents: number;
  currency: string;
  description: string;
  highlights: string[];
  /** Desde cuándo rige este precio. §2.1.4 exige avisar 30 días antes de subirlo. */
  effectiveFrom: string;
}

const planSchema = new Schema<PlanDoc>(
  {
    planId: { type: String, required: true },
    name: { type: String, required: true },
    priceCents: { type: Number, required: true },
    currency: { type: String, required: true, enum: CURRENCIES, default: 'ARS' },
    description: { type: String, required: true, default: '' },
    highlights: { type: [String], required: true, default: [] },
    effectiveFrom: { type: String, required: true },
  },
  { collection: COLLECTIONS.plan, timestamps: true },
);

export const PlanModel: Model<PlanDoc> =
  (mongoose.models[COLLECTIONS.plan] as Model<PlanDoc> | undefined) ??
  mongoose.model<PlanDoc>(COLLECTIONS.plan, planSchema);

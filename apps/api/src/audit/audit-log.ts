import { Temporal } from '@js-temporal/polyfill';
import mongoose, { Schema, type Model } from 'mongoose';
import { COLLECTIONS } from '../persistence/collections.js';
import { toBsonDate } from '../persistence/bson-date.js';
import { requireTenant } from '../tenancy/context.js';
import { baseFieldsPlugin, tenantPlugin } from '../tenancy/plugin.js';

/**
 * Registro de acciones sensibles (§9). Existe para las operaciones donde el
 * "quien y por que" importa tanto como el resultado: un ajuste manual de
 * creditos, un reembolso, una impersonacion de soporte.
 *
 * No es un log: es un dato. El log de Pino rota y se borra; esto se consulta
 * seis meses despues cuando alguien pregunta por que su pack tenia 7 clases.
 */
export interface AuditLogDoc extends Record<string, unknown> {
  /** Que se hizo. Ej: `contract.credits_adjusted`. */
  action: string;
  /** Sobre que recurso. Se guarda el `publicId`, que es el que ve el usuario. */
  targetId: string;
  targetType: string;
  /** Obligatorio: una accion sensible sin motivo es indistinguible de un error. */
  reason: string;
  /** Antes y despues, para poder reconstruir. Nunca datos sensibles. */
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  at: Date;
}

const auditLogSchema = new Schema<AuditLogDoc>(
  {
    action: { type: String, required: true },
    targetId: { type: String, required: true },
    targetType: { type: String, required: true },
    reason: { type: String, required: true },
    before: { type: Schema.Types.Mixed, required: false },
    after: { type: Schema.Types.Mixed, required: false },
    at: { type: Date, required: true },
  },
  { collection: COLLECTIONS.auditLog },
);

auditLogSchema.plugin(tenantPlugin);
auditLogSchema.plugin(baseFieldsPlugin);

export const AuditLogModel: Model<AuditLogDoc> =
  (mongoose.models[COLLECTIONS.auditLog] as Model<AuditLogDoc> | undefined) ??
  mongoose.model<AuditLogDoc>(COLLECTIONS.auditLog, auditLogSchema);

export interface AuditEntry {
  action: string;
  targetType: string;
  targetId: string;
  reason: string;
  before?: Record<string, unknown> | undefined;
  after?: Record<string, unknown> | undefined;
}

/** Quien hace la accion sale del contexto de tenant, no del llamador. */
export interface AuditWriter {
  record(entry: AuditEntry): Promise<void>;
}

export function createAuditWriter(): AuditWriter {
  return {
    async record(entry) {
      const { userId } = requireTenant();

      await AuditLogModel.create({
        ...entry,
        at: toBsonDate(Temporal.Now.instant()),
        createdBy: userId,
        publicId: `aud_${Temporal.Now.instant().epochMilliseconds}_${Math.random().toString(36).slice(2, 10)}`,
      } as never);
    },
  };
}

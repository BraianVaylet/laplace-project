import type { FilterQuery } from 'mongoose';
import type { Temporal } from '@js-temporal/polyfill';
import { toBsonDate } from '../../../persistence/bson-date.js';
import { TenantRepository, sessionOption } from '../../../tenancy/repository.js';
import { ConsentModel, type ConsentDoc } from './consent.model.js';

/** Falla cuando ya existe `{ tenantId, userId, documentId }` (§5.2.3). */
function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}

export class ConsentRepository extends TenantRepository<ConsentDoc> {
  constructor() {
    super(ConsentModel, 'consent');
  }

  /** Los documentos que este usuario ya firmó, vivos (no revocados). */
  async liveOf(userId: string): Promise<ConsentDoc[]> {
    return ConsentModel.find(this.scope({ userId, revokedAt: null } as FilterQuery<ConsentDoc>))
      .setOptions(sessionOption())
      .lean<ConsentDoc[]>()
      .exec();
  }

  /**
   * Las firmas vivas de varios usuarios, en una sola consulta. Lo consume el
   * panel de alertas del DFSM (F1-24): preguntar socio por socio sobre 200
   * socios serian 200 consultas para pintar una tarjeta.
   */
  async liveOfUsers(userIds: readonly string[]): Promise<ConsentDoc[]> {
    if (userIds.length === 0) return [];

    return ConsentModel.find(
      this.scope({
        userId: { $in: [...userIds] },
        revokedAt: null,
      } as FilterQuery<ConsentDoc>),
    )
      .setOptions(sessionOption())
      .lean<ConsentDoc[]>()
      .exec();
  }

  /**
   * 🔴 Registra la aceptación, o devuelve la que ya existía.
   *
   * Aceptar el mismo documento dos veces (doble click) no es un error: es la
   * misma persona confirmando lo mismo. El único de la migración de F1-20
   * decide la carrera; acá solo se atiende el resultado.
   */
  async accept(data: {
    userId: string;
    documentId: string;
    documentType: string;
    version: number;
    contentHash: string;
    ip: string;
    userAgent: string;
    acceptedAt: Temporal.Instant;
  }): Promise<ConsentDoc> {
    try {
      return await this.create({
        userId: data.userId,
        documentId: data.documentId,
        documentType: data.documentType,
        version: data.version,
        contentHash: data.contentHash,
        ip: data.ip,
        userAgent: data.userAgent,
        acceptedAt: toBsonDate(data.acceptedAt),
        revokedAt: null,
      } as never);
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;

      const previa = await ConsentModel.findOne(
        this.scope({ userId: data.userId, documentId: data.documentId } as FilterQuery<ConsentDoc>),
      )
        .setOptions(sessionOption())
        .lean<ConsentDoc>()
        .exec();
      if (previa) return previa;

      throw error;
    }
  }

  /** Todas las firmas de un documento, para el panel de cumplimiento. */
  async ofDocument(
    documentId: string,
    options: { cursor?: string | undefined; limit?: number | undefined } = {},
  ) {
    return this.list({ documentId } as FilterQuery<ConsentDoc>, {
      ...options,
      sortField: 'acceptedAt',
      direction: 'desc',
    });
  }
}

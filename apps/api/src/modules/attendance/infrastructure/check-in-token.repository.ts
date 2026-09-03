import type { FilterQuery } from 'mongoose';
import type { Temporal } from '@js-temporal/polyfill';
import { toBsonDate } from '../../../persistence/bson-date.js';
import { TenantRepository } from '../../../tenancy/repository.js';
import { CheckInTokenModel, type CheckInTokenDoc } from './check-in-token.model.js';

export class CheckInTokenRepository extends TenantRepository<CheckInTokenDoc> {
  constructor() {
    super(CheckInTokenModel, 'checkInToken');
  }

  async issue(data: {
    memberId: string;
    userId: string;
    tokenHash: string;
    expiresAt: Temporal.Instant;
  }): Promise<CheckInTokenDoc> {
    return this.create({
      memberId: data.memberId,
      userId: data.userId,
      tokenHash: data.tokenHash,
      expiresAt: toBsonDate(data.expiresAt),
      usedAt: null,
    } as never);
  }

  async byHash(tokenHash: string): Promise<CheckInTokenDoc | null> {
    return this.findOne({ tokenHash } as FilterQuery<CheckInTokenDoc>);
  }

  /**
   * 🔴 Marca el token como usado y devuelve `null` si ya lo estaba.
   *
   * El `findOneAndUpdate` exige `usedAt: null` en la misma operacion: con un
   * `read` y despues un `write`, dos escaneos simultaneos del mismo QR leerian
   * los dos que esta libre y entrarian los dos. Es la misma forma del cupo de
   * la reserva (§2.1.5.e).
   */
  async consume(tokenHash: string, at: Temporal.Instant): Promise<CheckInTokenDoc | null> {
    return CheckInTokenModel.findOneAndUpdate(
      this.scope({ tokenHash, usedAt: null } as FilterQuery<CheckInTokenDoc>),
      { $set: { usedAt: toBsonDate(at) } },
      { new: true },
    )
      .lean<CheckInTokenDoc>()
      .exec();
  }
}

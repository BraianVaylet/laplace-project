import type { Temporal } from '@js-temporal/polyfill';
import type {
  AvatarUploaded,
  DeletionRequestInput,
  DeletionRequestResult,
  MyContract,
  MyDataExport,
  MyProfile,
  UpdateMyProfileInput,
} from '@laplace/schemas';
import { AppError } from '../../../http/errors.js';
import { assertUsableImage, extensionOf } from '../domain/image.js';
import type {
  MyBookingLookup,
  MyConsentLookup,
  MyContractLookup,
  MyMemberLookup,
  ObjectStorage,
} from './ports.js';

export interface AccountServiceDeps {
  members: MyMemberLookup;
  contracts: MyContractLookup;
  bookings: MyBookingLookup;
  consents: MyConsentLookup;
  storage: ObjectStorage;
  now: () => Temporal.Instant;
}

/** Cuántos días antes se destaca un pack por vencer, igual que el aviso (§2.1.2). */
const EXPIRING_SOON_DAYS = 7;

/** ADR-004, decisión 10: 90 días de retención después de la baja. */
const RETENTION_DAYS = 90;

/**
 * Lo del socio: sus packs, su perfil y sus derechos sobre sus datos (§2.1.2,
 * §9.2).
 *
 * 🔴 **Todo se resuelve con el `memberId` de la sesión.** Ningún método de acá
 * lo acepta de un parámetro del pedido: si lo aceptara, el socio podría pedir
 * los datos del compañero de al lado, y el aislamiento por tenant no lo taparía
 * porque los dos son del mismo centro. Quien llama saca el `memberId` de la
 * sesión antes de entrar.
 */
export class AccountService {
  constructor(private readonly deps: AccountServiceDeps) {}

  /** Los packs del socio: qué le queda, hasta cuándo y para qué clases sirve. */
  async myContracts(memberId: string): Promise<MyContract[]> {
    const contratos = await this.deps.contracts.ofMember(memberId);
    const hoy = this.deps.now();

    return contratos.map((contrato) => {
      // Una membresía no lleva créditos: se topea por período, no por clases.
      const cuentaCreditos = contrato.creditsTotal > 0;
      const daysLeft = contrato.endsAt ? diasHasta(hoy, contrato.endsAt) : null;

      return {
        contractId: contrato.contractId,
        productName: contrato.productName,
        productType: contrato.productType,
        status: contrato.status,
        creditsLeft: cuentaCreditos ? contrato.creditsTotal - contrato.creditsUsed : null,
        creditsTotal: cuentaCreditos ? contrato.creditsTotal : null,
        endsAt: contrato.endsAt ? contrato.endsAt.toString() : null,
        daysLeft,
        expiringSoon:
          contrato.status === 'active' && daysLeft !== null && daysLeft <= EXPIRING_SOON_DAYS,
        allowedCategories: contrato.allowedCategories,
        venueId: contrato.venueId,
      };
    });
  }

  async myProfile(memberId: string): Promise<MyProfile> {
    const ficha = await this.orFail(memberId);

    return {
      memberId,
      fullName: ficha.fullName,
      email: ficha.email,
      phone: ficha.phone,
      emergencyContact: ficha.emergencyContact,
      avatarUrl: ficha.avatarKey ? (await this.deps.storage.signedUrl(ficha.avatarKey)).url : null,
    };
  }

  async updateMyProfile(memberId: string, input: UpdateMyProfileInput): Promise<MyProfile> {
    await this.orFail(memberId);
    await this.deps.members.update(memberId, input);

    return this.myProfile(memberId);
  }

  /**
   * 🔴 La foto de perfil (§2.1.2).
   *
   * El tipo sale de **los bytes**, no de la extensión ni del `Content-Type`:
   * los dos los escribe quien sube el archivo. Lo que se guarda en la ficha es
   * la clave del objeto, y el enlace se firma cada vez — una URL pública
   * permanente de la foto de una persona es exactamente lo que no puede pasar.
   */
  async uploadAvatar(memberId: string, bytes: Uint8Array): Promise<AvatarUploaded> {
    const ficha = await this.orFail(memberId);
    const tipo = assertUsableImage(bytes);

    const key = `avatars/${memberId}-${this.deps.now().epochMilliseconds}.${extensionOf(tipo)}`;
    await this.deps.storage.put({ key, body: bytes, contentType: tipo });
    await this.deps.members.update(memberId, { avatarKey: key });

    // La anterior se borra: guardar todas las fotos viejas de una persona es
    // acumular datos que nadie pidió conservar.
    if (ficha.avatarKey) await this.deps.storage.remove(ficha.avatarKey).catch(() => undefined);

    const firmada = await this.deps.storage.signedUrl(key);

    return { avatarUrl: firmada.url, expiresAt: firmada.expiresAt.toString() };
  }

  /**
   * El derecho de acceso (§9.2, Ley 25.326): el titular se lleva **todo** lo
   * suyo, en JSON. Un resumen elegido por nosotros no cumple el derecho.
   */
  async exportMyData(memberId: string): Promise<MyDataExport> {
    return {
      exportedAt: this.deps.now().toString(),
      profile: await this.myProfile(memberId),
      contracts: await this.myContracts(memberId),
      bookings: await this.deps.bookings.ofMember(memberId),
      consents: await this.deps.consents.ofMember(memberId),
    };
  }

  /**
   * La baja se **pide**, no se ejecuta en el acto: el centro tiene
   * obligaciones sobre lo firmado y lo cobrado, y borrar ya mismo las
   * incumpliría. Queda registrada con fecha, que es lo que hace exigible el
   * plazo de 90 días (ADR-004, decisión 10).
   */
  async requestDeletion(
    memberId: string,
    input: DeletionRequestInput,
  ): Promise<DeletionRequestResult> {
    await this.orFail(memberId);
    const ahora = this.deps.now();

    await this.deps.members.requestDeletion(memberId, ahora, input.reason);

    return {
      requestedAt: ahora.toString(),
      purgeAfter: ahora.add({ hours: 24 * RETENTION_DAYS }).toString(),
    };
  }

  private async orFail(memberId: string) {
    const ficha = await this.deps.members.find(memberId);
    if (ficha) return ficha;

    throw new AppError({
      code: 'LP-MEMB-404-003',
      status: 404,
      message: 'No encontramos tu ficha de socio en este centro.',
      action: 'Pedile al centro que te asocie con un código de invitación.',
      meta: { memberId },
    });
  }
}

/** Días de calendario que faltan. Negativo si ya pasó. */
function diasHasta(desde: Temporal.Instant, hasta: Temporal.Instant): number {
  return Math.trunc(desde.until(hasta).total({ unit: 'hour' }) / 24);
}

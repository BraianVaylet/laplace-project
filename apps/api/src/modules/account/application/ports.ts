import type { Temporal } from '@js-temporal/polyfill';
import type { ImageType } from '../domain/image.js';

/**
 * Puertos de Account. Lo que necesita de afuera lo pide por interfaz
 * (ADR-003), y el almacenamiento de archivos además se inyecta para que
 * **ningún test suba nada a ningún lado**.
 */

/**
 * Dónde vive la foto de perfil.
 *
 * 🔴 `signedUrl` y no una URL pública: la foto de una persona no puede quedar
 * accesible para siempre a quien consiga el enlace (§2.1.2). Lo que se guarda
 * en la ficha es la **clave del objeto**, y el enlace se firma en cada lectura.
 */
export interface ObjectStorage {
  put(input: { key: string; body: Uint8Array; contentType: ImageType }): Promise<void>;
  signedUrl(key: string): Promise<{ url: string; expiresAt: Temporal.Instant }>;
  remove(key: string): Promise<void>;
}

/** Los packs del socio. Los contesta Contracts. */
export interface MyContractLookup {
  ofMember(memberId: string): Promise<
    Array<{
      contractId: string;
      productName: string;
      productType: string;
      status: string;
      creditsTotal: number;
      creditsUsed: number;
      endsAt: Temporal.Instant | null;
      allowedCategories: string[];
      venueId: string;
    }>
  >;
}

/** Las reservas del socio, para el export de sus datos (§9.2). */
export interface MyBookingLookup {
  ofMember(
    memberId: string,
  ): Promise<Array<{ bookingId: string; sessionId: string; status: string; bookedAt: string }>>;
}

/** Lo que el socio firmó. Lo contesta Waivers. */
export interface MyConsentLookup {
  ofMember(
    memberId: string,
  ): Promise<Array<{ documentType: string; version: number; acceptedAt: string }>>;
}

/** La ficha del socio. La contesta Members. */
export interface MyMemberLookup {
  find(memberId: string): Promise<{
    fullName: string;
    email: string | null;
    phone: string | null;
    emergencyContact: { fullName: string; phone: string; relationship?: string } | null;
    avatarKey: string | null;
  } | null>;
  update(
    memberId: string,
    patch: {
      phone?: string | undefined;
      email?: string | undefined;
      emergencyContact?:
        { fullName: string; phone: string; relationship?: string | undefined } | undefined;
      avatarKey?: string | undefined;
    },
  ): Promise<void>;
  /** Deja pedida la baja. No borra: el plazo lo corre un job (§9.2). */
  requestDeletion(memberId: string, at: Temporal.Instant, reason?: string): Promise<void>;
}

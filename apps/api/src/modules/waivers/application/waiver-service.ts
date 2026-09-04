import type { Temporal } from '@js-temporal/polyfill';
import type {
  ComplianceEntry,
  LegalDocument,
  PendingDocument,
  PublishLegalDocumentInput,
} from '@laplace/schemas';
import type { DomainEventBus } from '../../../events/bus.js';
import { AppError } from '../../../http/errors.js';
import { fromBsonDate, toBsonDate } from '../../../persistence/bson-date.js';
import { hashContent } from '../domain/content-hash.js';
import {
  GUARDIAN_CONSENT_TYPE,
  appliesTo,
  type DocumentRequirement,
} from '../domain/requirement.js';
import type { ConsentDoc } from '../infrastructure/consent.model.js';
import type { ConsentRepository } from '../infrastructure/consent.repository.js';
import type { LegalDocumentDoc } from '../infrastructure/legal-document.model.js';
import type { LegalDocumentRepository } from '../infrastructure/legal-document.repository.js';

/**
 * Lo que Waivers necesita de Members, por interfaz (ADR-003). Waivers no sabe
 * qué es un `Member`: firma la cuenta (`userId`), y quien pregunta "¿le falta
 * algo a este socio?" es quien conoce la relación entre las dos cosas.
 */
export interface WaiverMemberLookup {
  contextOf(memberId: string): Promise<{ userId: string | null; birthDate?: string } | null>;
  /** Para el panel de cumplimiento: a qué socio corresponde cada `userId`. */
  memberOf(userId: string): Promise<{ memberId: string; fullName: string } | null>;
  /**
   * Los contextos de varios socios de una vez. Lo usa el panel de alertas del
   * DFSM (F1-24): preguntar de a uno sobre 200 socios serían 200 consultas.
   */
  contextsOf(
    memberIds: readonly string[],
  ): Promise<Array<{ memberId: string; userId: string | null; birthDate?: string }>>;
}

export interface RequestContext {
  ip: string;
  userAgent: string;
}

export interface WaiverServiceDeps {
  documents: LegalDocumentRepository;
  consents: ConsentRepository;
  members: WaiverMemberLookup;
  events: DomainEventBus;
  now: () => Temporal.Instant;
}

export class WaiverService {
  private readonly documents: LegalDocumentRepository;
  private readonly consents: ConsentRepository;
  private readonly members: WaiverMemberLookup;
  private readonly events: DomainEventBus;
  private readonly now: () => Temporal.Instant;

  constructor(deps: WaiverServiceDeps) {
    this.documents = deps.documents;
    this.consents = deps.consents;
    this.members = deps.members;
    this.events = deps.events;
    this.now = deps.now;
  }

  /**
   * 🔴 Publica una versión nueva de un tipo de documento (§2.1.20).
   *
   * No hay "editar": publicar siempre crea una fila nueva con el siguiente
   * número de versión. Es lo que hace que la re-aceptación sea automática — la
   * versión anterior deja de ser "la vigente", y quien la había firmado pasa a
   * deberle la nueva sin que nadie tenga que correr un job.
   *
   * `guardian_consent` se publica **siempre** obligatorio: no es una decisión
   * que el SMU tenga que tomar cada vez, es la regla del tipo de documento.
   */
  async publish(input: PublishLegalDocumentInput): Promise<LegalDocument> {
    const anterior = await this.documents.latestOf(input.type);
    const version = (anterior?.version ?? 0) + 1;
    const required = input.type === GUARDIAN_CONSENT_TYPE ? true : input.required;

    const publicado = await this.documents.create({
      type: input.type,
      title: input.title,
      contentHtml: input.contentHtml,
      contentHash: hashContent(input.contentHtml),
      version,
      required,
      publishedAt: toBsonDate(this.now()),
    } as never);

    await this.events.emit('waiver.published', {
      documentId: String(publicado['publicId']),
      type: input.type,
      version,
      required,
    });

    return toDocumentResponse(publicado);
  }

  /**
   * Los documentos vigentes que le aplican a este socio, con su estado.
   *
   * Sin ficha, lista vacía y no un error: la ruta ya resolvió el `memberId`
   * desde la sesión antes de llamar acá, así que esto solo puede pasar si la
   * ficha se borró en el medio — y una lista vacía es la respuesta correcta
   * igual, no algo que romper.
   */
  async pendingFor(memberId: string): Promise<PendingDocument[]> {
    const contexto = await this.members.contextOf(memberId);
    if (!contexto) return [];

    const vigentes = (await this.documents.currentByType()).map(toDocumentResponse);
    const hoy = todayOf(this.now());
    const propios = vigentes.filter((doc) => appliesTo(toRequirement(doc), contexto, hoy));

    const firmados = contexto.userId ? await this.firmadosDe(contexto.userId) : new Set<string>();

    return propios.map((doc) => ({ ...doc, accepted: firmados.has(doc.publicId) }));
  }

  /**
   * 🔴 El puerto que consume Attendance (F1-18/F1-19): ¿le falta algo
   * obligatorio a este socio para entrar?
   *
   * Sin cuenta vinculada no hay nada que revisar — y nada que revisar es lo
   * mismo que decir que falta: no hay ningún consentimiento digital en pie.
   */
  async missingFor(memberId: string): Promise<boolean> {
    const contexto = await this.members.contextOf(memberId);
    if (!contexto?.userId) return true;

    const vigentes = (await this.documents.currentByType()).map(toDocumentResponse);
    const hoy = todayOf(this.now());
    const requeridos = vigentes.filter((doc) => appliesTo(toRequirement(doc), contexto, hoy));
    if (requeridos.length === 0) return false;

    const firmados = await this.firmadosDe(contexto.userId);

    return requeridos.some((doc) => !firmados.has(doc.publicId));
  }

  /**
   * 🔴 De estos socios, ¿a cuáles les falta firmar algo obligatorio?
   *
   * Es `missingFor` en bloque, para el panel de alertas del DFSM (F1-24): los
   * documentos vigentes se leen **una vez** y las firmas de todos en una sola
   * consulta. Preguntar socio por socio sobre 200 socios serían 400 consultas
   * para pintar una tarjeta.
   */
  async missingAmong(memberIds: readonly string[]): Promise<string[]> {
    if (memberIds.length === 0) return [];

    const vigentes = (await this.documents.currentByType()).map(toDocumentResponse);
    const hoy = todayOf(this.now());
    const contextos = await this.members.contextsOf(memberIds);

    const conCuenta = contextos.filter((contexto) => contexto.userId !== null);
    const firmasPorUsuario = new Map<string, Set<string>>();
    for (const consent of await this.consents.liveOfUsers(
      conCuenta.map((contexto) => contexto.userId as string),
    )) {
      const propias = firmasPorUsuario.get(consent.userId) ?? new Set<string>();
      propias.add(consent.documentId);
      firmasPorUsuario.set(consent.userId, propias);
    }

    return contextos
      .filter((contexto) => {
        const requeridos = vigentes.filter((doc) => appliesTo(toRequirement(doc), contexto, hoy));
        if (requeridos.length === 0) return false;
        // Sin cuenta vinculada no hay ningún consentimiento digital en pie.
        if (!contexto.userId) return true;

        const firmados = firmasPorUsuario.get(contexto.userId) ?? new Set<string>();

        return requeridos.some((doc) => !firmados.has(doc.publicId));
      })
      .map((contexto) => contexto.memberId);
  }

  /**
   * Lo que este socio firmó, para el export de sus datos (§9.2, F1-29). Es el
   * derecho de acceso: el titular se lleva lo suyo, incluido qué aceptó y
   * cuándo.
   */
  async selfConsentsOf(
    memberId: string,
  ): Promise<Array<{ documentType: string; version: number; acceptedAt: string }>> {
    const contexto = await this.members.contextOf(memberId);
    if (!contexto?.userId) return [];

    const firmas = await this.consents.liveOf(contexto.userId);

    return firmas.map((consent) => ({
      documentType: consent.documentType,
      version: consent.version,
      acceptedAt: fromBsonDate(consent.acceptedAt).toString(),
    }));
  }

  /**
   * Lo que el socio firmó, como lo mira el staff en la ficha 360 (§2.1.7).
   *
   * Marca `outdated` cuando el centro publicó una versión posterior: "firmó el
   * reglamento" y "firmó **este** reglamento" son cosas distintas, y la
   * diferencia es exactamente la que importa el día que alguien reclama.
   */
  async signedViewOf(memberId: string): Promise<
    Array<{
      documentId: string;
      title: string;
      version: number;
      acceptedAt: string;
      outdated: boolean;
    }>
  > {
    const contexto = await this.members.contextOf(memberId);
    if (!contexto?.userId) return [];

    const vigentes = new Map(
      (await this.documents.currentByType()).map(
        (doc) => [doc.type, { title: doc.title, version: doc.version }] as const,
      ),
    );

    return (await this.consents.liveOf(contexto.userId)).map((consent) => {
      const vigente = vigentes.get(consent.documentType);

      return {
        documentId: consent.documentId,
        title: vigente?.title ?? consent.documentType,
        version: consent.version,
        acceptedAt: fromBsonDate(consent.acceptedAt).toString(),
        outdated: vigente !== undefined && vigente.version > consent.version,
      };
    });
  }

  /**
   * Registra la aceptación (§2.1.20). El hash y la versión salen del
   * documento en este instante, nunca de lo que mande el cliente: es lo que
   * hace que "qué firmó exactamente" sea una pregunta con una sola respuesta
   * posible.
   */
  async accept(userId: string, documentId: string, context: RequestContext): Promise<void> {
    const documento = await this.documents.findByPublicId(documentId);
    if (!documento) throw documentNotFound(documentId);

    await this.consents.accept({
      userId,
      documentId,
      documentType: documento.type,
      version: documento.version,
      contentHash: documento.contentHash,
      ip: context.ip,
      userAgent: context.userAgent,
      acceptedAt: this.now(),
    });
  }

  /** El panel de cumplimiento de un documento: quién lo firmó y cuándo. */
  async complianceOf(documentId: string, cursor?: string, limit?: number) {
    const documento = await this.documents.findByPublicId(documentId);
    if (!documento) throw documentNotFound(documentId);

    const pagina = await this.consents.ofDocument(documentId, { cursor, limit });
    const items = await Promise.all(pagina.items.map((consent) => this.toComplianceEntry(consent)));

    return { ...pagina, items };
  }

  /**
   * Todas las firmas de un documento, sin paginar: para exportar (§2.1.20).
   *
   * Recorre las páginas por dentro y no le pide al llamador que arme el
   * loop: "exportar" quiere decir todo, no una página a la vez.
   */
  async complianceExportOf(documentId: string): Promise<ComplianceEntry[]> {
    const documento = await this.documents.findByPublicId(documentId);
    if (!documento) throw documentNotFound(documentId);

    const entradas: ComplianceEntry[] = [];
    let cursor: string | undefined;

    do {
      const pagina = await this.consents.ofDocument(documentId, { cursor, limit: 100 });
      entradas.push(
        ...(await Promise.all(pagina.items.map((consent) => this.toComplianceEntry(consent)))),
      );
      cursor = pagina.nextCursor ?? undefined;
    } while (cursor);

    return entradas;
  }

  private async toComplianceEntry(consent: ConsentDoc): Promise<ComplianceEntry> {
    const socio = await this.members.memberOf(consent.userId);

    return {
      memberId: socio?.memberId ?? null,
      // Un consentimiento sin socio vinculado igual queda en el panel: quien
      // firmó existe, aunque la ficha ya no.
      fullName: socio?.fullName ?? 'Cuenta sin ficha de socio',
      version: consent.version,
      acceptedAt: fromBsonDate(consent.acceptedAt).toString(),
    };
  }

  /** Los `documentId` que este usuario ya firmó y siguen vigentes (no revocados). */
  private async firmadosDe(userId: string): Promise<Set<string>> {
    const vivos = await this.consents.liveOf(userId);

    return new Set(vivos.map((consent) => consent.documentId));
  }
}

function toDocumentResponse(doc: LegalDocumentDoc): LegalDocument {
  return {
    publicId: String(doc['publicId']),
    type: doc.type as LegalDocument['type'],
    title: doc.title,
    contentHtml: doc.contentHtml,
    contentHash: doc.contentHash,
    version: doc.version,
    required: doc.required,
    publishedAt: fromBsonDate(doc.publishedAt).toString(),
  };
}

/** Lo mínimo que el dominio necesita para decidir si un documento aplica. */
function toRequirement(doc: LegalDocument): DocumentRequirement {
  return { documentId: doc.publicId, type: doc.type, required: doc.required };
}

/** `YYYY-MM-DD` del reloj inyectado, para decidir quién es menor hoy. */
function todayOf(now: Temporal.Instant): string {
  return now.toZonedDateTimeISO('UTC').toPlainDate().toString();
}

function documentNotFound(documentId: string): AppError {
  return new AppError({
    code: 'LP-SYS-404-002',
    status: 404,
    message: 'No encontramos ese documento.',
    meta: { documentId },
  });
}

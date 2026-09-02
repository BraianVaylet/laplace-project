import type {
  CreateMemberInput,
  MemberNoteInput,
  MemberStatus,
  UpdateMemberInput,
} from '@laplace/schemas';
import { Temporal } from '@js-temporal/polyfill';
import type { DomainEventBus } from '../../../events/bus.js';
import { AppError } from '../../../http/errors.js';
import { toBsonDate } from '../../../persistence/bson-date.js';
import { requireTenant } from '../../../tenancy/context.js';
import { publicId } from '../../../tenancy/public-id.js';
import type { Page } from '../../../tenancy/repository.js';
import { canTransition, requiresGuardian } from '../domain/member.js';
import type { MemberDoc, MemberNoteDoc } from '../infrastructure/member.model.js';
import type { MemberRepository } from '../infrastructure/member.repository.js';

/** Hoy, en `YYYY-MM-DD`. Se inyecta para poder testear la mayoría de edad. */
export type Today = () => string;

export interface MemberFilters {
  status?: MemberStatus | undefined;
  venueId?: string | undefined;
  tag?: string | undefined;
}

export interface MemberServiceDeps {
  members: MemberRepository;
  events: DomainEventBus;
  today: Today;
}

/**
 * Casos de uso de Member. Orquesta el repositorio y emite eventos de dominio;
 * no sabe de HTTP ni de Mongoose.
 */
export class MemberService {
  private readonly members: MemberRepository;
  private readonly events: DomainEventBus;
  private readonly today: Today;

  constructor(deps: MemberServiceDeps) {
    this.members = deps.members;
    this.events = deps.events;
    this.today = deps.today;
  }

  async create(input: CreateMemberInput): Promise<MemberDoc> {
    if (requiresGuardian(input.birthDate, this.today()) && !input.guardian) {
      throw new AppError({
        code: 'LP-MEMB-422-004',
        status: 422,
        message: 'Cargá el tutor responsable antes de continuar.',
        action: 'Sumá nombre y teléfono de la madre, el padre o quien sea responsable.',
        meta: { birthDate: input.birthDate },
      });
    }

    /*
     * Chequeo previo del documento para poder dar un error con nombre. El indice
     * unico parcial `{ tenantId, docId }` es el que de verdad garantiza la
     * unicidad: entre este `findOne` y el `create` hay una ventana, y dos altas
     * simultaneas del mismo DNI la encuentran.
     */
    if (input.docId !== undefined && (await this.members.findByDocId(input.docId))) {
      throw duplicateDoc(input.docId);
    }

    try {
      const member = await this.members.create({
        ...input,
        flags: { debtor: false, suspended: false },
        balanceCents: 0,
        joinedAt: toBsonDate(Temporal.Now.instant()),
        lastAttendanceAt: null,
        notes: [],
      } as Partial<MemberDoc>);

      await this.events.emit('member.created', {
        memberId: String(member['publicId']),
        status: member.status,
        venueIds: member.venueIds,
      });

      return member;
    } catch (error) {
      // El que perdio la carrera contra el indice unico recibe el mismo 409 que
      // el que llego tarde por el chequeo previo, no un 500.
      if (isDuplicateKey(error) && input.docId !== undefined) throw duplicateDoc(input.docId);
      throw error;
    }
  }

  async list(filters: MemberFilters, cursor?: string, limit?: number): Promise<Page<MemberDoc>> {
    const filter: Record<string, unknown> = {};
    if (filters.status !== undefined) filter['status'] = filters.status;
    if (filters.venueId !== undefined) filter['venueIds'] = filters.venueId;
    if (filters.tag !== undefined) filter['tags'] = filters.tag;

    return this.members.list(filter, {
      sortField: 'createdAt',
      direction: 'desc',
      ...(cursor ? { cursor } : {}),
      ...(limit ? { limit } : {}),
    });
  }

  async getByPublicId(id: string): Promise<MemberDoc> {
    const member = await this.members.findByPublicId(id);
    if (!member) throw notFound(id);

    return member;
  }

  async update(id: string, input: UpdateMemberInput): Promise<MemberDoc> {
    const current = await this.getByPublicId(id);

    // La edicion puede cargar la fecha de nacimiento por primera vez: el corte
    // del tutor tiene que volver a evaluarse con los datos ya mezclados.
    const birthDate = input.birthDate ?? current.birthDate;
    const guardian = input.guardian ?? current.guardian;
    if (requiresGuardian(birthDate, this.today()) && !guardian) {
      throw new AppError({
        code: 'LP-MEMB-422-004',
        status: 422,
        message: 'Cargá el tutor responsable antes de continuar.',
        meta: { birthDate },
      });
    }

    if (input.docId !== undefined) {
      const otro = await this.members.findByDocId(input.docId);
      if (otro && otro['publicId'] !== id) throw duplicateDoc(input.docId);
    }

    const updated = await this.members.updateByPublicId(id, { $set: { ...input } });
    if (!updated) throw notFound(id);

    return updated;
  }

  /** §14: el estado cambia solo por transición explícita y validada. */
  async changeStatus(id: string, to: MemberStatus): Promise<MemberDoc> {
    const member = await this.getByPublicId(id);
    const from = member.status as MemberStatus;

    if (!canTransition(from, to)) {
      throw new AppError({
        code: 'LP-MEMB-422-002',
        status: 422,
        message: `No se puede pasar de ${from} a ${to}.`,
        meta: { memberId: id, from, to },
      });
    }

    const updated = await this.members.updateByPublicId(id, { $set: { status: to } });
    if (!updated) throw notFound(id);

    await this.events.emit('member.status_changed', { memberId: id, from, to });

    return updated;
  }

  /**
   * Sanción del staff. Es un flag transversal, no un estado: un socio puede
   * estar `active` y `suspended` a la vez, y al levantarla vuelve a operar sin
   * haber perdido su estado del embudo.
   */
  async setSuspended(id: string, suspended: boolean): Promise<MemberDoc> {
    await this.getByPublicId(id);

    const updated = await this.members.updateByPublicId(id, {
      $set: { 'flags.suspended': suspended },
    });
    if (!updated) throw notFound(id);

    return updated;
  }

  /**
   * Nota interna del staff. Queda con autor y fecha, y **nunca** es visible para
   * el miembro (§2.1.7): viaja por su propio endpoint, con su propio permiso.
   */
  async addNote(id: string, input: MemberNoteInput): Promise<MemberNoteDoc> {
    await this.getByPublicId(id);
    const { userId } = requireTenant();

    const note: MemberNoteDoc = {
      publicId: publicId('memberNote'),
      text: input.text,
      authorId: userId,
      createdAt: toBsonDate(Temporal.Now.instant()),
    };

    const updated = await this.members.updateByPublicId(id, {
      // Las notas mas nuevas primero: es el orden en que las lee el staff.
      $push: { notes: { $each: [note], $position: 0 } },
    } as never);
    if (!updated) throw notFound(id);

    return note;
  }

  async listNotes(id: string): Promise<MemberNoteDoc[]> {
    return (await this.getByPublicId(id)).notes;
  }

  /**
   * Refresca el saldo cacheado del socio. Lo escribe Billing (F1-10).
   *
   * Es una **copia**: la fuente de verdad es el estado de cuenta, que se calcula
   * sobre cargos y pagos. Esto existe para que la lista de socios y la ficha 360
   * no tengan que recalcularlo por cada fila.
   */
  async setBalance(memberId: string, balanceCents: number): Promise<void> {
    await this.members.updateByPublicId(memberId, {
      $set: { balanceCents, 'flags.debtor': balanceCents < 0 },
    });
  }

  /** Lo consume el guard de entitlements. Cuenta los que ocupan cupo. */
  countActive(): Promise<number> {
    return this.members.countActive();
  }
}

function notFound(memberId: string): AppError {
  return new AppError({
    code: 'LP-MEMB-404-003',
    status: 404,
    message: 'No encontramos a esa persona.',
    meta: { memberId },
  });
}

function duplicateDoc(docId: string): AppError {
  return new AppError({
    code: 'LP-MEMB-409-001',
    status: 409,
    message: 'Ya hay un miembro con ese documento.',
    action: 'Buscalo en el listado: puede estar archivado.',
    meta: { docId },
  });
}

/** E11000 de Mongo. Se mira el código, no el mensaje, que cambia entre versiones. */
function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}

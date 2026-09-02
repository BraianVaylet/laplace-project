import { Temporal } from '@js-temporal/polyfill';
import {
  MATERIALIZATION_WINDOW_DAYS,
  type CreateClassTemplateInput,
  type CreateSessionInput,
  type SessionStatus,
  type UpdateClassTemplateInput,
} from '@laplace/schemas';
import type { DomainEventBus } from '../../../events/bus.js';
import { AppError } from '../../../http/errors.js';
import { fromBsonDate, toBsonDate } from '../../../persistence/bson-date.js';
import { runWithTenant } from '../../../tenancy/context.js';
import type { Page } from '../../../tenancy/repository.js';
import { assertProducesOccurrences, expandRecurrence } from '../domain/recurrence.js';
import type { ClassSessionDoc, ClassTemplateDoc } from '../infrastructure/schedule.model.js';
import type {
  ClassSessionRepository,
  ClassTemplateRepository,
} from '../infrastructure/schedule.repository.js';

/**
 * Lo que Schedule necesita de otros módulos, por interfaz (ADR-003).
 *
 * La sala aporta su capacidad —de ahí la hereda la clase (§2.1.5.b)— y la sede
 * su zona horaria, que es en la que se expande la recurrencia.
 */
export interface RoomLookup {
  /** Capacidad de la sala, o `null` si no existe en este tenant. */
  capacityOf(roomId: string): Promise<number | null>;
}

export interface VenueLookup {
  timeZoneOf(venueId: string): Promise<string>;
}

export interface ScheduleServiceDeps {
  templates: ClassTemplateRepository;
  sessions: ClassSessionRepository;
  rooms: RoomLookup;
  venues: VenueLookup;
  events: DomainEventBus;
  now?: (() => Temporal.Instant) | undefined;
}

export class ScheduleService {
  private readonly templates: ClassTemplateRepository;
  private readonly sessions: ClassSessionRepository;
  private readonly rooms: RoomLookup;
  private readonly venues: VenueLookup;
  private readonly events: DomainEventBus;
  private readonly now: () => Temporal.Instant;

  constructor(deps: ScheduleServiceDeps) {
    this.templates = deps.templates;
    this.sessions = deps.sessions;
    this.rooms = deps.rooms;
    this.venues = deps.venues;
    this.events = deps.events;
    this.now = deps.now ?? (() => Temporal.Now.instant());
  }

  async createTemplate(input: CreateClassTemplateInput): Promise<ClassTemplateDoc> {
    const timeZone = await this.venues.timeZoneOf(input.venueId);
    await this.assertRoomExists(input.roomId);

    // Una regla que no genera ninguna clase en su vigencia está mal armada, y
    // descubrirlo cuando el job no crea nada es descubrirlo tarde.
    assertProducesOccurrences(input.recurrence, timeZone);

    return this.templates.create({ ...input, active: true } as Partial<ClassTemplateDoc>);
  }

  async listTemplates(
    venueId?: string,
    cursor?: string,
    limit?: number,
  ): Promise<Page<ClassTemplateDoc>> {
    return this.templates.list(venueId === undefined ? {} : { venueId }, {
      sortField: 'createdAt',
      direction: 'desc',
      ...(cursor ? { cursor } : {}),
      ...(limit ? { limit } : {}),
    });
  }

  async getTemplate(id: string): Promise<ClassTemplateDoc> {
    const template = await this.templates.findByPublicId(id);
    if (!template) throw templateNotFound(id);

    return template;
  }

  async updateTemplate(id: string, input: UpdateClassTemplateInput): Promise<ClassTemplateDoc> {
    const current = await this.getTemplate(id);

    if (input.recurrence !== undefined) {
      assertProducesOccurrences(input.recurrence, await this.venues.timeZoneOf(current.venueId));
    }

    const updated = await this.templates.updateByPublicId(id, { $set: { ...input } });
    if (!updated) throw templateNotFound(id);

    return updated;
  }

  /**
   * Archiva la plantilla. **No borra las sesiones ya materializadas**: la clase
   * del jueves que viene ya está publicada y puede tener gente anotada. Para
   * bajarla hay que cancelarla, que avisa y devuelve créditos (F1-13).
   */
  async setTemplateActive(id: string, active: boolean): Promise<ClassTemplateDoc> {
    await this.getTemplate(id);

    const updated = await this.templates.updateByPublicId(id, { $set: { active } });
    if (!updated) throw templateNotFound(id);

    return updated;
  }

  /** Alta manual de una clase suelta, fuera de toda plantilla. */
  async createSession(input: CreateSessionInput): Promise<ClassSessionDoc> {
    const startAt = Temporal.Instant.from(input.startAt);
    const endAt = startAt.add({ minutes: input.durationMin });
    const capacity = input.capacity ?? (await this.assertRoomExists(input.roomId));

    await this.assertRoomFree(input.roomId, startAt, endAt);

    const session = await this.sessions.create({
      venueId: input.venueId,
      roomId: input.roomId,
      name: input.name,
      categoryId: input.categoryId,
      startAt: toBsonDate(startAt),
      endAt: toBsonDate(endAt),
      capacity,
      bookedCount: 0,
      waitlistCount: 0,
      ...(input.coachId === undefined ? {} : { coachId: input.coachId }),
      status: 'scheduled',
    } as Partial<ClassSessionDoc>);

    await this.events.emit('session.scheduled', {
      sessionId: String(session['publicId']),
      venueId: input.venueId,
      startAt: startAt.toString(),
    });

    return session;
  }

  /** La agenda de una sede entre dos instantes. Sirve para el día, la semana y el mes. */
  async agenda(
    venueId: string,
    from: Temporal.Instant,
    to: Temporal.Instant,
  ): Promise<ClassSessionDoc[]> {
    return this.sessions.between(venueId, from, to);
  }

  async getSession(id: string): Promise<ClassSessionDoc> {
    const session = await this.sessions.findByPublicId(id);
    if (!session) throw sessionNotFound(id);

    return session;
  }

  /** §14: los estados cambian solo por transición explícita y validada. */
  async changeSessionStatus(id: string, to: SessionStatus): Promise<ClassSessionDoc> {
    const session = await this.getSession(id);

    const updated = await this.sessions.updateByPublicId(id, { $set: { status: to } });
    if (!updated) throw sessionNotFound(id);

    await this.events.emit('session.status_changed', {
      sessionId: id,
      from: session.status,
      to,
    });

    return updated;
  }

  /** Cuántas clases futuras tiene una sala. Es el puerto que consume Rooms (F1-02). */
  async countFutureSessions(roomId: string): Promise<number> {
    return this.sessions.countFutureOfRoom(roomId, this.now());
  }

  /**
   * 🔴 Job diario: materializa las clases de los próximos 60 días a partir de
   * las plantillas activas (§2.1.5.a).
   *
   * **Idempotente por doble vía**: se consultan los inicios ya materializados
   * antes de escribir, y el índice único `{ tenantId, templateId, startAt }`
   * cierra la ventana entre esa consulta y el `insert`. Sin el índice, dos
   * instancias del runner arrancando a la vez duplicarían la grilla.
   */
  async materializeSessions(): Promise<number> {
    const now = this.now();
    const hasta = now.add({ hours: 24 * MATERIALIZATION_WINDOW_DAYS });
    let creadas = 0;

    for (const template of await this.templates.activeAcrossTenants()) {
      const tenantId = String(template['tenantId']);
      const templateId = String(template['publicId']);

      creadas += await runWithTenant(
        { tenantId, userId: 'system:materializeSessions', requestId: `job-mat-${templateId}` },
        () => this.materializeOne(template, templateId, now, hasta),
      );
    }

    return creadas;
  }

  private async materializeOne(
    template: ClassTemplateDoc,
    templateId: string,
    from: Temporal.Instant,
    to: Temporal.Instant,
  ): Promise<number> {
    const timeZone = await this.venues.timeZoneOf(template.venueId).catch(() => null);
    if (timeZone === null) return 0;

    const ocurrencias = expandRecurrence(template.recurrence as never, timeZone, { from, to });
    const yaExisten = await this.sessions.startsOfTemplate(templateId, from, to);
    const capacidadSala = await this.rooms.capacityOf(template.roomId);

    let creadas = 0;
    for (const startAt of ocurrencias) {
      if (yaExisten.has(startAt.epochMilliseconds)) continue;

      const endAt = startAt.add({ minutes: template.durationMin });

      try {
        await this.sessions.create({
          venueId: template.venueId,
          roomId: template.roomId,
          templateId,
          name: template.name,
          categoryId: template.categoryId,
          startAt: toBsonDate(startAt),
          endAt: toBsonDate(endAt),
          // §2.1.5.b: la clase hereda la capacidad de la sala salvo que la
          // plantilla declare la suya.
          capacity: template.capacity ?? capacidadSala ?? 1,
          bookedCount: 0,
          waitlistCount: 0,
          ...(template.coachId === undefined ? {} : { coachId: template.coachId }),
          status: 'scheduled',
        } as Partial<ClassSessionDoc>);

        creadas += 1;
      } catch (error) {
        // Otra corrida la creó entre la consulta y el insert: es exactamente lo
        // que el índice único existe para cortar, y no es un error.
        if (!isDuplicateKey(error)) throw error;
      }
    }

    return creadas;
  }

  /** La sala tiene que existir en este tenant; devuelve su capacidad. */
  private async assertRoomExists(roomId: string): Promise<number> {
    const capacity = await this.rooms.capacityOf(roomId);
    if (capacity === null) {
      throw new AppError({
        code: 'LP-SCHD-404-008',
        status: 404,
        message: 'No encontramos esa sala.',
        meta: { roomId },
      });
    }

    return capacity;
  }

  /** Dos clases no pueden ocupar la misma sala a la misma hora. */
  private async assertRoomFree(
    roomId: string,
    startAt: Temporal.Instant,
    endAt: Temporal.Instant,
  ): Promise<void> {
    const chocan = await this.sessions.collidingIn(roomId, startAt, endAt);
    const primera = chocan[0];
    if (!primera) return;

    throw new AppError({
      code: 'LP-SCHD-409-003',
      status: 409,
      message: 'Ya hay una clase en esa sala a esa hora.',
      // El nombre y la hora de la que choca: sin eso, el SMU tiene que salir a
      // buscarla en la grilla.
      action: `"${primera.name}" ocupa la sala desde las ${localTimeOf(primera.startAt)}.`,
      meta: { roomId, collidesWith: String(primera['publicId']) },
    });
  }
}

/** `HH:mm` en UTC. Alcanza para el mensaje; la grilla se muestra en la zona del centro. */
function localTimeOf(date: Date): string {
  return fromBsonDate(date)
    .toZonedDateTimeISO('UTC')
    .toPlainTime()
    .toString({ smallestUnit: 'minute' });
}

function templateNotFound(id: string): AppError {
  return new AppError({
    code: 'LP-SCHD-404-008',
    status: 404,
    message: 'No encontramos esa plantilla de clase.',
    meta: { templateId: id },
  });
}

function sessionNotFound(id: string): AppError {
  return new AppError({
    code: 'LP-BOOK-404-006',
    status: 404,
    message: 'No encontramos esa clase.',
    meta: { sessionId: id },
  });
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}

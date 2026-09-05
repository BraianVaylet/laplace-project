import { Temporal } from '@js-temporal/polyfill';
import {
  MATERIALIZATION_WINDOW_DAYS,
  type CreateClassTemplateInput,
  type CreateClosureInput,
  type CreateSessionInput,
  type DuplicateWeekInput,
  type DuplicateWeekResult,
  type EditScope,
  type SessionStatus,
  type UpdateClassTemplateInput,
  type UpdateSessionInput,
} from '@laplace/schemas';
import type { AuditWriter } from '../../../audit/audit-log.js';
import type { DomainEventBus } from '../../../events/bus.js';
import { AppError } from '../../../http/errors.js';
import { fromBsonDate, toBsonDate } from '../../../persistence/bson-date.js';
import { runWithTenant } from '../../../tenancy/context.js';
import type { Page } from '../../../tenancy/repository.js';
import { assertProducesOccurrences, expandRecurrence } from '../domain/recurrence.js';
import type { VenueClosureDoc } from '../infrastructure/closure.model.js';
import type { ClassSessionDoc, ClassTemplateDoc } from '../infrastructure/schedule.model.js';
import type {
  ClassSessionRepository,
  ClassTemplateRepository,
  VenueClosureRepository,
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

/**
 * Cancela las reservas de una clase y **devuelve los créditos**, y dice cuántas
 * tocó. Lo contesta Booking (F1-14).
 *
 * §2.1.9: cuando el centro cancela una clase, el crédito se devuelve siempre —
 * el socio no perdió nada, la clase no se dio.
 */
export interface SessionBookingReleaser {
  /** Devuelve a que socios se les libero la reserva: son los que hay que avisar. */
  releaseSession(params: { sessionId: string; reason: string }): Promise<string[]>;
}

export const NO_BOOKINGS_YET: SessionBookingReleaser = {
  releaseSession: () => Promise.resolve([]),
};

export interface ScheduleServiceDeps {
  templates: ClassTemplateRepository;
  sessions: ClassSessionRepository;
  closures: VenueClosureRepository;
  rooms: RoomLookup;
  venues: VenueLookup;
  events: DomainEventBus;
  audit: AuditWriter;
  bookings?: SessionBookingReleaser | undefined;
  now?: (() => Temporal.Instant) | undefined;
}

export class ScheduleService {
  private readonly templates: ClassTemplateRepository;
  private readonly sessions: ClassSessionRepository;
  private readonly rooms: RoomLookup;
  private readonly venues: VenueLookup;
  private readonly closures: VenueClosureRepository;
  private readonly events: DomainEventBus;
  private readonly audit: AuditWriter;
  private readonly bookings: SessionBookingReleaser;
  private readonly now: () => Temporal.Instant;

  constructor(deps: ScheduleServiceDeps) {
    this.templates = deps.templates;
    this.sessions = deps.sessions;
    this.closures = deps.closures;
    this.rooms = deps.rooms;
    this.venues = deps.venues;
    this.events = deps.events;
    this.audit = deps.audit;
    this.bookings = deps.bookings ?? NO_BOOKINGS_YET;
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

  /** Cuantas plantillas activas hay. La consulta el asistente de onboarding. */
  countTemplates(): Promise<number> {
    return this.templates.countActive();
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

  /**
   * Edita **solo esa sesión** (§2.1.5.a). Es la mitad "solo esta" del
   * comportamiento tipo Google Calendar: la plantilla no se entera y las demás
   * clases quedan como estaban.
   */
  async updateSession(id: string, input: UpdateSessionInput): Promise<ClassSessionDoc> {
    const session = await this.getSession(id);
    if (session.status === 'completed' || session.status === 'cancelled') {
      throw finishedSession(id, session.status);
    }
    // Una clase que ya termino tampoco se edita, aunque su estado siga siendo
    // `scheduled`: nadie transiciona la grilla vieja, y reescribirla cambiaria
    // el historico de lo que de verdad ocurrio.
    if (Temporal.Instant.compare(fromBsonDate(session.endAt), this.now()) <= 0) {
      throw finishedSession(id, 'terminada');
    }

    const updated = await this.sessions.updateByPublicId(id, { $set: { ...input } });
    if (!updated) throw sessionNotFound(id);

    // El cambio de coach se avisa a los inscriptos (§2.1.5.f): el socio eligió
    // esa clase, y a veces eligió a esa persona.
    if (input.coachId !== undefined && input.coachId !== session.coachId) {
      await this.events.emit('session.coach_changed', {
        sessionId: id,
        from: session.coachId ?? null,
        to: input.coachId,
      });
    }

    return updated;
  }

  /**
   * Edita la plantilla y, con `this_and_future`, propaga el cambio a las clases
   * que **todavía no empezaron** (§2.1.5.a).
   *
   * Las pasadas nunca se tocan: son el histórico de lo que de verdad ocurrió, y
   * reescribirlo haría que la lista de asistencia de la semana pasada dejara de
   * coincidir con lo que la gente hizo.
   */
  async updateTemplateWithScope(
    id: string,
    input: UpdateClassTemplateInput,
    scope: EditScope,
  ): Promise<{ template: ClassTemplateDoc; updatedSessions: number }> {
    const template = await this.updateTemplate(id, input);
    if (scope === 'template_only') return { template, updatedSessions: 0 };

    const propagable = pickPropagable(input);
    if (Object.keys(propagable).length === 0) return { template, updatedSessions: 0 };

    const futuras = await this.sessions.futureOfTemplate(id, this.now());
    for (const session of futuras) {
      await this.sessions.updateByPublicId(String(session['publicId']), { $set: propagable });
    }

    return { template, updatedSessions: futuras.length };
  }

  /**
   * 🔴 Cancela una clase y devuelve los créditos de todos sus inscriptos
   * (§2.1.9).
   *
   * El orden importa: **primero se liberan las reservas, después se cancela la
   * clase**. Si la devolución falla, la clase queda en pie y el centro puede
   * reintentar; al revés, quedaría una clase cancelada con los créditos
   * retenidos, que es plata del socio.
   *
   * F1-14 mete las dos escrituras en una transacción de Mongo, que es donde
   * puede hacerlo: ahí las reservas y el contador de la sesión viven en el mismo
   * módulo.
   */
  async cancelSession(id: string, reason: string): Promise<ClassSessionDoc> {
    const session = await this.getSession(id);

    if (session.status === 'completed' || session.status === 'cancelled') {
      throw finishedSession(id, session.status);
    }
    if (Temporal.Instant.compare(fromBsonDate(session.endAt), this.now()) <= 0) {
      throw finishedSession(id, 'terminada');
    }

    const liberados = await this.bookings.releaseSession({ sessionId: id, reason });

    const updated = await this.sessions.updateByPublicId(id, { $set: { status: 'cancelled' } });
    if (!updated) throw sessionNotFound(id);

    await this.audit.record({
      action: 'session.cancelled',
      targetType: 'classSession',
      targetId: id,
      reason,
      before: { status: session.status, bookedCount: session.bookedCount },
      after: { status: 'cancelled', bookingsReleased: liberados.length },
    });

    await this.events.emit('session.cancelled', {
      sessionId: id,
      venueId: session.venueId,
      startAt: fromBsonDate(session.startAt).toString(),
      reason,
      releasedBookings: liberados.length,
      releasedMemberIds: liberados,
    });

    return updated;
  }

  /**
   * Declara un feriado o un cierre y **cancela en bloque** las clases del rango
   * (§2.1.5.a).
   *
   * Cada cancelación pasa por el mismo camino que una individual, así que cada
   * socio recupera su crédito y recibe su aviso.
   */
  async declareClosure(input: CreateClosureInput): Promise<VenueClosureDoc> {
    const timeZone = await this.venues.timeZoneOf(input.venueId);
    const desde = Temporal.PlainDate.from(input.from).toZonedDateTime({ timeZone }).toInstant();
    const hasta = Temporal.PlainDate.from(input.to)
      .add({ days: 1 })
      .toZonedDateTime({ timeZone })
      .toInstant();

    const afectadas = await this.sessions.between(input.venueId, desde, hasta, {
      status: { $nin: ['cancelled', 'completed'] },
    });

    let canceladas = 0;
    for (const session of afectadas) {
      // Las que ya pasaron no se cancelan: la clase se dio, y borrarla del
      // registro seria mentir sobre lo que ocurrio.
      if (Temporal.Instant.compare(fromBsonDate(session.endAt), this.now()) <= 0) continue;

      await this.cancelSession(String(session['publicId']), input.reason);
      canceladas += 1;
    }

    return this.closures.create({
      ...input,
      cancelledSessions: canceladas,
    } as Partial<VenueClosureDoc>);
  }

  async listClosures(venueId: string): Promise<VenueClosureDoc[]> {
    return this.closures.ofVenue(venueId);
  }

  /**
   * Copia la grilla de una semana a otra (§2.1.5.a), **respetando los feriados**:
   * la clase que caería en un día cerrado no se copia, y se dice por qué.
   *
   * Es lo que usa el centro que arma el horario a mano en vez de con plantillas.
   */
  async duplicateWeek(input: DuplicateWeekInput): Promise<DuplicateWeekResult> {
    const timeZone = await this.venues.timeZoneOf(input.venueId);
    const origen = Temporal.PlainDate.from(input.fromWeek);
    const destino = Temporal.PlainDate.from(input.toWeek);
    const dias = Math.round(origen.until(destino).days);

    const desde = origen.toZonedDateTime({ timeZone }).toInstant();
    const hasta = origen.add({ days: 7 }).toZonedDateTime({ timeZone }).toInstant();

    const modelo = await this.sessions.between(input.venueId, desde, hasta, {
      status: { $ne: 'cancelled' },
    });

    const cierres = await this.closures.coveringRange(
      input.venueId,
      destino.toString(),
      destino.add({ days: 6 }).toString(),
    );

    const result: DuplicateWeekResult = { created: 0, skipped: [] };

    for (const session of modelo) {
      /*
       * Se corre por dias de calendario, no por 7*24 horas: si en el medio hay
       * un cambio de horario, la clase de las 7:00 tiene que seguir siendo a las
       * 7:00 de la semana destino.
       */
      const inicio = fromBsonDate(session.startAt).toZonedDateTimeISO(timeZone).add({ days: dias });
      const fin = inicio.add({
        minutes: Math.round(
          fromBsonDate(session.startAt)
            .until(fromBsonDate(session.endAt))
            .total({ unit: 'minute' }),
        ),
      });
      const dia = inicio.toPlainDate().toString();

      const cerrado = cierres.find((closure) => closure.from <= dia && closure.to >= dia);
      if (cerrado) {
        result.skipped.push({ startAt: inicio.toInstant().toString(), reason: cerrado.reason });
        continue;
      }

      try {
        await this.assertRoomFree(session.roomId, inicio.toInstant(), fin.toInstant());
      } catch {
        result.skipped.push({
          startAt: inicio.toInstant().toString(),
          reason: 'La sala ya está ocupada a esa hora.',
        });
        continue;
      }

      await this.sessions.create({
        venueId: session.venueId,
        roomId: session.roomId,
        name: session.name,
        categoryId: session.categoryId,
        startAt: toBsonDate(inicio.toInstant()),
        endAt: toBsonDate(fin.toInstant()),
        capacity: session.capacity,
        bookedCount: 0,
        waitlistCount: 0,
        ...(session.coachId === undefined ? {} : { coachId: session.coachId }),
        status: 'scheduled',
      } as Partial<ClassSessionDoc>);

      result.created += 1;
    }

    return result;
  }

  /**
   * Toma un lugar de la clase, de forma atómica. Es el puerto que consume
   * Booking (F1-14): el módulo que conoce la clase es el que sabe si queda lugar.
   */
  async claimSeat(sessionId: string): Promise<ClassSessionDoc | null> {
    return this.sessions.claimSeat(sessionId);
  }

  async releaseSeat(sessionId: string): Promise<void> {
    await this.sessions.releaseSeat(sessionId);
  }

  async adjustWaitlist(sessionId: string, delta: number): Promise<void> {
    await this.sessions.adjustWaitlist(sessionId, delta);
  }

  /** La clase, o `null` si no existe en este tenant. Booking la necesita sin el 404. */
  async findSession(sessionId: string): Promise<ClassSessionDoc | null> {
    return this.sessions.findByPublicId(sessionId);
  }

  /**
   * Las clases que empezaron dentro del rango, de todos los tenants. Es el
   * puerto que consume el job de ausentes de Booking (F1-17): quien sabe qué
   * clases hubo es la agenda, y quien sabe quién faltó son las reservas.
   */
  async startedBetweenAcrossTenants(
    from: Temporal.Instant,
    to: Temporal.Instant,
  ): Promise<
    Array<{
      tenantId: string;
      sessionId: string;
      venueId: string;
      categoryId: string;
      startAt: Temporal.Instant;
    }>
  > {
    const clases = await this.sessions.startedBetweenAcrossTenants(from, to);

    return clases.map((clase) => ({
      tenantId: String(clase['tenantId']),
      sessionId: String(clase['publicId']),
      venueId: clase.venueId,
      categoryId: clase.categoryId,
      startAt: fromBsonDate(clase.startAt),
    }));
  }

  /**
   * Las clases de una ventana con su cupo. Es el puerto que consume Metrics
   * (F1-23): el numerador de la utilizacion lo cuenta Booking, el denominador
   * sale de aca.
   *
   * Las canceladas quedan afuera: una clase que no se dio no tiene cupo que
   * llenar, y contarla hundiria la utilizacion del dia sin que nadie hiciera
   * nada mal.
   */
  /**
   * Nombre y horario de varias clases de una. Lo consume la ficha 360 (F1-06):
   * pedirlas de a una sería una consulta por reserva, y la ficha las muestra
   * todas juntas.
   */
  async sessionSummariesOf(
    sessionIds: readonly string[],
  ): Promise<Map<string, { name: string; startAt: Temporal.Instant }>> {
    if (sessionIds.length === 0) return new Map();

    const clases = await this.sessions.list({ publicId: { $in: [...sessionIds] } } as never, {
      limit: Math.min(sessionIds.length, 200),
    });

    return new Map(
      clases.items.map((clase) => [
        String(clase['publicId']),
        { name: clase.name, startAt: fromBsonDate(clase.startAt) },
      ]),
    );
  }

  async sessionsOfWindow(
    venueId: string,
    from: Temporal.Instant,
    to: Temporal.Instant,
  ): Promise<
    Array<{
      sessionId: string;
      name: string;
      capacity: number;
      startAt: Temporal.Instant;
      status: string;
    }>
  > {
    const clases = await this.sessions.between(venueId, from, to, {
      status: { $ne: 'cancelled' },
    } as never);

    return clases.map((clase) => ({
      sessionId: String(clase['publicId']),
      name: clase.name,
      capacity: clase.capacity,
      startAt: fromBsonDate(clase.startAt),
      status: clase.status,
    }));
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

/** Los campos de la plantilla que tiene sentido propagar a las clases futuras. */
function pickPropagable(input: UpdateClassTemplateInput): Record<string, unknown> {
  const propagable: Record<string, unknown> = {};

  if (input.name !== undefined) propagable['name'] = input.name;
  if (input.categoryId !== undefined) propagable['categoryId'] = input.categoryId;
  if (input.capacity !== undefined) propagable['capacity'] = input.capacity;
  if (input.coachId !== undefined) propagable['coachId'] = input.coachId;

  return propagable;
}

function finishedSession(id: string, status: string): AppError {
  return new AppError({
    code: 'LP-SCHD-422-005',
    status: 422,
    message: 'No se puede modificar una clase que ya pasó.',
    meta: { sessionId: id, status },
  });
}

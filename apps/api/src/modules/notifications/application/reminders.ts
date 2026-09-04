import type { Temporal } from '@js-temporal/polyfill';
import { runWithTenant } from '../../../tenancy/context.js';
import { fechaLarga, horaDe } from '../domain/format.js';
import type { NotificationService } from './notification-service.js';
import type {
  RecipientLookup,
  RosterLookup,
  SessionLookup,
  UpcomingSessionLookup,
  VenueLookup,
} from './ports.js';
import { DEFAULT_TIME_ZONE } from './subscriptions.js';

/**
 * Los recordatorios de clase (§2.1.14): 24 horas antes y 1 hora antes.
 *
 * No cuelgan de un evento porque **el hito es el paso del tiempo**, no algo que
 * pase en el sistema: nadie emite "faltan 24 horas". Los busca un job.
 *
 * 🔴 Que salgan **una sola vez por hito** no lo garantiza el job: lo garantiza
 * la clave de dedupe, que incluye el tipo de aviso y la clase. El job puede
 * correr cada cinco minutos, colgarse y volver a correr sobre las mismas clases
 * sin que nadie reciba dos veces el mismo recordatorio.
 */
export interface ReminderLookups {
  upcoming: UpcomingSessionLookup;
  recipients: RecipientLookup;
  sessions: SessionLookup;
  venues: VenueLookup;
  roster: RosterLookup;
}

const HORAS_DE_ANTICIPACION = 24;

export class ReminderSender {
  constructor(
    private readonly service: NotificationService,
    private readonly lookups: ReminderLookups,
    private readonly now: () => Temporal.Instant,
  ) {}

  /** Encola los recordatorios de todo lo que arranca en las próximas 24 horas. */
  async send(): Promise<number> {
    const ahora = this.now();
    const hasta = ahora.add({ hours: HORAS_DE_ANTICIPACION });
    let encolados = 0;

    for (const clase of await this.lookups.upcoming.startingBetween(ahora, hasta)) {
      encolados += await runWithTenant(
        {
          tenantId: clase.tenantId,
          userId: 'system:classReminders',
          requestId: `job-reminder-${clase.sessionId}`,
        },
        () => this.remindOne(clase.sessionId, hitoDe(clase.startAt, ahora)),
      );
    }

    return encolados;
  }

  private async remindOne(
    sessionId: string,
    eventType: 'session.reminder_24h' | 'session.reminder_1h',
  ): Promise<number> {
    const clase = await this.lookups.sessions.find(sessionId);
    if (!clase) return 0;

    const sede = await this.lookups.venues.find(clase.venueId);
    const timeZone = sede?.timeZone ?? DEFAULT_TIME_ZONE;
    const local = clase.startAt.toZonedDateTimeISO(timeZone);
    let encolados = 0;

    for (const inscripto of await this.lookups.roster.of(sessionId)) {
      // Al de la lista de espera no se le recuerda una clase a la que todavía
      // no entró: sería prometerle un lugar que puede no aparecer.
      if (inscripto.status !== 'booked') continue;

      const destinatario = await this.lookups.recipients.byMemberId(inscripto.memberId);
      if (!destinatario) continue;

      encolados += await this.service.queue({
        eventType,
        userId: destinatario.userId,
        email: destinatario.email,
        subjectId: sessionId,
        timeZone,
        values: {
          nombre: destinatario.name,
          clase: clase.name,
          fecha: fechaLarga(local),
          hora: horaDe(local),
          sede: sede?.name ?? 'el centro',
        },
      });
    }

    return encolados;
  }
}

/**
 * Cuál de los dos recordatorios le toca a esta clase.
 *
 * Dentro de la última hora manda el de "en 1 hora": una clase creada media hora
 * antes de empezar no puede recibir el de "mañana tenés". Los dos hitos son
 * claves de dedupe distintas, así que la clase que pasa por los dos recibe los
 * dos, cada uno una sola vez.
 */
export function hitoDe(
  startAt: Temporal.Instant,
  now: Temporal.Instant,
): 'session.reminder_24h' | 'session.reminder_1h' {
  const faltan = now.until(startAt, { largestUnit: 'hour' });

  return faltan.total({ unit: 'hour' }) <= 1 ? 'session.reminder_1h' : 'session.reminder_24h';
}

import { Temporal } from '@js-temporal/polyfill';
import { Cron } from 'croner';
import type { Db } from 'mongodb';
import type { Logger } from 'pino';
import { toBsonDate } from '../persistence/bson-date.js';
import { createMongoJobLock, type JobLock } from './lock.js';

export type JobStatus = 'ok' | 'skipped' | 'failed';

export interface JobResult {
  name: string;
  status: JobStatus;
  durationMs: number;
  error?: string;
}

export interface JobDefinition {
  name: string;
  /** Expresion de cron estandar. Ej: `0 3 * * *` para las 03:00. */
  cron: string;
  /**
   * Cuanto vale el lock. Tiene que ser mayor que lo que tarda el job, o dos
   * instancias podrian correrlo a la vez; y no tanto que un crash lo deje
   * bloqueado media jornada.
   */
  lockTtlSeconds?: number;
  /**
   * 🔴 Todo handler tiene que ser **idempotente**: correrlo dos veces sobre el
   * mismo dia tiene que dar el mismo resultado que correrlo una. El runner
   * garantiza que no corran dos a la vez, no que no corra dos veces.
   */
  handler: () => Promise<void>;
}

export interface JobRunnerDeps {
  db: Db;
  logger: Logger;
  /** Apagable en local y en los tests que no lo estan probando (`JOBS_ENABLED`). */
  enabled?: boolean;
  instanceId?: string;
  now?: () => Temporal.Instant;
  lock?: JobLock;
}

export interface JobRunner {
  register(job: JobDefinition): void;
  /** Programa todo lo registrado. Sin esto, los jobs existen pero no corren. */
  start(): void;
  stop(): void;
  /** Corre un job ya: lo usan los tests y el panel de soporte del DFSA. */
  run(name: string): Promise<JobResult>;
  registered(): JobDefinition[];
}

const DEFAULT_LOCK_TTL_SECONDS = 300;

/**
 * Runner de los procesos automaticos de §10, segun ADR-006: cron in-process,
 * lock atomico en Mongo, sin Redis.
 */
export function createJobRunner({
  db,
  logger,
  enabled = true,
  instanceId = `api-${process.pid}`,
  now = () => Temporal.Now.instant(),
  lock,
}: JobRunnerDeps): JobRunner {
  const jobs = new Map<string, JobDefinition>();
  const schedules: Cron[] = [];
  const jobLock = lock ?? createMongoJobLock(db, instanceId);
  const runs = db.collection('jobRun');

  async function run(name: string): Promise<JobResult> {
    const job = jobs.get(name);
    if (!job) throw new Error(`Job no registrado: ${name}`);

    const ttl = job.lockTtlSeconds ?? DEFAULT_LOCK_TTL_SECONDS;
    const startedAt = now();

    if (!(await jobLock.acquire(name, ttl, startedAt))) {
      logger.debug(
        { module: 'jobs', action: name, meta: { instanceId } },
        'Lock tomado por otra instancia, se saltea',
      );
      return { name, status: 'skipped', durationMs: 0 };
    }

    try {
      await job.handler();
      const durationMs = Math.round(now().since(startedAt).total({ unit: 'milliseconds' }));

      logger.info({ module: 'jobs', action: name, durationMs }, 'Job terminado');
      await record(name, startedAt, durationMs, 'ok');

      return { name, status: 'ok', durationMs };
    } catch (error) {
      const durationMs = Math.round(now().since(startedAt).total({ unit: 'milliseconds' }));
      const message = error instanceof Error ? error.message : String(error);

      // Un job que falla en silencio es peor que un job que no existe: nadie se
      // entera de que hace tres dias no se marcan los no-shows.
      logger.error(
        { module: 'jobs', action: name, durationMs, errorCode: 'LP-SYS-500-005' },
        message,
      );
      await record(name, startedAt, durationMs, 'failed', message);

      return { name, status: 'failed', durationMs, error: message };
    } finally {
      await jobLock.release(name);
    }
  }

  async function record(
    name: string,
    startedAt: Temporal.Instant,
    durationMs: number,
    status: JobStatus,
    error?: string,
  ): Promise<void> {
    await runs.insertOne({
      name,
      instanceId,
      startedAt: toBsonDate(startedAt),
      finishedAt: toBsonDate(startedAt.add({ milliseconds: durationMs })),
      durationMs,
      status,
      ...(error === undefined ? {} : { error }),
    });
  }

  return {
    register(job) {
      if (jobs.has(job.name)) throw new Error(`Job duplicado: ${job.name}`);
      jobs.set(job.name, job);
    },

    start() {
      if (!enabled) {
        logger.info({ module: 'jobs', action: 'start' }, 'Jobs deshabilitados por configuracion');
        return;
      }

      for (const job of jobs.values()) {
        schedules.push(
          new Cron(job.cron, () => {
            void run(job.name);
          }),
        );
      }

      logger.info(
        { module: 'jobs', action: 'start', meta: { count: schedules.length } },
        'Jobs programados',
      );
    },

    stop() {
      for (const schedule of schedules) schedule.stop();
      schedules.length = 0;
    },

    run,

    registered() {
      return [...jobs.values()];
    },
  };
}

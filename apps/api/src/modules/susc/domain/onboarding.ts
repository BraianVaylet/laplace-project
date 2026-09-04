import { Temporal } from '@js-temporal/polyfill';
import type { OnboardingProgress, OnboardingStep, OnboardingStepId } from '@laplace/schemas';

/**
 * El asistente de onboarding del SMU (§2.1.3).
 *
 * 🔴 **El progreso sale del estado real del centro, no de lo que el usuario
 * declaró.** Un checklist que marca "clase publicada" sin que exista una clase
 * es una mentira que el SMU descubre en el peor momento: cuando un socio abre
 * la app y no hay nada. Por eso este archivo recibe conteos, no banderas.
 *
 * Lo único que el usuario declara es qué salteó, y saltear **no** marca hecho:
 * saca el paso del camino y lo deja pendiente, que es lo que realmente está.
 */

/** Lo que el centro tiene cargado hoy. Son conteos: nadie declara nada acá. */
export interface CenterSetup {
  venues: number;
  /** Sedes con horario de apertura cargado. Sin horario no se agenda nada. */
  venuesWithHours: number;
  classTemplates: number;
  products: number;
  inviteCodes: number;
}

interface StepDefinition {
  id: OnboardingStepId;
  title: string;
  description: string;
  /**
   * A dónde lo manda el asistente. Son las rutas del menú del DFSM: el paso
   * lleva a la pantalla donde se hace, no a una pantalla propia del asistente
   * que después haya que mantener duplicada.
   */
  href: string;
  /**
   * Los obligatorios son los que §12 pide para dar el centro por operativo:
   * una clase publicada y un producto vendible. Los demás se pueden saltear
   * y volver después.
   */
  required: boolean;
  isDone: (setup: CenterSetup) => boolean;
  /** Sin sede no hay dónde poner nada: el resto depende del primer paso. */
  needsVenue: boolean;
}

const STEPS: readonly StepDefinition[] = [
  {
    id: 'venue',
    title: 'Creá tu sede',
    description: 'El lugar donde entrenan. Su zona horaria y su dirección salen de acá.',
    href: '/sedes',
    required: true,
    isDone: (setup) => setup.venues > 0,
    needsVenue: false,
  },
  {
    id: 'hours',
    title: 'Cargá los horarios',
    description: 'A qué hora abre y cierra. Es lo que evita agendar una clase con todo cerrado.',
    href: '/sedes',
    required: false,
    isDone: (setup) => setup.venuesWithHours > 0,
    needsVenue: true,
  },
  {
    id: 'class',
    title: 'Publicá tu primera clase',
    description:
      'La plantilla con su día, su hora y su cupo. De ahí salen las clases de la semana.',
    href: '/horario',
    required: true,
    isDone: (setup) => setup.classTemplates > 0,
    needsVenue: true,
  },
  {
    id: 'product',
    title: 'Creá algo para vender',
    description: 'Un pack de clases o una membresía. Sin producto no hay con qué reservar.',
    href: '/productos',
    required: true,
    isDone: (setup) => setup.products > 0,
    needsVenue: true,
  },
  {
    id: 'invite',
    title: 'Invitá a tus socios',
    description: 'Un código para mandar al grupo. Cada uno se asocia solo desde la app.',
    href: '/miembros',
    required: false,
    isDone: (setup) => setup.inviteCodes > 0,
    needsVenue: true,
  },
];

export interface BuildOnboardingInput {
  setup: CenterSetup;
  /** Lo que el usuario dejó para después. Es lo único que declara. */
  skipped: readonly string[];
  /** Cuándo se dio por terminado, si ya pasó. No se recalcula. */
  completedAt?: string | null;
  signedUpAt?: string | null;
  firstClassPublishedAt?: string | null;
  now?: string;
}

export function buildOnboarding(input: BuildOnboardingInput): OnboardingProgress {
  const sinSede = input.setup.venues === 0;

  const steps: OnboardingStep[] = STEPS.map((definicion) => ({
    id: definicion.id,
    title: definicion.title,
    description: definicion.description,
    href: definicion.href,
    required: definicion.required,
    done: definicion.isDone(input.setup),
    skipped: input.skipped.includes(definicion.id),
    blocked: definicion.needsVenue && sinSede,
  }));

  const doneCount = steps.filter((paso) => paso.done).length;

  return {
    steps,
    currentStep: currentStepOf(steps),
    doneCount,
    totalCount: steps.length,
    percent: Math.round((doneCount / steps.length) * 100),
    completedAt: completedAtOf(steps, input),
    timeToFirstClassMinutes: minutesBetween(input.signedUpAt, input.firstClassPublishedAt),
  };
}

/** ¿Ya está lo mínimo para que el centro opere? Es la pregunta del job y de la UI. */
export function isOnboardingComplete(setup: CenterSetup): boolean {
  return STEPS.filter((paso) => paso.required).every((paso) => paso.isDone(setup));
}

/**
 * Dónde se para el asistente al abrir: el primer paso pendiente que se pueda
 * hacer. Lo salteado se ignora, salvo que sea obligatorio — saltear "publicá
 * una clase" no termina el onboarding, porque sin clase el centro no abre.
 */
function currentStepOf(steps: readonly OnboardingStep[]): OnboardingStepId | null {
  const pendiente = (paso: OnboardingStep) => !paso.done && !paso.blocked;

  return (
    steps.find((paso) => pendiente(paso) && !paso.skipped)?.id ??
    steps.find((paso) => pendiente(paso) && paso.required)?.id ??
    null
  );
}

/**
 * 🔴 Terminar el onboarding es un hecho del pasado, no un estado que se
 * recalcula. Si el SMU borra su único producto tres meses después, el asistente
 * no puede reaparecer como si recién se hubiera registrado.
 */
function completedAtOf(
  steps: readonly OnboardingStep[],
  input: BuildOnboardingInput,
): string | null {
  if (input.completedAt) return input.completedAt;
  if (!steps.every((paso) => paso.done || !paso.required)) return null;

  return input.now ?? Temporal.Now.instant().toString();
}

/** La métrica de §2.0. Nunca negativa: relojes que discrepan no son un logro. */
function minutesBetween(desde?: string | null, hasta?: string | null): number | null {
  if (!desde || !hasta) return null;

  const minutos = Temporal.Instant.from(desde)
    .until(Temporal.Instant.from(hasta))
    .total({ unit: 'minute' });

  return Math.max(0, Math.round(minutos));
}

/**
 * Instalación de la PWA (§5.1.3).
 *
 * Dos cosas que la v1 de la spec pide y que el `[+]` corrige, con motivo:
 *
 * 1. **iOS no soporta `beforeinstallprompt`.** El botón nativo no hace nada en
 *    Safari, o sea en la mitad de los usuarios. Ahí hay que mostrar las
 *    instrucciones manuales, y para eso primero hay que saber que es iOS.
 * 2. **El modal no se muestra en cada visita.** La v1 lo pedía así; mostrarlo
 *    siempre es la forma más rápida de que lo cierren sin leerlo y de que la app
 *    se sienta insistente. Máximo una vez cada 7 días, y nunca más después de
 *    dos rechazos.
 */
export type InstallSupport = 'prompt' | 'ios-manual' | 'installed' | 'unsupported';

const DISMISSALS_KEY = 'laplace.pwa.dismissals';
const LAST_PROMPT_KEY = 'laplace.pwa.lastPrompt';

export const MAX_DISMISSALS = 2;
export const DAYS_BETWEEN_PROMPTS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** El evento que dispara Chrome. No está en los tipos estándar. */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface InstallEnvironment {
  userAgent: string;
  /** `true` si ya corre instalada (standalone). */
  standalone: boolean;
  /** `true` si el navegador emitió `beforeinstallprompt`. */
  hasPrompt: boolean;
}

export function isIos({ userAgent }: Pick<InstallEnvironment, 'userAgent'>): boolean {
  // iPadOS 13+ se hace pasar por Mac; el touch lo delata.
  const iphone = /iPad|iPhone|iPod/.test(userAgent);
  const ipadOs = /Macintosh/.test(userAgent) && /Mobile|Safari/.test(userAgent) === false;

  return iphone || (ipadOs && (globalThis.navigator?.maxTouchPoints ?? 0) > 1);
}

export function installSupport(env: InstallEnvironment): InstallSupport {
  if (env.standalone) return 'installed';
  if (env.hasPrompt) return 'prompt';
  if (isIos(env)) return 'ios-manual';

  return 'unsupported';
}

export interface PromptGateStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function safeStorage(storage?: PromptGateStorage): PromptGateStorage {
  const fallback = { getItem: () => null, setItem: () => undefined };
  try {
    return storage ?? globalThis.localStorage ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * ¿Corresponde ofrecer la instalación ahora? Es la regla de las dos condiciones
 * del `[+]` de §5.1.3.
 */
export function shouldOfferInstall(now: number, storage?: PromptGateStorage): boolean {
  const store = safeStorage(storage);

  const dismissals = Number(store.getItem(DISMISSALS_KEY) ?? '0');
  if (dismissals >= MAX_DISMISSALS) return false;

  const last = Number(store.getItem(LAST_PROMPT_KEY) ?? '0');
  if (last === 0) return true;

  return now - last >= DAYS_BETWEEN_PROMPTS * MS_PER_DAY;
}

export function recordInstallPrompted(now: number, storage?: PromptGateStorage): void {
  safeStorage(storage).setItem(LAST_PROMPT_KEY, String(now));
}

export function recordInstallDismissed(now: number, storage?: PromptGateStorage): void {
  const store = safeStorage(storage);
  const dismissals = Number(store.getItem(DISMISSALS_KEY) ?? '0');

  store.setItem(DISMISSALS_KEY, String(dismissals + 1));
  store.setItem(LAST_PROMPT_KEY, String(now));
}

/** Aceptar la instalación limpia el contador: ya no hay nada que ofrecer. */
export function recordInstallAccepted(storage?: PromptGateStorage): void {
  const store = safeStorage(storage);
  store.setItem(DISMISSALS_KEY, String(MAX_DISMISSALS));
}

export const IOS_INSTALL_STEPS = [
  'Tocá el botón Compartir, abajo en la barra de Safari.',
  'Elegí "Agregar a inicio".',
  'Confirmá con "Agregar".',
] as const;

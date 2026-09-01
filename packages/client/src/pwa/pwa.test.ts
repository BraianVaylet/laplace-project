import { describe, expect, it, vi } from 'vitest';
import {
  DAYS_BETWEEN_PROMPTS,
  IOS_INSTALL_STEPS,
  MAX_DISMISSALS,
  installSupport,
  isIos,
  recordInstallAccepted,
  recordInstallDismissed,
  recordInstallPrompted,
  shouldOfferInstall,
  type PromptGateStorage,
} from './install.js';
import { UPDATE_ESCAPE_MS, createUpdateController } from './update.js';

const DAY = 24 * 60 * 60 * 1000;

/** Storage en memoria: el gate se prueba sin depender del navegador. */
function memoryStorage(): PromptGateStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36';

describe('deteccion de plataforma', () => {
  it('reconoce iPhone', () => {
    expect(isIos({ userAgent: IPHONE })).toBe(true);
  });

  it('no confunde Android con iOS', () => {
    expect(isIos({ userAgent: ANDROID })).toBe(false);
  });
});

describe('que camino de instalacion ofrecer', () => {
  it('en Chrome, el boton nativo', () => {
    expect(installSupport({ userAgent: ANDROID, standalone: false, hasPrompt: true })).toBe(
      'prompt',
    );
  });

  it('🔴 en iOS, instrucciones manuales: `beforeinstallprompt` no existe ahi', () => {
    // Sin esto, el boton de instalar no hace nada en la mitad de los usuarios.
    expect(installSupport({ userAgent: IPHONE, standalone: false, hasPrompt: false })).toBe(
      'ios-manual',
    );
  });

  it('ya instalada, no se ofrece nada', () => {
    expect(installSupport({ userAgent: ANDROID, standalone: true, hasPrompt: true })).toBe(
      'installed',
    );
  });

  it('un navegador que no soporta PWA no muestra un boton que no funciona', () => {
    expect(
      installSupport({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0) Firefox/120.0',
        standalone: false,
        hasPrompt: false,
      }),
    ).toBe('unsupported');
  });

  it('las instrucciones de iOS nombran los pasos reales de Safari', () => {
    expect(IOS_INSTALL_STEPS.join(' ')).toContain('Compartir');
    expect(IOS_INSTALL_STEPS.join(' ')).toContain('Agregar a inicio');
  });
});

describe('cada cuanto se ofrece instalar', () => {
  const now = 1_800_000_000_000;

  it('la primera vez, si', () => {
    expect(shouldOfferInstall(now, memoryStorage())).toBe(true);
  });

  it('🔴 no se muestra en cada visita: la v1 lo pedia asi y arruina la UX', () => {
    const storage = memoryStorage();
    recordInstallPrompted(now, storage);

    expect(shouldOfferInstall(now + 1000, storage)).toBe(false);
    expect(shouldOfferInstall(now + DAY, storage)).toBe(false);
  });

  it(`vuelve a ofrecerse a los ${DAYS_BETWEEN_PROMPTS} dias`, () => {
    const storage = memoryStorage();
    recordInstallPrompted(now, storage);

    expect(shouldOfferInstall(now + DAYS_BETWEEN_PROMPTS * DAY - 1000, storage)).toBe(false);
    expect(shouldOfferInstall(now + DAYS_BETWEEN_PROMPTS * DAY, storage)).toBe(true);
  });

  it(`tras ${MAX_DISMISSALS} rechazos no se ofrece nunca mas`, () => {
    const storage = memoryStorage();

    recordInstallDismissed(now, storage);
    expect(shouldOfferInstall(now + 30 * DAY, storage)).toBe(true);

    recordInstallDismissed(now + 30 * DAY, storage);
    expect(shouldOfferInstall(now + 365 * DAY, storage)).toBe(false);
  });

  it('aceptar la instalacion apaga el ofrecimiento para siempre', () => {
    const storage = memoryStorage();
    recordInstallAccepted(storage);

    expect(shouldOfferInstall(now + 365 * DAY, storage)).toBe(false);
  });

  it('sin storage disponible no rompe: modo privado, cookies bloqueadas', () => {
    const throwing: PromptGateStorage = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
    };

    expect(() => shouldOfferInstall(now, throwing)).toThrow();
    // Con el storage del entorno ausente, cae al fallback y no lanza.
    expect(() => shouldOfferInstall(now, undefined)).not.toThrow();
  });
});

describe('popup de actualizacion', () => {
  const now = 1_800_000_000_000;

  const build = (activate = vi.fn()) => {
    const states: string[] = [];
    const controller = createUpdateController({
      activate,
      onChange: (state) => states.push(state.status),
    });
    return { controller, states, activate };
  };

  it('arranca sin nada que avisar', () => {
    const { controller } = build();

    expect(controller.state().status).toBe('idle');
    expect(controller.canDismiss()).toBe(true);
  });

  it('cuando hay version nueva, avisa', () => {
    const { controller } = build();
    controller.onAvailable();

    expect(controller.state().status).toBe('available');
  });

  it('🔴 mientras actualiza, el popup NO se puede cerrar: eso pide la v1', () => {
    const { controller } = build();
    controller.onAvailable();
    controller.apply(now);

    expect(controller.state().status).toBe('updating');
    expect(controller.canDismiss()).toBe(false);
  });

  it('aplicar dispara la activacion del service worker', () => {
    const activate = vi.fn();
    const { controller } = build(activate);
    controller.onAvailable();
    controller.apply(now);

    expect(activate).toHaveBeenCalledOnce();
  });

  it(`🔴 a los ${UPDATE_ESCAPE_MS / 1000} segundos se habilita el escape`, () => {
    // Sin esto, un service worker que falla deja al socio encerrado en un
    // cartel, sin poder reservar y sin entender por que.
    const { controller } = build();
    controller.onAvailable();
    controller.apply(now);

    controller.tick(now + UPDATE_ESCAPE_MS - 1000);
    expect(controller.canDismiss()).toBe(false);

    controller.tick(now + UPDATE_ESCAPE_MS);
    expect(controller.state().status).toBe('stuck');
    expect(controller.canDismiss()).toBe(true);
  });

  it('una vez habilitado, cerrarlo devuelve el control al usuario', () => {
    const { controller } = build();
    controller.onAvailable();
    controller.apply(now);
    controller.tick(now + UPDATE_ESCAPE_MS);

    controller.dismiss();

    expect(controller.state().status).toBe('idle');
  });

  it('no se puede cerrar antes de tiempo aunque alguien llame a dismiss', () => {
    const { controller } = build();
    controller.onAvailable();
    controller.apply(now);

    controller.dismiss();

    expect(controller.state().status).toBe('updating');
  });

  it('aplicar dos veces no reinicia el reloj del escape', () => {
    const { controller, activate } = build();
    controller.onAvailable();
    controller.apply(now);
    controller.apply(now + 20_000);

    expect(activate).toHaveBeenCalledOnce();
    controller.tick(now + UPDATE_ESCAPE_MS);
    expect(controller.canDismiss()).toBe(true);
  });

  it('el tick no hace nada si no se esta actualizando', () => {
    const { controller } = build();
    controller.tick(now + 10 * UPDATE_ESCAPE_MS);

    expect(controller.state().status).toBe('idle');
  });

  it('avisar dos veces de la misma version no duplica el estado', () => {
    const { controller, states } = build();
    controller.onAvailable();
    controller.onAvailable();

    expect(states).toEqual(['available']);
  });
});

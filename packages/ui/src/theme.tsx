import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * Tema dark/light. **Dark-first** (spec §6): el default es dark y la eleccion
 * del usuario se guarda.
 *
 * `system` es un tercer estado real, no un sinonimo de dark: quien puso su
 * telefono en claro a la mañana y oscuro a la noche espera que la app lo
 * acompañe sin tener que tocar nada.
 */
export type Theme = 'dark' | 'light' | 'system';

const STORAGE_KEY = 'laplace.theme';

interface ThemeApi {
  theme: Theme;
  /** El que efectivamente se esta pintando, ya resuelto el `system`. */
  resolved: 'dark' | 'light';
  setTheme: (theme: Theme) => void;
}

const Context = createContext<ThemeApi | null>(null);

export function useTheme(): ThemeApi {
  const api = useContext(Context);
  if (!api) throw new Error('useTheme necesita estar dentro de <ThemeProvider>');
  return api;
}

function prefersLight(): boolean {
  return globalThis.matchMedia?.('(prefers-color-scheme: light)').matches ?? false;
}

export function resolveTheme(theme: Theme): 'dark' | 'light' {
  if (theme !== 'system') return theme;
  return prefersLight() ? 'light' : 'dark';
}

function readStored(): Theme {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    return stored === 'dark' || stored === 'light' || stored === 'system' ? stored : 'system';
  } catch {
    // Modo privado, cookies bloqueadas: se sigue con el default, no se rompe.
    return 'system';
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStored);
  const [resolved, setResolved] = useState<'dark' | 'light'>(() => resolveTheme(readStored()));

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, next);
    } catch {
      // Que no se pueda guardar la preferencia no puede romper la app.
    }
  }, []);

  useEffect(() => {
    setResolved(resolveTheme(theme));

    if (theme !== 'system') return;

    // Con `system`, seguir al sistema en vivo: si el telefono cambia a oscuro
    // a las 20:00, la app cambia sin recargar.
    const media = globalThis.matchMedia?.('(prefers-color-scheme: light)');
    if (!media) return;

    const onChange = () => setResolved(resolveTheme('system'));
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  useEffect(() => {
    globalThis.document?.documentElement.setAttribute('data-theme', resolved);
  }, [resolved]);

  const api = useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme]);

  return <Context.Provider value={api}>{children}</Context.Provider>;
}

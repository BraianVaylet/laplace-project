import tailwindcss from '@tailwindcss/vite';
import type { StorybookConfig } from '@storybook/react-vite';

/**
 * Storybook es el catalogo visual de `@laplace/ui` (spec §6). Sirve para lo que
 * un test no puede: mirar el componente en dark y en light, con contenido real,
 * antes de meterlo en una pantalla.
 *
 * El rigor automatico NO vive aca: la auditoria axe y el calculo de contraste
 * corren en vitest (`pnpm test`), que es rapido y no necesita navegador. El
 * addon de a11y de abajo es la version interactiva de lo mismo, para revisar
 * mientras se diseña.
 */
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-essentials', '@storybook/addon-a11y'],
  framework: { name: '@storybook/react-vite', options: {} },

  // Sin el plugin, Tailwind v4 no procesa el `@theme` de styles.css y el build
  // se cae al compilar el CSS.
  viteFinal: (config) => {
    config.plugins = [...(config.plugins ?? []), tailwindcss()];
    return config;
  },

  // El catalogo no manda telemetria: es una decision del proyecto, no del dev
  // que lo corre por primera vez.
  core: { disableTelemetry: true },
};

export default config;

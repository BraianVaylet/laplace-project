import base from '@laplace/config/eslint/base';
import { reactLayer } from '@laplace/config/eslint/react';

/**
 * Config unico del monorepo.
 *
 * Flat config no busca "el config mas cercano" por archivo: usa uno solo, el
 * que encuentra desde el cwd hacia arriba. Por eso las reglas por app viven
 * aca, con `files` apuntando a cada directorio, y no en un config por paquete.
 * Asi lint-staged (que corre desde la raiz sobre archivos de cualquier paquete)
 * aplica exactamente las mismas reglas que `pnpm lint`.
 */
const WEB_APPS = [
  'apps/dfsa/**/*.{ts,tsx}',
  'apps/dfsm/**/*.{ts,tsx}',
  'apps/wafm/**/*.{ts,tsx}',
  'apps/landing/**/*.{ts,tsx}',
  'packages/ui/**/*.{ts,tsx}',
];

export default [
  ...base,

  reactLayer(WEB_APPS),

  {
    // ADR-003: los modulos se comunican por interfaces o eventos de dominio.
    // Importar las entrañas de otro modulo se bloquea con lint, no con buena voluntad.
    files: ['apps/api/src/modules/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(\\.\\./){2,}[^./]+/(domain|application|infrastructure)/',
              message:
                'Prohibido importar de otro modulo. Usar su interfaz publica o un evento de dominio (ADR-003).',
            },
          ],
        },
      ],
    },
  },

  {
    /*
     * `@laplace/ui` es una libreria, no una app: co-locar un provider con su
     * hook (`ThemeProvider` + `useTheme`) es el patron estandar de React y no
     * hay Fast Refresh que proteger en un paquete que se consume compilado.
     *
     * Se permiten los nombres a proposito, uno por uno, en vez de apagar la
     * regla: asi sigue avisando si alguien exporta algo por accidente desde un
     * archivo de componentes.
     */
    files: ['packages/ui/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': [
        'error',
        {
          allowConstantExport: true,
          allowExportNames: ['useTheme', 'resolveTheme', 'useToast', 'useFieldProps'],
        },
      ],
    },
  },

  {
    /*
     * La frontera de estado de §6, aplicada por lint y no por buena voluntad:
     * **Query = servidor · Zustand = UI · Nuqs = filtros urleables.**
     *
     * Duplicar estado de servidor en Zustand genera bugs de sincronizacion
     * imposibles de rastrear: dos fuentes de verdad para el mismo dato y ninguna
     * forma de saber cual quedo vieja. La forma en que eso pasa en la practica
     * es alguien importando Query adentro de un store, asi que se corta ahi.
     */
    files: ['**/state/**/*.{ts,tsx}', '**/stores/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@tanstack/react-query',
              message:
                'Estado de servidor va en Query, no en Zustand. Zustand es solo estado de UI (spec §6).',
            },
          ],
        },
      ],
    },
  },
];

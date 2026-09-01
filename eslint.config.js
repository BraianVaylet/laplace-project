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
];

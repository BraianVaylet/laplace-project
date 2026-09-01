import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Config base compartida por todos los paquetes y apps de Laplace. */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // CLAUDE.md — Prohibido
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      eqeqeq: ['error', 'always'],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'Usar Temporal (@js-temporal/polyfill), no Date. Ver spec §6.',
        },
      ],
    },
  },
  {
    // Los tests pueden usar Date y console para armar fixtures y depurar.
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', 'e2e/**'],
    rules: {
      'no-restricted-syntax': 'off',
      'no-console': 'off',
    },
  },
);

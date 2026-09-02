import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

/**
 * Capa de reglas de React. Recibe los globs a los que aplica, porque en un
 * monorepo con flat config el unico config que manda es el de la raiz.
 */
export function reactLayer(files) {
  return {
    files,
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
    },
  };
}

export default reactLayer;

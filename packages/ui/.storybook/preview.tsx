import type { Decorator, Preview } from '@storybook/react';
import '../src/styles.css';

/**
 * Toda historia se puede ver en los dos temas. Es el requisito de §15: dark y
 * light verificados, no "deberia andar".
 */
const withTheme: Decorator = (Story, context) => {
  const theme = (context.globals['theme'] as string) ?? 'dark';
  document.documentElement.setAttribute('data-theme', theme);

  return (
    <div className="bg-bg text-fg min-h-dvh p-6">
      <Story />
    </div>
  );
};

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
      description: 'Tema',
      defaultValue: 'dark',
      toolbar: {
        icon: 'circlehollow',
        items: [
          { value: 'dark', title: 'Oscuro' },
          { value: 'light', title: 'Claro' },
        ],
        dynamicTitle: true,
      },
    },
  },
  parameters: {
    controls: { expanded: true },
    a11y: { test: 'error' },
  },
};

export default preview;

import { useCallback, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../cn.js';

/**
 * Tabs con **roving tabindex**: el Tab del teclado entra y sale del grupo, y
 * las flechas mueven entre pestañas. Es el patron de la WAI-ARIA, y la razon es
 * concreta: con seis pestañas, el comportamiento ingenuo obliga a apretar Tab
 * seis veces solo para pasar de largo.
 */
export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
}

export interface TabsProps {
  items: readonly TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  /** Que agrupa estas pestañas, para el lector de pantalla. */
  label: string;
  className?: string;
}

export function Tabs({ items, activeId, onChange, label, className }: TabsProps) {
  const base = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const focusTab = useCallback((index: number) => {
    const tabs = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs?.[index]?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = items.findIndex((item) => item.id === activeId);
    if (index === -1) return;

    // Las flechas dan la vuelta: desde la ultima, la derecha lleva a la primera.
    const next = {
      ArrowRight: (index + 1) % items.length,
      ArrowLeft: (index - 1 + items.length) % items.length,
      Home: 0,
      End: items.length - 1,
    }[event.key];

    if (next === undefined) return;

    event.preventDefault();
    const target = items[next];
    if (target) {
      onChange(target.id);
      focusTab(next);
    }
  };

  const active = items.find((item) => item.id === activeId);

  return (
    <div className={className}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="border-border flex gap-1 border-b"
      >
        {items.map((item) => {
          const selected = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`${base}-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel-${item.id}`}
              // Solo la activa entra en el orden de tabulacion: eso es el
              // roving tabindex.
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(item.id)}
              className={cn(
                'focus-visible:focus-ring h-11 rounded-t-md px-4 text-sm font-medium',
                selected
                  ? 'text-fg border-brand-500 border-b-2'
                  : 'text-fg-muted hover:text-fg border-b-2 border-transparent',
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {active ? (
        <div
          role="tabpanel"
          id={`${base}-panel-${active.id}`}
          aria-labelledby={`${base}-tab-${active.id}`}
          tabIndex={0}
          className="focus-visible:focus-ring pt-4"
        >
          {active.content}
        </div>
      ) : null}
    </div>
  );
}

import type { InputHTMLAttributes, ReactNode } from 'react';
import { useId } from 'react';
import { cn } from '../cn.js';

/**
 * Checkbox y radio con su label clickeable.
 *
 * El label envuelve al control y ademas lo apunta por `htmlFor`: el area
 * clickeable pasa a ser toda la fila, que en un telefono es la diferencia entre
 * poder tildarlo y no.
 */
interface ChoiceBaseProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  description?: string;
}

function Choice({ type, label, description, className, ...props }: ChoiceBaseProps & { type: 'checkbox' | 'radio' }) {
  const id = useId();
  const descriptionId = description ? `${id}-description` : undefined;

  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type={type}
        aria-describedby={descriptionId}
        className={cn(
          // 20px de caja pero 44px de area tactil, via el padding del label.
          'border-border bg-surface-2 mt-0.5 size-5 shrink-0 border',
          type === 'checkbox' ? 'rounded' : 'rounded-full',
          'accent-brand-600 focus-visible:focus-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
      <label htmlFor={id} className="min-h-11 cursor-pointer py-1 text-sm select-none">
        <span className="text-fg block">{label}</span>
        {description ? (
          <span id={descriptionId} className="text-fg-muted block text-sm">
            {description}
          </span>
        ) : null}
      </label>
    </div>
  );
}

export type CheckboxProps = ChoiceBaseProps;
export const Checkbox = (props: CheckboxProps) => <Choice type="checkbox" {...props} />;

export type RadioProps = ChoiceBaseProps;
export const Radio = (props: RadioProps) => <Choice type="radio" {...props} />;

export interface RadioGroupProps {
  legend: string;
  children: ReactNode;
  className?: string;
}

/**
 * Agrupa radios en un `<fieldset>` con `<legend>`. Sin eso, el lector de
 * pantalla lee cada opcion suelta y nunca dice de que pregunta son respuesta.
 */
export function RadioGroup({ legend, children, className }: RadioGroupProps) {
  return (
    <fieldset className={cn('flex flex-col gap-2', className)}>
      <legend className="text-fg mb-1 text-sm font-medium">{legend}</legend>
      {children}
    </fieldset>
  );
}

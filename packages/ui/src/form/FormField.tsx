import { createContext, useContext, useId, type ReactNode } from 'react';
import { cn } from '../cn.js';

/**
 * El campo de formulario: label, ayuda y error, con el cableado de
 * accesibilidad hecho una sola vez.
 *
 * Existe porque ese cableado es lo que todo el mundo olvida: sin
 * `aria-describedby` el lector de pantalla nunca lee el mensaje de error, y sin
 * `aria-invalid` no sabe siquiera que el campo esta mal. Cada formulario que lo
 * resuelve por su cuenta lo resuelve un poco distinto y alguno lo resuelve mal.
 */
interface FieldContext {
  inputId: string;
  descriptionId: string | undefined;
  errorId: string | undefined;
  invalid: boolean;
  required: boolean;
}

const Context = createContext<FieldContext | null>(null);

/** Props que un control tiene que esparcir para quedar bien cableado. */
export function useFieldProps() {
  const field = useContext(Context);
  if (!field) return {};

  const describedBy = [field.descriptionId, field.errorId].filter(Boolean).join(' ');

  return {
    id: field.inputId,
    'aria-invalid': field.invalid || undefined,
    'aria-describedby': describedBy.length > 0 ? describedBy : undefined,
    'aria-required': field.required || undefined,
  } as const;
}

export interface FormFieldProps {
  label: string;
  /** Texto de ayuda. Se lee junto al campo, no solo se muestra. */
  description?: string;
  /** Mensaje de error. Su presencia marca el campo como invalido. */
  error?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

export function FormField({
  label,
  description,
  error,
  required = false,
  className,
  children,
}: FormFieldProps) {
  const base = useId();
  const inputId = `${base}-input`;
  const descriptionId = description ? `${base}-description` : undefined;
  const errorId = error ? `${base}-error` : undefined;

  return (
    <Context.Provider
      value={{ inputId, descriptionId, errorId, invalid: Boolean(error), required }}
    >
      <div className={cn('flex flex-col gap-1.5', className)}>
        <label htmlFor={inputId} className="text-fg text-sm font-medium">
          {label}
          {required ? (
            <span className="text-danger-500 ml-1" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>

        {description ? (
          <p id={descriptionId} className="text-fg-muted text-sm">
            {description}
          </p>
        ) : null}

        {children}

        {/*
          `role="alert"` para que el lector lo anuncie al aparecer. Sin esto, el
          usuario que navega con teclado descubre el error recien cuando vuelve
          al campo.
        */}
        {error ? (
          <p id={errorId} role="alert" className="text-danger-500 text-sm">
            {error}
          </p>
        ) : null}
      </div>
    </Context.Provider>
  );
}

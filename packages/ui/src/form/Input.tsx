import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '../cn.js';
import { useFieldProps } from './FormField.js';

/**
 * Alto 44px y tipografia 16px: el minimo tactil de WCAG 2.2 AA y el umbral por
 * debajo del cual Safari en iOS hace zoom automatico al enfocar (§6).
 */
const CONTROL = [
  'w-full rounded-md border bg-surface-2 text-fg',
  'text-input h-11 px-3',
  'border-border placeholder:text-fg-muted',
  'focus-visible:focus-ring focus-visible:outline-none',
  'disabled:cursor-not-allowed disabled:opacity-50',
  'aria-[invalid=true]:border-danger-500',
].join(' ');

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...props }: InputProps) {
  const field = useFieldProps();
  return <input {...field} className={cn(CONTROL, className)} {...props} />;
}

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ className, rows = 4, ...props }: TextareaProps) {
  const field = useFieldProps();
  return (
    <textarea
      {...field}
      rows={rows}
      className={cn(CONTROL, 'h-auto py-2 leading-relaxed', className)}
      {...props}
    />
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends Omit<InputHTMLAttributes<HTMLSelectElement>, 'children'> {
  options: readonly SelectOption[];
  /** Opcion vacia inicial. Sin esto, un select "sin elegir" miente: ya eligio el primero. */
  placeholder?: string;
}

export function Select({ options, placeholder, className, ...props }: SelectProps) {
  const field = useFieldProps();
  return (
    <select {...field} className={cn(CONTROL, 'pr-8', className)} {...props}>
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

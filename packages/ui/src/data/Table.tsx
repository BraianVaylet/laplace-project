import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react';
import { cn } from '../cn.js';

/**
 * Tabla semantica. Los `<th scope>` no son decorativos: son lo que le permite
 * al lector de pantalla decir "Micaela, columna Estado, activo" en vez de leer
 * cuarenta celdas sueltas sin contexto.
 *
 * El contenedor scrollea en su propio eje: una tabla ancha no puede hacer que
 * scrollee la pagina entera en un telefono.
 */
export function Table({
  caption,
  children,
  className,
}: {
  /** Descripcion de la tabla para lectores de pantalla. */
  caption: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full border-collapse text-left text-sm', className)}>
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export const THead = ({ children }: { children: ReactNode }) => (
  <thead className="border-border border-b">{children}</thead>
);

export const TBody = ({ children }: { children: ReactNode }) => <tbody>{children}</tbody>;

export const TR = ({ children, className }: { children: ReactNode; className?: string }) => (
  <tr className={cn('border-border/60 border-b last:border-0', className)}>{children}</tr>
);

export function TH({ children, className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th scope="col" className={cn('text-fg-muted px-3 py-2 font-medium', className)} {...props}>
      {children}
    </th>
  );
}

export function TD({ children, className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn('text-fg px-3 py-2', className)} {...props}>
      {children}
    </td>
  );
}

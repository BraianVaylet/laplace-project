export interface ComplianceRow {
  memberId: string | null;
  fullName: string;
  version: number;
  acceptedAt: string;
}

const COLUMNAS = ['memberId', 'fullName', 'version', 'acceptedAt'] as const;

/**
 * El panel de cumplimiento como CSV (§2.1.20), para pegarlo en una planilla.
 *
 * Cada campo pasa por `escapar`: `fullName` es texto libre que un socio pudo
 * haber cargado con una coma, una comilla o, potencialmente, algo pensado
 * para ejecutarse como fórmula al abrir el archivo en Excel/Sheets — un
 * clásico de la "inyección CSV" del OWASP. Nunca se interpola directo.
 */
export function complianceToCsv(rows: readonly ComplianceRow[]): string {
  const filas = [
    COLUMNAS.join(','),
    ...rows.map((row) =>
      [row.memberId ?? '', row.fullName, String(row.version), row.acceptedAt]
        .map(escapar)
        .join(','),
    ),
  ];

  return filas.join('\n');
}

function escapar(valor: string): string {
  // Un campo que empieza con uno de estos caracteres se interpreta como
  // fórmula en Excel/Sheets: la comilla adelante lo deja como texto plano.
  const protegido = /^[=+\-@]/.test(valor) ? `'${valor}` : valor;

  return /[",\n]/.test(protegido) ? `"${protegido.replaceAll('"', '""')}"` : protegido;
}

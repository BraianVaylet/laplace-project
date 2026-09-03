import { describe, expect, it } from 'vitest';
import { complianceToCsv } from './compliance-csv.js';

/**
 * El panel de cumplimiento exportado (§2.1.20): quién firmó y cuándo, para
 * pegarlo en una planilla o adjuntarlo si algún día hay que probarlo.
 */
describe('complianceToCsv', () => {
  it('trae encabezado y una fila por firma', () => {
    const csv = complianceToCsv([
      {
        memberId: 'mem_1',
        fullName: 'Micaela Sosa',
        version: 1,
        acceptedAt: '2026-03-01T10:00:00Z',
      },
      {
        memberId: 'mem_2',
        fullName: 'Joaquín Pérez',
        version: 1,
        acceptedAt: '2026-03-02T11:00:00Z',
      },
    ]);
    const filas = csv.split('\n');

    expect(filas[0]).toBe('memberId,fullName,version,acceptedAt');
    expect(filas).toHaveLength(3);
    expect(filas[1]).toBe('mem_1,Micaela Sosa,1,2026-03-01T10:00:00Z');
  });

  it('sin firmas, solo el encabezado', () => {
    expect(complianceToCsv([])).toBe('memberId,fullName,version,acceptedAt');
  });

  it('🔴 un nombre con coma no rompe las columnas', () => {
    const csv = complianceToCsv([
      {
        memberId: 'mem_1',
        fullName: 'Sosa, Micaela',
        version: 1,
        acceptedAt: '2026-03-01T10:00:00Z',
      },
    ]);

    expect(csv.split('\n')[1]).toBe('mem_1,"Sosa, Micaela",1,2026-03-01T10:00:00Z');
  });

  it('un nombre que empieza con `=` no se interpreta como fórmula al abrirlo en Excel', () => {
    const csv = complianceToCsv([
      {
        memberId: 'mem_1',
        fullName: '=SUM(A1:A9)',
        version: 1,
        acceptedAt: '2026-03-01T10:00:00Z',
      },
    ]);

    // Le antepone una comilla: Excel/Sheets lo muestran como texto, no lo evalúan.
    expect(csv.split('\n')[1]).toContain("'=SUM(A1:A9)");
  });

  it('sin socio vinculado, el `memberId` sale vacío y no `null`', () => {
    const csv = complianceToCsv([
      {
        memberId: null,
        fullName: 'Cuenta sin ficha de socio',
        version: 1,
        acceptedAt: '2026-03-01T10:00:00Z',
      },
    ]);

    expect(csv.split('\n')[1]).toBe(',Cuenta sin ficha de socio,1,2026-03-01T10:00:00Z');
  });
});

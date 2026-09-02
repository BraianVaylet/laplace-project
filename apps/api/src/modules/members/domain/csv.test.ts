import { describe, expect, it } from 'vitest';
import { AppError } from '../../../http/errors.js';
import { parseCsv } from './csv.js';

describe('parser de CSV', () => {
  it('lee encabezado y filas', () => {
    const { headers, rows } = parseCsv('nombre,apellido\nMicaela,Sosa\nJuan,Pérez');

    expect(headers).toEqual(['nombre', 'apellido']);
    expect(rows).toEqual([
      ['Micaela', 'Sosa'],
      ['Juan', 'Pérez'],
    ]);
  });

  it('acepta punto y coma: es lo que exporta Excel en es-AR', () => {
    // El Excel en español usa `;` porque la coma es el separador decimal. Si el
    // parser solo entendiera `,`, el archivo del 90% de los centros entraria
    // como una sola columna gigante.
    const { headers, rows } = parseCsv('nombre;apellido\nMicaela;Sosa');

    expect(headers).toEqual(['nombre', 'apellido']);
    expect(rows).toEqual([['Micaela', 'Sosa']]);
  });

  it('respeta las comillas: una coma adentro no parte la celda', () => {
    const { rows } = parseCsv('nombre,direccion\nJuan,"Alsina 123, Bahía Blanca"');

    expect(rows[0]).toEqual(['Juan', 'Alsina 123, Bahía Blanca']);
  });

  it('una comilla escapada es una comilla', () => {
    const { rows } = parseCsv('apodo\n"El ""Toro"" Pérez"');

    expect(rows[0]).toEqual(['El "Toro" Pérez']);
  });

  it('un salto de linea dentro de comillas no abre una fila nueva', () => {
    const { rows } = parseCsv('nombre,nota\nJuan,"linea 1\nlinea 2"');

    expect(rows).toHaveLength(1);
    expect(rows[0]?.[1]).toBe('linea 1\nlinea 2');
  });

  it('tolera el fin de linea de Windows', () => {
    const { rows } = parseCsv('nombre\r\nMicaela\r\nJuan');

    expect(rows).toEqual([['Micaela'], ['Juan']]);
  });

  it('saca el BOM que agrega Excel al guardar como UTF-8', () => {
    // Sin esto, la primera columna se llama "\uFEFFnombre" y no matchea nunca.
    const { headers } = parseCsv('\uFEFFnombre,apellido\nMicaela,Sosa');

    expect(headers).toEqual(['nombre', 'apellido']);
  });

  it('normaliza el encabezado: sin espacios, sin acentos y en minuscula', () => {
    const { headers } = parseCsv(' Nombre , Teléfono ,DOCUMENTO\nMica,123,456');

    expect(headers).toEqual(['nombre', 'telefono', 'documento']);
  });

  it('ignora las lineas totalmente vacias', () => {
    const { rows } = parseCsv('nombre\nMicaela\n\n\nJuan\n');

    expect(rows).toEqual([['Micaela'], ['Juan']]);
  });

  it('completa las filas cortas en vez de romper', () => {
    // El que exporta de una planilla deja celdas finales vacias todo el tiempo.
    const { rows } = parseCsv('nombre,apellido,telefono\nMicaela,Sosa');

    expect(rows[0]).toEqual(['Micaela', 'Sosa', '']);
  });

  it('rechaza un archivo vacio con codigo tipado', () => {
    expect(() => parseCsv('')).toThrowError(AppError);
    expect(() => parseCsv('   \n  ')).toThrowError(AppError);
  });

  it('rechaza un archivo sin filas de datos', () => {
    expect(() => parseCsv('nombre,apellido')).toThrowError(AppError);
  });

  it('rechaza una fila con mas columnas que el encabezado', () => {
    // Es el sintoma de un separador mal detectado o de una comilla sin cerrar:
    // seguir de largo importaria los datos corridos una columna.
    expect(() => parseCsv('nombre,apellido\nMicaela,Sosa,demas')).toThrowError(AppError);
  });

  it('el error dice la fila: en un archivo de 143 lineas hace falta', () => {
    try {
      parseCsv('nombre\nok\nde,mas');
      expect.unreachable();
    } catch (error) {
      expect((error as AppError).code).toBe('LP-MEMB-422-006');
      expect((error as AppError).message).toContain('3');
    }
  });

  it('corta un archivo mas grande que el maximo declarado', () => {
    const grande = ['nombre', ...Array.from({ length: 5001 }, (_, i) => `socio${i}`)].join('\n');

    expect(() => parseCsv(grande)).toThrowError(AppError);
  });
});

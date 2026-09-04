import { describe, expect, it } from 'vitest';
import { assertRenderable, render, variablesOf } from './template.js';
import type { AppError } from '../../../http/errors.js';

/**
 * Las plantillas las edita el SMU (§2.1.14), así que el motor tiene que
 * aguantar que se equivoque: un aviso que sale con `{{clase}}` sin resolver es
 * peor que no mandar nada.
 */
describe('variablesOf', () => {
  it('encuentra las variables de la plantilla', () => {
    expect(variablesOf('Hola {{nombre}}, tu clase de {{clase}} es a las {{hora}}.')).toEqual([
      'nombre',
      'clase',
      'hora',
    ]);
  });

  it('no repite la que aparece dos veces', () => {
    expect(variablesOf('{{nombre}}, te esperamos {{nombre}}')).toEqual(['nombre']);
  });

  it('tolera espacios adentro de las llaves', () => {
    expect(variablesOf('Hola {{ nombre }}')).toEqual(['nombre']);
  });

  it('sin variables, lista vacía', () => {
    expect(variablesOf('Tu pago se acreditó.')).toEqual([]);
  });
});

describe('render', () => {
  it('reemplaza cada variable por su valor', () => {
    const texto = render('Hola {{nombre}}, tu clase de {{clase}} es a las {{hora}}.', {
      nombre: 'Micaela',
      clase: 'Funcional',
      hora: '19:00',
    });

    expect(texto).toBe('Hola Micaela, tu clase de Funcional es a las 19:00.');
  });

  it('reemplaza todas las apariciones de la misma variable', () => {
    expect(render('{{nombre}} y {{nombre}}', { nombre: 'Ana' })).toBe('Ana y Ana');
  });

  it('🔴 si falta un valor, no manda el hueco: falla', () => {
    try {
      render('Tu clase de {{clase}} es a las {{hora}}.', { clase: 'Funcional' });
      throw new Error('tenía que fallar');
    } catch (error) {
      expect((error as AppError).code).toBe('LP-NOTF-422-002');
      expect((error as AppError).message).toContain('hora');
    }
  });
});

describe('assertRenderable', () => {
  it('pasa cuando todas las variables están disponibles', () => {
    expect(() => assertRenderable('Hola {{nombre}}', ['nombre', 'clase'])).not.toThrow();
  });

  it('🔴 falla al guardar, no al enviar: es cuando el SMU puede arreglarlo', () => {
    try {
      assertRenderable('Hola {{apodo}}', ['nombre', 'clase']);
      throw new Error('tenía que fallar');
    } catch (error) {
      expect((error as AppError).code).toBe('LP-NOTF-422-002');
      // El mensaje dice cuáles hay, no solo que la que usó está mal.
      expect((error as AppError).action).toContain('nombre');
    }
  });
});
